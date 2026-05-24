import { Router } from "express";
import bcrypt from "bcrypt";
import passport from "passport";
import { z } from "zod";
import { AuthProvider, Role } from "@prisma/client";
import { nanoid } from "nanoid";

import { basePrismaUnscoped } from "../db.js";
import { env, oauthEnabled } from "../env.js";
import { AppError, asyncHandler } from "../errors.js";
import { signToken } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";
import { encodeState } from "../auth/passport.js";

export const authRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────

function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function uniqueSlug(base: string): Promise<string> {
  const root = normalizeSlug(base) || "org";
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? root : `${root}-${suffix + 1}`;
    const exists = await basePrismaUnscoped.organization.findUnique({ where: { slug: candidate } });
    if (!exists) return candidate;
  }
  return `${root}-${nanoid(6)}`;
}

// ─── Register (creates an org + its first ADMIN) ──────────────────────

const registerSchema = z.object({
  organizationName: z.string().min(1).max(120),
  organizationSlug: z.string().min(1).max(60).optional(),
  name: z.string().min(1).max(120),
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(200),
});

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const slug = await uniqueSlug(body.organizationSlug ?? body.organizationName);

    const passwordHash = await bcrypt.hash(body.password, 10);
    const organization = await basePrismaUnscoped.organization.create({
      data: { name: body.organizationName, slug },
    });
    const user = await basePrismaUnscoped.user.create({
      data: {
        organizationId: organization.id,
        name: body.name,
        email: body.email,
        passwordHash,
        authProvider: AuthProvider.LOCAL,
        role: Role.ADMIN,
      },
    });

    const token = signToken({
      userId: user.id,
      role: user.role,
      organizationId: organization.id,
      isPlatformAdmin: false,
    });
    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
    });
  }),
);

// ─── Login (org slug + email + password) ──────────────────────────────

const loginSchema = z.object({
  orgSlug: z.string().min(1),
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const organization = await basePrismaUnscoped.organization.findUnique({
      where: { slug: body.orgSlug },
    });
    if (!organization) throw new AppError(401, "Invalid credentials", "BAD_CREDENTIALS");
    if (organization.suspendedAt) throw new AppError(403, "Organization is suspended", "ORG_SUSPENDED");

    const user = await basePrismaUnscoped.user.findUnique({
      where: { organizationId_email: { organizationId: organization.id, email: body.email } },
    });
    if (!user || !user.passwordHash) throw new AppError(401, "Invalid credentials", "BAD_CREDENTIALS");

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new AppError(401, "Invalid credentials", "BAD_CREDENTIALS");

    const token = signToken({
      userId: user.id,
      role: user.role,
      organizationId: organization.id,
      isPlatformAdmin: user.isPlatformAdmin,
    });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isPlatformAdmin: user.isPlatformAdmin },
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
    });
  }),
);

// ─── Me ───────────────────────────────────────────────────────────────

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const u = req.user!;
    res.json({
      user: {
        id: u.id, name: u.name, email: u.email, role: u.role,
        isPlatformAdmin: u.isPlatformAdmin,
      },
      organization: { id: u.organizationId, slug: u.organizationSlug },
    });
  }),
);

// ─── Providers ────────────────────────────────────────────────────────

authRouter.get("/providers", (_req, res) => {
  res.json({ google: oauthEnabled.google, microsoft: oauthEnabled.microsoft });
});

// ─── OAuth — Google ───────────────────────────────────────────────────

function entrypoint(provider: "google" | "microsoft") {
  return asyncHandler(async (req, res, next) => {
    const slug = typeof req.query.org === "string" ? req.query.org : "";
    if (!slug) throw new AppError(400, "Missing org slug for SSO", "BAD_REQUEST");
    // Ensure the org exists so we don't ship the user off to Google for nothing.
    const org = await basePrismaUnscoped.organization.findUnique({ where: { slug } });
    if (!org) throw new AppError(404, "Unknown organization", "NOT_FOUND");

    const state = encodeState({ slug, nonce: nanoid(12) });
    const scope = provider === "google" ? ["profile", "email"] : ["user.read"];
    passport.authenticate(provider, { scope, session: false, state })(req, res, next);
  });
}

function callback(provider: "google" | "microsoft") {
  return [
    passport.authenticate(provider, {
      session: false,
      failureRedirect: `${env.CLIENT_URL}/login?error=oauth`,
    }),
    (req: import("express").Request, res: import("express").Response) => {
      const u = req.user as Express.User | undefined;
      if (!u) {
        res.redirect(`${env.CLIENT_URL}/login?error=oauth`);
        return;
      }
      const token = signToken({
        userId: u.id,
        role: u.role,
        organizationId: u.organizationId,
        isPlatformAdmin: u.isPlatformAdmin,
      });
      res.redirect(`${env.CLIENT_URL}/auth/callback?token=${encodeURIComponent(token)}&org=${encodeURIComponent(u.organizationSlug)}`);
    },
  ] as const;
}

if (oauthEnabled.google) {
  authRouter.get("/google", entrypoint("google"));
  const [auth, finish] = callback("google");
  authRouter.get("/google/callback", auth, finish);
}

if (oauthEnabled.microsoft) {
  authRouter.get("/microsoft", entrypoint("microsoft"));
  const [auth, finish] = callback("microsoft");
  authRouter.get("/microsoft/callback", auth, finish);
}
