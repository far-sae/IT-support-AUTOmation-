import { Router } from "express";

import { prisma } from "../db.js";
import { asyncHandler } from "../errors.js";
import { requireAuth } from "../auth/middleware.js";

export const kbRouter = Router();
kbRouter.use(requireAuth);

kbRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const articles = await prisma.kbArticle.findMany({
      orderBy: [{ helpedCount: "desc" }, { title: "asc" }],
    });

    if (!q) {
      res.json({ articles });
      return;
    }

    const needle = q.toLowerCase();
    const matches = articles.filter((a) => {
      if (a.title.toLowerCase().includes(needle)) return true;
      if (a.category.toLowerCase().includes(needle)) return true;
      if (a.summary.toLowerCase().includes(needle)) return true;
      const keywords = Array.isArray(a.keywords) ? (a.keywords as unknown as string[]) : [];
      return keywords.some((kw) => kw.toLowerCase().includes(needle));
    });

    res.json({ articles: matches });
  }),
);
