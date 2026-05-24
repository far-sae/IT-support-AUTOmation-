/**
 * Email templates. Each builder returns the data nodemailer needs.
 * Kept in one file so the wording can be tuned without hunting through routes.
 */

import { env } from "../env.js";

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

function html(body: string): string {
  return `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;color:#17160E;background:#F4F1E8;padding:24px"><div style="max-width:520px;margin:0 auto;background:#fff;padding:32px;border:1px solid rgba(23,22,14,.1);border-radius:16px">${body}<p style="margin-top:32px;font-size:12px;color:#17160E80">— Relay IT Support</p></div></body></html>`;
}

export function autoReplyEmail(args: {
  submitterName: string;
  refCode: string;
  category: string;
  priority: string;
  assignedTeam: string;
  slaTarget: string;
  autoReplyText: string;
}): BuiltEmail {
  return {
    subject: `We got your ticket — ${args.refCode}`,
    text: args.autoReplyText,
    html: html(`
      <p>Hi ${args.submitterName.split(" ")[0] || "there"},</p>
      <p>Thanks for reaching out — we've logged your request as <strong>${args.refCode}</strong> and the <strong>${args.assignedTeam}</strong> team has it.</p>
      <p><strong>Category:</strong> ${args.category}<br/>
         <strong>Priority:</strong> ${args.priority}<br/>
         <strong>Target response time:</strong> ${args.slaTarget}</p>
      <p>You'll hear back from us within the target response window. Replying to this email helps us resolve it faster — feel free to include screenshots, error messages, or when the issue started.</p>
    `),
  };
}

export function surveyEmail(args: {
  submitterName: string;
  refCode: string;
  token: string;
}): BuiltEmail {
  const url = `${env.CLIENT_URL}/survey/${args.token}`;
  return {
    subject: `How did we do? — ${args.refCode}`,
    text: [
      `Hi ${args.submitterName.split(" ")[0] || "there"},`,
      ``,
      `We've marked ${args.refCode} as resolved. If you've got 30 seconds, we'd love a quick rating:`,
      url,
      ``,
      `— Relay IT Support`,
    ].join("\n"),
    html: html(`
      <p>Hi ${args.submitterName.split(" ")[0] || "there"},</p>
      <p>We've marked <strong>${args.refCode}</strong> as resolved.</p>
      <p>If you've got 30 seconds, we'd love a quick rating:</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${url}" style="background:#17160E;color:#C8F23A;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600">Rate this resolution →</a>
      </p>
      <p style="font-size:12px;color:#17160E80">Or paste this link in your browser: ${url}</p>
    `),
  };
}

export function slaBreachEmail(args: {
  refCode: string;
  priority: string;
  assignedTeam: string;
  category: string;
  description: string;
  minutesOver: number;
}): BuiltEmail {
  const ticketUrl = `${env.CLIENT_URL}/tickets/${args.refCode}`;
  const overview = `${args.refCode} (${args.priority}) — ${args.minutesOver} minutes past SLA`;
  return {
    subject: `[SLA breached] ${overview}`,
    text: [
      overview,
      `Team: ${args.assignedTeam}`,
      `Category: ${args.category}`,
      ``,
      args.description,
      ``,
      `Open the ticket: ${ticketUrl}`,
    ].join("\n"),
    html: html(`
      <p style="font-size:14px;color:#b53737;font-weight:600;letter-spacing:.05em;text-transform:uppercase;margin:0 0 8px">SLA breach</p>
      <h2 style="margin:0 0 16px">${args.refCode} · ${args.priority}</h2>
      <p style="margin:0 0 12px">${args.minutesOver} minutes past the agreed response time.</p>
      <p style="margin:0 0 12px"><strong>Team:</strong> ${args.assignedTeam}<br/><strong>Category:</strong> ${args.category}</p>
      <p style="background:#F4F1E8;border-radius:8px;padding:16px;margin:16px 0">${args.description}</p>
      <p><a href="${ticketUrl}" style="color:#17160E;font-weight:600">Open the ticket →</a></p>
    `),
  };
}

export function commentNotifyEmail(args: {
  recipientName: string;
  refCode: string;
  authorName: string;
  body: string;
}): BuiltEmail {
  const ticketUrl = `${env.CLIENT_URL}/tickets/${args.refCode}`;
  return {
    subject: `New reply on ${args.refCode}`,
    text: [
      `Hi ${args.recipientName.split(" ")[0] || "there"},`,
      ``,
      `${args.authorName} replied on ${args.refCode}:`,
      ``,
      args.body,
      ``,
      `Continue the conversation: ${ticketUrl}`,
    ].join("\n"),
    html: html(`
      <p>Hi ${args.recipientName.split(" ")[0] || "there"},</p>
      <p><strong>${args.authorName}</strong> replied on <strong>${args.refCode}</strong>:</p>
      <p style="background:#F4F1E8;border-radius:8px;padding:16px;margin:16px 0">${args.body}</p>
      <p><a href="${ticketUrl}" style="color:#17160E;font-weight:600">Continue the conversation →</a></p>
    `),
  };
}
