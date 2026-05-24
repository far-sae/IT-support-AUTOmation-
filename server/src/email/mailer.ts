/**
 * Outbound SMTP via nodemailer.
 *
 * In dev the default config points at the Mailpit container (host "mailpit",
 * port 1025) so every sent message lands in Mailpit's web UI at :8025.
 * If SMTP_HOST is unset we no-op (and log) so the server still works
 * without an SMTP server attached.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.js";

export interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 1025,
    secure: false,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });
  return transporter;
}

export async function sendMail(args: SendArgs): Promise<{ delivered: boolean }> {
  const t = getTransporter();
  if (!t) {
    // No transport configured — log so dev still sees the outbound flow.
    console.log(`[mailer] (SMTP not configured) → ${args.to}  «${args.subject}»`);
    return { delivered: false };
  }

  await t.sendMail({
    from: env.SMTP_FROM,
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
    replyTo: args.replyTo,
  });
  return { delivered: true };
}

export function smtpEnabled(): boolean {
  return Boolean(env.SMTP_HOST);
}
