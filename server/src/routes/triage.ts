import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../errors.js";
import { requireAuth } from "../auth/middleware.js";
import { triage } from "../triage.js";

export const triageRouter = Router();
triageRouter.use(requireAuth);

const previewSchema = z.object({
  description: z.string().min(1).max(5000),
});

triageRouter.post(
  "/preview",
  asyncHandler(async (req, res) => {
    const body = previewSchema.parse(req.body);
    const result = triage(body.description);
    res.json(result);
  }),
);
