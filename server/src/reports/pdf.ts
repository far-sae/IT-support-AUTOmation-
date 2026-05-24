/**
 * PDF reports via pdfkit. Branded, sentence-case, no gradients.
 * Layout: a left-aligned wordmark, the report title, the date range and
 * generated-at line, then a simple table.
 */

import PDFDocument from "pdfkit";
import type { Response } from "express";

export interface PdfColumn {
  label: string;
  width: number; // in points
}

export interface PdfReportArgs {
  title: string;
  subtitle?: string;
  range: { from: Date | null; to: Date | null };
  columns: PdfColumn[];
  rows: string[][];
  summary?: Array<{ label: string; value: string }>;
}

const PAPER = "#F4F1E8";
const INK = "#17160E";
const MUTED = "#75736B";

export function streamPdfReport(res: Response, args: PdfReportArgs): void {
  const doc = new PDFDocument({ size: "A4", margin: 48 });

  res.setHeader("Content-Type", "application/pdf");
  doc.pipe(res);

  // ── Header ─────────────────────────────────────────────────────────
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(24).text("Relay");
  doc.moveDown(0.25);
  doc.font("Helvetica-Bold").fontSize(18).text(args.title);
  if (args.subtitle) {
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(args.subtitle);
  }

  const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(
    `Range: ${fmtDate(args.range.from)} → ${fmtDate(args.range.to)}   ·   Generated ${new Date().toISOString()}`,
  );
  doc.moveDown(1);

  // ── Summary box ────────────────────────────────────────────────────
  if (args.summary && args.summary.length > 0) {
    const startY = doc.y;
    const boxWidth = 499;
    doc.rect(48, startY, boxWidth, 32).fill(PAPER);
    doc.fillColor(INK);
    let x = 60;
    for (const item of args.summary) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(item.label.toUpperCase(), x, startY + 6);
      doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(item.value, x, startY + 14);
      x += boxWidth / args.summary.length;
    }
    doc.y = startY + 44;
    doc.x = 48;
  }

  // ── Table ──────────────────────────────────────────────────────────
  const tableX = 48;
  let y = doc.y + 8;

  // Header row
  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
  let x = tableX;
  for (const col of args.columns) {
    doc.text(col.label.toUpperCase(), x, y, { width: col.width });
    x += col.width;
  }
  y += 16;
  doc.moveTo(tableX, y - 4).lineTo(tableX + args.columns.reduce((s, c) => s + c.width, 0), y - 4)
    .strokeColor(INK).opacity(0.15).lineWidth(0.5).stroke().opacity(1);

  // Body rows
  doc.font("Helvetica").fontSize(9).fillColor(INK);
  for (const row of args.rows) {
    if (y > 760) {
      doc.addPage();
      y = 48;
    }
    let cx = tableX;
    let rowHeight = 0;
    for (let i = 0; i < args.columns.length; i += 1) {
      const col = args.columns[i];
      const cell = row[i];
      if (!col) continue;
      const safeCell = cell ?? "";
      const measured = doc.heightOfString(safeCell, { width: col.width });
      rowHeight = Math.max(rowHeight, measured);
      doc.text(safeCell, cx, y, { width: col.width });
      cx += col.width;
    }
    y += Math.max(14, rowHeight + 4);
    doc.moveTo(tableX, y - 2).lineTo(tableX + args.columns.reduce((s, c) => s + c.width, 0), y - 2)
      .strokeColor(INK).opacity(0.06).lineWidth(0.5).stroke().opacity(1);
  }

  doc.end();
}
