import jwt, { type SignOptions } from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../env.js";

export interface JwtPayload {
  userId: string;
  role: Role;
  organizationId: string;
  isPlatformAdmin: boolean;
}

export function signToken(payload: JwtPayload): string {
  const opts: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_SECRET, opts);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string" || !decoded || typeof decoded !== "object") {
    throw new Error("Malformed token");
  }
  const obj = decoded as Record<string, unknown>;
  if (
    typeof obj.userId !== "string" ||
    typeof obj.role !== "string" ||
    typeof obj.organizationId !== "string"
  ) {
    throw new Error("Malformed token");
  }
  return {
    userId: obj.userId,
    role: obj.role as Role,
    organizationId: obj.organizationId,
    isPlatformAdmin: obj.isPlatformAdmin === true,
  };
}
