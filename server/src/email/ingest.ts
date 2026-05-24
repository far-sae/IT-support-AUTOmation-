/**
 * Inbound email → triaged ticket pipeline.
 *
 * `ingestEmail()` is the single entry point used by both the IMAP poller and
 * the POST /api/email/inbound route, so dev can test without a real mailbox.
 *
 * Multi-tenant note: the caller must specify which organization to file the
 * message under (`orgSlug`). For IMAP we default to env.IMAP_DEFAULT_ORG_SLUG;
 * the public /api/email/inbound endpoint accepts `orgSlug` in the body.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { TicketSource } from "@prisma/client";

import { env } from "../env.js";
import { prisma, basePrismaUnscoped } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { nextRefCode } from "../ref.js";
import { computeSlaDueAt, generateAutoReply, triage, type Priority } from "../triage.js";
import { emit } from "../realtime/socket.js";
import { sendMail } from "./mailer.js";
import { autoReplyEmail } from "./templates.js";

export interface InboundEmail {
  orgSlug: string;
  from: string;
  name?: string;
  subject?: string;
  body: string;
}

export interface IngestResult {
  organizationId: string;
  ticketId: string;
  refCode: string;
}

/**
 * Resolve the org from slug, then run the rest of the create flow within
 * that tenant's ALS context so the Prisma extension auto-filters / injects
 * organizationId on every operation.
 */
export async function ingestEmail(input: InboundEmail): Promise<IngestResult> {
  const org = await basePrismaUnscoped.organization.findUnique({
    where: { slug: input.orgSlug },
  });
  if (!org) throw new Error(`Unknown organization slug: ${input.orgSlug}`);
  if (org.suspendedAt) throw new Error("Organization is suspended");

  return runWithTenant(org.id, async () => {
    const from = input.from.trim().toLowerCase();
    const displayName = (input.name?.trim() || from.split("@")[0]) ?? from;
    const description = [input.subject?.trim(), input.body?.trim()].filter(Boolean).join("\n\n");

    // Same email may exist in many orgs; the extension scopes findFirst.
    const submitter = await prisma.user.findFirst({ where: { email: from } });

    const result = triage(description);
    const refCode = await nextRefCode();
    const createdAt = new Date();
    const slaDueAt = computeSlaDueAt(result.priority as Priority, createdAt);
    const autoReplyText = generateAutoReply({
      submitterName: displayName,
      refCode,
      category: result.category,
      priority: result.priority,
      assignedTeam: result.assignedTeam,
      slaTarget: result.slaTarget,
    });

    const ticket = await prisma.ticket.create({
      data: {
        organizationId: org.id,
        refCode,
        description,
        source: TicketSource.EMAIL,
        submitterName: displayName,
        submitterEmail: from,
        submitterUserId: submitter?.id ?? null,
        category: result.category,
        priority: result.priority,
        assignedTeam: result.assignedTeam,
        slaTarget: result.slaTarget,
        slaDueAt,
        confidence: result.confidence,
        autoReply: autoReplyText,
      },
    });

    try {
      const built = autoReplyEmail({
        submitterName: displayName,
        refCode,
        category: result.category,
        priority: result.priority,
        assignedTeam: result.assignedTeam,
        slaTarget: result.slaTarget,
        autoReplyText,
      });
      await sendMail({ to: from, ...built });
    } catch (err) {
      console.error("[ingestEmail] failed to send auto-reply:", err);
    }

    emit("ticket:created", {
      ticketId: ticket.id,
      refCode: ticket.refCode,
      status: ticket.status,
      priority: ticket.priority,
    });
    emit("analytics:updated", { reason: "ticket-created-email" });

    return { organizationId: org.id, ticketId: ticket.id, refCode: ticket.refCode };
  });
}

// ─── IMAP poller ──────────────────────────────────────────────────────

let isPolling = false;
let pollTimer: NodeJS.Timeout | null = null;

async function pollOnce(): Promise<void> {
  if (!env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASS || !env.IMAP_PORT) return;
  if (!env.IMAP_DEFAULT_ORG_SLUG) {
    console.warn("[imap] IMAP configured but IMAP_DEFAULT_ORG_SLUG not set — skipping");
    return;
  }
  if (isPolling) return;
  isPolling = true;

  const client = new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: env.IMAP_TLS,
    auth: { user: env.IMAP_USER, pass: env.IMAP_PASS },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch({ seen: false }, { source: true, uid: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const fromAddr = parsed.from?.value?.[0];
        if (!fromAddr?.address) continue;

        try {
          await ingestEmail({
            orgSlug: env.IMAP_DEFAULT_ORG_SLUG,
            from: fromAddr.address,
            name: fromAddr.name,
            subject: parsed.subject ?? "",
            body: (parsed.text ?? parsed.html ?? "").toString(),
          });
          await client.messageFlagsAdd(message.uid, ["\\Seen"], { uid: true });
        } catch (err) {
          console.error("[imap] failed to ingest message:", err);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error("[imap] poll failed:", err);
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
    isPolling = false;
  }
}

export function startImapPoller(): void {
  if (!env.IMAP_HOST || !env.IMAP_USER) {
    console.log("[imap] disabled (IMAP_HOST / IMAP_USER not set)");
    return;
  }
  if (pollTimer) return;
  const intervalMs = env.IMAP_POLL_SECONDS * 1000;
  console.log(`[imap] polling ${env.IMAP_HOST} every ${env.IMAP_POLL_SECONDS}s`);
  void pollOnce();
  pollTimer = setInterval(() => { void pollOnce(); }, intervalMs);
}

export function stopImapPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
