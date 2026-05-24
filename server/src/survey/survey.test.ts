import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const surveyFindUnique = vi.fn();
const surveyCreate = vi.fn();
const surveyUpdate = vi.fn();
const ticketFindUnique = vi.fn();

// Both clients share the same underlying mock fns so the public-route
// flows (which use basePrismaUnscoped to look up by global token) and the
// internal flows (which use the tenancy-scoped client) end up exercising
// the same assertions.
const prismaShape = {
  surveyResponse: {
    findUnique: (a: unknown) => surveyFindUnique(a),
    create: (a: unknown) => surveyCreate(a),
    update: (a: unknown) => surveyUpdate(a),
  },
  ticket: {
    findUnique: (a: unknown) => ticketFindUnique(a),
  },
};

vi.mock("../db.js", () => ({
  prisma: prismaShape,
  basePrismaUnscoped: prismaShape,
}));

vi.mock("../tenant/context.js", () => ({
  // The submitSurvey test path enters runWithTenant — we invoke the body
  // synchronously inline so the test doesn't need an actual ALS.
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

vi.mock("../email/mailer.js", () => ({
  sendMail: vi.fn().mockResolvedValue({ delivered: true }),
}));

const { createSurveyForTicket, getSurveyByToken, submitSurvey } = await import("./survey.js");

beforeEach(() => {
  surveyFindUnique.mockReset();
  surveyCreate.mockReset();
  surveyUpdate.mockReset();
  ticketFindUnique.mockReset();
});

describe("getSurveyByToken", () => {
  it("404s for an unknown token", async () => {
    surveyFindUnique.mockResolvedValueOnce(null);
    await expect(getSurveyByToken("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("returns PENDING for a sent-but-not-submitted survey", async () => {
    surveyFindUnique.mockResolvedValueOnce({
      ticket: { refCode: "INC-1042" },
      rating: null,
      comment: null,
      sentAt: new Date("2026-05-20T12:00:00Z"),
      submittedAt: null,
    });
    const status = await getSurveyByToken("good-token");
    expect(status.refCode).toBe("INC-1042");
    expect(status.status).toBe("PENDING");
    expect(status.rating).toBeNull();
  });

  it("returns SUBMITTED for an already-submitted survey", async () => {
    surveyFindUnique.mockResolvedValueOnce({
      ticket: { refCode: "INC-1042" },
      rating: 5, comment: "great",
      sentAt: new Date(), submittedAt: new Date(),
    });
    const status = await getSurveyByToken("good-token");
    expect(status.status).toBe("SUBMITTED");
    expect(status.rating).toBe(5);
  });
});

describe("submitSurvey", () => {
  it("rejects ratings outside 1-5", async () => {
    await expect(submitSurvey("t", 0, undefined)).rejects.toMatchObject({ status: 400 });
    await expect(submitSurvey("t", 6, undefined)).rejects.toMatchObject({ status: 400 });
    await expect(submitSurvey("t", 3.5, undefined)).rejects.toMatchObject({ status: 400 });
  });

  it("404s for an unknown token", async () => {
    surveyFindUnique.mockResolvedValueOnce(null);
    await expect(submitSurvey("nope", 5, undefined)).rejects.toMatchObject({ status: 404 });
  });

  it("410s when the token has already been used", async () => {
    surveyFindUnique.mockResolvedValueOnce({
      ticket: { refCode: "INC-1042" },
      submittedAt: new Date(),
    });
    await expect(submitSurvey("used", 4, undefined)).rejects.toMatchObject({
      status: 410,
      code: "ALREADY_SUBMITTED",
    });
  });

  it("accepts a valid rating and marks the survey submitted", async () => {
    surveyFindUnique.mockResolvedValueOnce({
      ticket: { refCode: "INC-1042" },
      submittedAt: null,
    });
    surveyUpdate.mockResolvedValueOnce({
      rating: 5, comment: "Sam was great",
      sentAt: new Date(), submittedAt: new Date(),
    });

    const status = await submitSurvey("good", 5, "Sam was great");
    expect(status.status).toBe("SUBMITTED");
    expect(status.rating).toBe(5);
    expect(status.comment).toBe("Sam was great");
    expect(surveyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { token: "good" },
      data: expect.objectContaining({ rating: 5, comment: "Sam was great" }),
    }));
  });
});

describe("createSurveyForTicket", () => {
  it("404s when the ticket doesn't exist", async () => {
    ticketFindUnique.mockResolvedValueOnce(null);
    await expect(createSurveyForTicket("ghost")).rejects.toMatchObject({ status: 404 });
  });

  it("reuses an existing survey instead of creating a duplicate", async () => {
    ticketFindUnique.mockResolvedValueOnce({
      id: "t1", refCode: "INC-1042", organizationId: "org_1",
      submitterName: "Jordan", submitterEmail: "j@relay.io",
    });
    surveyFindUnique.mockResolvedValueOnce({ token: "existing-token" });

    const token = await createSurveyForTicket("t1");
    expect(token).toBe("existing-token");
    expect(surveyCreate).not.toHaveBeenCalled();
  });

  it("creates a fresh survey when none exists", async () => {
    ticketFindUnique.mockResolvedValueOnce({
      id: "t1", refCode: "INC-1042", organizationId: "org_1",
      submitterName: "Jordan", submitterEmail: "j@relay.io",
    });
    surveyFindUnique.mockResolvedValueOnce(null);
    surveyCreate.mockResolvedValueOnce({ token: "fresh-token" });

    const token = await createSurveyForTicket("t1");
    expect(token).toBe("fresh-token");
    expect(surveyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ticketId: "t1" }),
    }));
  });
});
