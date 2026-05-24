/**
 * Attachments — multer-backed upload to S3-compatible storage,
 * list per-ticket, and presigned download URLs (short-lived, role-scoped).
 *
 * Two routers are exported:
 *   • ticketAttachmentsRouter  — mounted under /api/tickets/:ticketId/attachments
 *   • attachmentsRouter        — mounted at /api/attachments (for /:id/download)
 */

import { Router } from "express";
import multer from "multer";
import { Role } from "@prisma/client";

import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth } from "../auth/middleware.js";
import {
  makeStorageKey,
  presignDownload,
  storageEnabled,
  uploadObject,
} from "../storage/s3.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

async function loadTicketScoped(ticketId: string, me: Express.User) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
  if (me.role === Role.EMPLOYEE) {
    const isMine = ticket.submitterUserId === me.id || ticket.submitterEmail === me.email;
    if (!isMine) throw new AppError(403, "You can't view that ticket", "FORBIDDEN");
  }
  return ticket;
}

// ─── /api/tickets/:ticketId/attachments ───────────────────────────────

export const ticketAttachmentsRouter = Router({ mergeParams: true });
ticketAttachmentsRouter.use(requireAuth);

ticketAttachmentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const ticketId = (req.params as { ticketId?: string }).ticketId;
    if (!ticketId) throw new AppError(400, "Missing ticketId", "BAD_REQUEST");
    await loadTicketScoped(ticketId, me);

    const attachments = await prisma.attachment.findMany({
      where: { ticketId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, fileName: true, mimeType: true, sizeBytes: true,
        createdAt: true, uploadedById: true,
      },
    });
    res.json({ attachments });
  }),
);

ticketAttachmentsRouter.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!storageEnabled()) {
      throw new AppError(503, "Object storage is not configured", "STORAGE_DISABLED");
    }
    const me = req.user!;
    const ticketId = (req.params as { ticketId?: string }).ticketId;
    if (!ticketId) throw new AppError(400, "Missing ticketId", "BAD_REQUEST");
    await loadTicketScoped(ticketId, me);

    const file = req.file;
    if (!file) throw new AppError(400, "Missing file", "BAD_REQUEST");
    if (file.size > MAX_FILE_BYTES) {
      throw new AppError(413, `File exceeds the ${MAX_FILE_BYTES} byte limit`, "FILE_TOO_LARGE");
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new AppError(415, `Unsupported file type: ${file.mimetype}`, "UNSUPPORTED_MEDIA");
    }

    const storageKey = makeStorageKey(ticketId, file.originalname);
    await uploadObject({
      key: storageKey,
      body: file.buffer,
      contentType: file.mimetype,
    });

    const attachment = await prisma.attachment.create({
      data: {
        organizationId: me.organizationId,
        ticketId,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        uploadedById: me.id,
      },
      select: {
        id: true, fileName: true, mimeType: true, sizeBytes: true,
        createdAt: true, uploadedById: true,
      },
    });

    res.status(201).json({ attachment });
  }),
);

// ─── /api/attachments/:id/download ────────────────────────────────────

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth);

attachmentsRouter.get(
  "/:id/download",
  asyncHandler(async (req, res) => {
    if (!storageEnabled()) {
      throw new AppError(503, "Object storage is not configured", "STORAGE_DISABLED");
    }
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");

    const attachment = await prisma.attachment.findUnique({
      where: { id },
      include: { ticket: { select: { id: true, submitterUserId: true, submitterEmail: true } } },
    });
    if (!attachment) throw new AppError(404, "Attachment not found", "NOT_FOUND");

    const me = req.user!;
    if (me.role === Role.EMPLOYEE) {
      const isMine =
        attachment.ticket.submitterUserId === me.id ||
        attachment.ticket.submitterEmail === me.email;
      if (!isMine) throw new AppError(403, "You can't view that attachment", "FORBIDDEN");
    }

    const url = await presignDownload(attachment.storageKey, 60 * 5);
    res.json({
      url,
      expiresIn: 60 * 5,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    });
  }),
);
