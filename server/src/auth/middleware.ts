import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";

import { basePrismaUnscoped } from "../db.js";
import { AppError } from "../errors.js";
import { verifyToken } from "./jwt.js";
import { tenantContext } from "../tenant/context.js";

function extractToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Verifies the JWT, hydrates `req.user`, and runs the rest of the request
 * inside a tenant-context scope so the Prisma extension auto-filters every
 * query by the caller's organization.
 *
 * The User lookup uses `basePrismaUnscoped` — at this point we haven't set
 * any tenant context yet, but more importantly we'd be filtering by an org
 * we haven't loaded yet.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractToken(req.headers.authorization);
    if (!token) throw new AppError(401, "Missing or malformed Authorization header", "UNAUTHENTICATED");

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw new AppError(401, "Invalid or expired token", "UNAUTHENTICATED");
    }

    const user = await basePrismaUnscoped.user.findUnique({
      where: { id: payload.userId },
      include: { organization: { select: { slug: true, suspendedAt: true } } },
    });
    if (!user) throw new AppError(401, "User no longer exists", "UNAUTHENTICATED");
    if (user.organization?.suspendedAt) {
      throw new AppError(403, "Your organization is suspended", "ORG_SUSPENDED");
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      organizationId: user.organizationId,
      organizationSlug: user.organization.slug,
      isPlatformAdmin: user.isPlatformAdmin,
    };

    tenantContext.run(
      { organizationId: user.organizationId, platformMode: false },
      () => next(),
    );
  } catch (err) {
    next(err);
  }
};

export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError(401, "Authentication required", "UNAUTHENTICATED"));
      return;
    }
    if (!allowed.includes(req.user.role)) {
      next(new AppError(403, "Insufficient role", "FORBIDDEN"));
      return;
    }
    next();
  };
}

/**
 * Gate platform-admin endpoints. Switches the active tenant context into
 * platform mode so queries can span organizations.
 */
export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(new AppError(401, "Authentication required", "UNAUTHENTICATED"));
    return;
  }
  if (!req.user.isPlatformAdmin) {
    next(new AppError(403, "Platform admin only", "FORBIDDEN"));
    return;
  }
  tenantContext.run({ organizationId: null, platformMode: true }, () => next());
};
