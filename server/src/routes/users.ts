import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { AuthProvider, Role } from "@prisma/client";

import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole(Role.ADMIN));

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, authProvider: true, createdAt: true },
    });
    res.json({ users });
  }),
);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(200),
  role: z.nativeEnum(Role),
});

usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    // findFirst (auto-scoped by tenancy extension) rather than findUnique by
    // email alone — email is no longer globally unique.
    const existing = await prisma.user.findFirst({ where: { email: body.email } });
    if (existing) throw new AppError(409, "Email already in use", "EMAIL_TAKEN");

    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: {
        organizationId: req.user!.organizationId,
        name: body.name,
        email: body.email,
        passwordHash,
        role: body.role,
        authProvider: AuthProvider.LOCAL,
      },
      select: { id: true, name: true, email: true, role: true, authProvider: true, createdAt: true },
    });
    res.status(201).json({ user });
  }),
);

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.nativeEnum(Role).optional(),
});

usersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");

    const user = await prisma.user.update({
      where: { id },
      data: body,
      select: { id: true, name: true, email: true, role: true, authProvider: true, createdAt: true },
    });
    res.json({ user });
  }),
);

usersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    if (id === req.user!.id) {
      throw new AppError(400, "You can't delete your own account", "BAD_REQUEST");
    }
    await prisma.user.delete({ where: { id } });
    res.status(204).end();
  }),
);
