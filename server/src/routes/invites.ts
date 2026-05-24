/**
 * Organization invites.
 *
 *   ADMIN (in-tenant):
 *     GET    /api/invites           — list pending + recent invites for my org
 *     POST   /api/invites           — create an invite (sends email link)
 *     DELETE /api/invites/:id       — revoke (delete pending invite)
 *
 *   Public (no auth):
 *     GET    /api/invites/lookup/:token   — read invite metadata
 *     POST   /api/invites/lookup/:token   — accept (create local user + return JWT)
 */

import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import bcrypt from "bcrypt";
import { AuthProvider, Role } from "@prisma/client";

import { prisma, basePrismaUnscoped } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { signToken } from "../auth/jwt.js";
import { env } from "../env.js";
import { sendMail } from "../email/mailer.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Admin (tenant-scoped) router ─────────────────────────────────────

export const invitesRouter = Router();
invitesRouter.use(requireAuth, requireRole(Role.ADMIN));

invitesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const invites = await basePrismaUnscoped.orgInvite.findMany({
      where: { organizationId: me.organizationId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ invites });
  }),
);

const createSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  role: z.nativeEnum(Role),
});

invitesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const body = createSchema.parse(req.body);

    // Already a user in this org?
    const existing = await prisma.user.findUnique({
      where: { organizationId_email: { organizationId: me.organizationId, email: body.email } },
    });
    if (existing) throw new AppError(409, "That email already has an account in your org", "EMAIL_TAKEN");

    const invite = await basePrismaUnscoped.orgInvite.create({
      data: {
        organizationId: me.organizationId,
        email: body.email,
        role: body.role,
        token: nanoid(24),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const url = `${env.CLIENT_URL}/invite/${invite.token}`;
    try {
      await sendMail({
        to: invite.email,
        subject: `You've been invited to ${me.organizationSlug} on Relay`,
        text:
          `You've been invited to join ${me.organizationSlug} on Relay as ${invite.role.toLowerCase()}.\n\n` +
          `Accept the invite: ${url}\n\nThis link expires in 7 days.`,
        html:
          `<p>You've been invited to join <strong>${me.organizationSlug}</strong> on Relay as <strong>${invite.role.toLowerCase()}</strong>.</p>` +
          `<p><a href="${url}" style="background:#17160E;color:#C8F23A;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600">Accept invite →</a></p>` +
          `<p style="font-size:12px;color:#17160E80">Link expires in 7 days. Direct link: ${url}</p>`,
      });
    } catch (err) {
      console.error("[invites] failed to send invite email:", err);
    }

    res.status(201).json({ invite });
  }),
);

invitesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const result = await basePrismaUnscoped.orgInvite.deleteMany({
      where: { id, organizationId: me.organizationId, acceptedAt: null },
    });
    if (result.count === 0) throw new AppError(404, "Invite not found or already accepted", "NOT_FOUND");
    res.status(204).end();
  }),
);

// ─── Public accept router ─────────────────────────────────────────────

export const invitePublicRouter = Router();

invitePublicRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const token = req.params.token;
    if (!token) throw new AppError(400, "Missing token", "BAD_REQUEST");
    const invite = await basePrismaUnscoped.orgInvite.findUnique({
      where: { token },
      include: { organization: { select: { name: true, slug: true } } },
    });
    if (!invite) throw new AppError(404, "Invite not found", "NOT_FOUND");
    if (invite.acceptedAt) throw new AppError(410, "Invite already accepted", "ALREADY_ACCEPTED");
    if (invite.expiresAt.getTime() < Date.now()) throw new AppError(410, "Invite expired", "EXPIRED");
    res.json({
      email: invite.email,
      role: invite.role,
      organization: invite.organization,
      expiresAt: invite.expiresAt,
    });
  }),
);

const acceptSchema = z.object({
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
});

invitePublicRouter.post(
  "/:token",
  asyncHandler(async (req, res) => {
    const token = req.params.token;
    if (!token) throw new AppError(400, "Missing token", "BAD_REQUEST");
    const body = acceptSchema.parse(req.body);

    const invite = await basePrismaUnscoped.orgInvite.findUnique({ where: { token } });
    if (!invite) throw new AppError(404, "Invite not found", "NOT_FOUND");
    if (invite.acceptedAt) throw new AppError(410, "Invite already accepted", "ALREADY_ACCEPTED");
    if (invite.expiresAt.getTime() < Date.now()) throw new AppError(410, "Invite expired", "EXPIRED");

    const passwordHash = await bcrypt.hash(body.password, 10);

    const user = await basePrismaUnscoped.user.upsert({
      where: {
        organizationId_email: { organizationId: invite.organizationId, email: invite.email },
      },
      create: {
        organizationId: invite.organizationId,
        name: body.name,
        email: invite.email,
        passwordHash,
        role: invite.role,
        authProvider: AuthProvider.LOCAL,
      },
      update: {
        name: body.name,
        passwordHash,
        role: invite.role,
      },
    });

    await basePrismaUnscoped.orgInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: invite.organizationId },
    });

    const tokenJwt = signToken({
      userId: user.id,
      role: user.role,
      organizationId: invite.organizationId,
      isPlatformAdmin: user.isPlatformAdmin,
    });

    res.status(201).json({
      token: tokenJwt,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    });
  }),
);
