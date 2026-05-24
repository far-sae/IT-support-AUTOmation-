/**
 * Satisfaction survey service.
 *
 * Tenancy notes — this module is called from two contexts:
 *   • createSurveyForTicket() runs from inside the ticket-resolve PATCH handler,
 *     which already has the org's tenant context active. We can use `prisma`.
 *   • getSurveyByToken() / submitSurvey() are called from the PUBLIC routes,
 *     so there is no tenant context yet. We look the survey up via the
 *     unscoped client (the token is globally unique), then enter the row's
 *     tenant context before doing any follow-up work.
 */

import { nanoid } from "nanoid";

import { prisma, basePrismaUnscoped } from "../db.js";
import { AppError } from "../errors.js";
import { runWithTenant } from "../tenant/context.js";
import { sendMail } from "../email/mailer.js";
import { surveyEmail } from "../email/templates.js";

export interface SurveyStatus {
  refCode: string;
  status: "PENDING" | "SUBMITTED";
  rating: number | null;
  comment: string | null;
  sentAt: Date;
  submittedAt: Date | null;
}

/**
 * Create the survey row for a freshly-resolved ticket (idempotent — if one
 * already exists, we reuse it). Returns the token. Sends the email best-effort.
 */
export async function createSurveyForTicket(ticketId: string): Promise<string> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");

  let survey = await prisma.surveyResponse.findUnique({ where: { ticketId } });
  if (!survey) {
    survey = await prisma.surveyResponse.create({
      data: {
        organizationId: ticket.organizationId,
        ticketId,
        token: nanoid(24),
        sentAt: new Date(),
      },
    });
  }

  try {
    const built = surveyEmail({
      submitterName: ticket.submitterName,
      refCode: ticket.refCode,
      token: survey.token,
    });
    await sendMail({ to: ticket.submitterEmail, ...built });
  } catch (err) {
    console.error("[survey] failed to send survey email:", err);
  }

  return survey.token;
}

/** Public route entry — no tenant context yet. */
export async function getSurveyByToken(token: string): Promise<SurveyStatus> {
  const survey = await basePrismaUnscoped.surveyResponse.findUnique({
    where: { token },
    include: { ticket: { select: { refCode: true } } },
  });
  if (!survey) throw new AppError(404, "Survey not found", "NOT_FOUND");

  return {
    refCode: survey.ticket.refCode,
    status: survey.submittedAt ? "SUBMITTED" : "PENDING",
    rating: survey.rating,
    comment: survey.comment,
    sentAt: survey.sentAt,
    submittedAt: survey.submittedAt,
  };
}

/** Public route entry — enters the row's tenant context before updating. */
export async function submitSurvey(
  token: string,
  rating: number,
  comment: string | undefined,
): Promise<SurveyStatus> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError(400, "Rating must be an integer between 1 and 5", "BAD_REQUEST");
  }

  const survey = await basePrismaUnscoped.surveyResponse.findUnique({
    where: { token },
    include: { ticket: { select: { refCode: true } } },
  });
  if (!survey) throw new AppError(404, "Survey not found", "NOT_FOUND");
  if (survey.submittedAt) {
    throw new AppError(410, "Survey already submitted", "ALREADY_SUBMITTED");
  }

  return runWithTenant(survey.organizationId, async () => {
    const updated = await prisma.surveyResponse.update({
      where: { token },
      data: { rating, comment: comment ?? null, submittedAt: new Date() },
    });
    return {
      refCode: survey.ticket.refCode,
      status: "SUBMITTED" as const,
      rating: updated.rating,
      comment: updated.comment,
      sentAt: updated.sentAt,
      submittedAt: updated.submittedAt,
    };
  });
}
