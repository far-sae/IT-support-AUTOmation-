/**
 * Request-scoped tenant context.
 *
 * Held in Node's AsyncLocalStorage so that the Prisma client extension
 * (see ../db.ts) can read the current organization without every route
 * having to pass it through. The flow per authenticated request:
 *
 *   requireAuth → loads user → tenantContext.run({ orgId, platformMode:false }, next)
 *
 * Platform-admin routes opt in to `platformMode: true` so the extension
 * skips the org filter and queries can span tenants. Public routes that
 * need to act on a specific tenant (status page, survey, email ingest)
 * call `runWithTenant(orgId, ...)` themselves after resolving the org.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  organizationId: string | null;
  platformMode: boolean;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return tenantContext.getStore();
}

export function currentOrganizationId(): string | null {
  return tenantContext.getStore()?.organizationId ?? null;
}

export function runWithTenant<T>(organizationId: string, fn: () => T): T {
  return tenantContext.run({ organizationId, platformMode: false }, fn);
}

export function runWithPlatformMode<T>(fn: () => T): T {
  return tenantContext.run({ organizationId: null, platformMode: true }, fn);
}

/**
 * Run without any tenant context. Useful for system bootstrap (migrations,
 * ensureBucket) and for the SLA cron which needs to scan across all orgs.
 * Use sparingly — by design this bypasses the tenant filter.
 */
export function runUnscoped<T>(fn: () => T): T {
  return tenantContext.run({ organizationId: null, platformMode: true }, fn);
}
