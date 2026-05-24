import { prisma } from "./db.js";

/**
 * Generate the next ticket ref code (INC-1xxx). Retries on the off chance
 * a concurrent creation collides on the unique index.
 */
export async function nextRefCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const count = await prisma.ticket.count();
    const candidate = `INC-${1000 + count + 1 + attempt}`;
    // refCode is no longer globally unique — the extension auto-scopes findFirst
    // to the current organization, so this only checks within the current tenant.
    const exists = await prisma.ticket.findFirst({ where: { refCode: candidate } });
    if (!exists) return candidate;
  }
  // Final fallback — extremely unlikely.
  return `INC-${Date.now()}`;
}
