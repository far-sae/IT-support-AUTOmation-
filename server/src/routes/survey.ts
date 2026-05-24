import { Router } from "express";
import { z } from "zod";

import { AppError, asyncHandler } from "../errors.js";
import { getSurveyByToken, submitSurvey } from "../survey/survey.js";
import { emit } from "../realtime/socket.js";

export const surveyRouter = Router();

surveyRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const token = req.params.token;
    if (!token) throw new AppError(400, "Missing token", "BAD_REQUEST");
    const status = await getSurveyByToken(token);
    res.json(status);
  }),
);

const submitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

surveyRouter.post(
  "/:token",
  asyncHandler(async (req, res) => {
    const token = req.params.token;
    if (!token) throw new AppError(400, "Missing token", "BAD_REQUEST");

    const body = submitSchema.parse(req.body);
    const status = await submitSurvey(token, body.rating, body.comment);
    emit("analytics:updated", { reason: "survey-submitted" });
    res.json(status);
  }),
);
