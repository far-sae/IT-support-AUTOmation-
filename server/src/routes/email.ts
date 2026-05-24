import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../errors.js";
import { ingestEmail } from "../email/ingest.js";

export const emailRouter = Router();

const inboundSchema = z.object({
  orgSlug: z.string().min(1),
  from: z.string().email(),
  name: z.string().max(120).optional(),
  subject: z.string().max(300).optional(),
  body: z.string().min(1).max(20000),
});

// Public webhook-style endpoint so dev can simulate inbound email without an
// IMAP mailbox. In production this would sit behind a webhook secret.
// `orgSlug` selects which tenant the message lands in.
emailRouter.post(
  "/inbound",
  asyncHandler(async (req, res) => {
    const body = inboundSchema.parse(req.body);
    const result = await ingestEmail(body);
    res.status(201).json(result);
  }),
);
