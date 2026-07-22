import { tool } from "ai";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { sanitizePdfFilename, uploadChatPdf } from "../lib/storage/pdfs.ts";

/** ~600+ chars/section × 5 sections ≈ multi-page report body. */
const MIN_SECTIONS = 5;
const MAX_SECTIONS = 25;
const MIN_SECTION_BODY = 800;
const MAX_SECTION_BODY = 12_000;
const MAX_TOTAL_BODY = 80_000;

const sectionSchema = z.object({
  heading: z.string().trim().min(1).max(200),
  body: z
    .string()
    .trim()
    .min(
      MIN_SECTION_BODY,
      `Each section body must be at least ${MIN_SECTION_BODY} characters (detailed multi-paragraph prose)`,
    )
    .max(MAX_SECTION_BODY),
});

const sourceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.string().trim().url().max(2000),
});

export const createPdfInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().min(1).max(300).optional(),
    sections: z
      .array(sectionSchema)
      .min(MIN_SECTIONS, `Reports require at least ${MIN_SECTIONS} detailed sections`)
      .max(MAX_SECTIONS),
    sources: z.array(sourceSchema).min(1).max(30),
    filename: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    const totalBody = value.sections.reduce((sum, s) => sum + s.body.length, 0);
    if (totalBody > MAX_TOTAL_BODY) {
      ctx.addIssue({
        code: "custom",
        message: `Total section body text must be at most ${MAX_TOTAL_BODY} characters`,
        path: ["sections"],
      });
    }
  });

export type CreatePdfInput = z.infer<typeof createPdfInputSchema>;

export const createPdfOutputSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1),
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  pages: z.number().int().positive(),
});

export type CreatePdfOutput = z.infer<typeof createPdfOutputSchema>;

export type PdfCreatedMeta = Pick<CreatePdfOutput, "url" | "filename" | "path">;

function renderPdfBuffer(input: CreatePdfInput): Promise<{ buffer: Buffer; pages: number }> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 54,
      size: "LETTER",
      bufferPages: true,
      info: {
        Title: input.title,
        Creator: "micromanus",
      },
    });

    const chunks: Buffer[] = [];
    // PDFKit clears bufferedPageRange() after end() — capture count before ending.
    let pages = 0;
    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    doc.on("end", () => {
      resolve({ buffer: Buffer.concat(chunks), pages });
    });
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.margins.right;
    const usableWidth = doc.page.width - left - right;
    const top = doc.page.margins.top;

    // --- Title page ---
    doc.moveDown(6);
    doc.fontSize(22).font("Helvetica-Bold").text(input.title, {
      width: usableWidth,
      align: "center",
    });
    doc.moveDown(0.8);
    if (input.subtitle) {
      doc.fontSize(12).font("Helvetica").fillColor("#333333").text(input.subtitle, {
        width: usableWidth,
        align: "center",
      });
      doc.fillColor("#000000");
      doc.moveDown(0.6);
    }
    doc
      .fontSize(11)
      .font("Helvetica")
      .fillColor("#555555")
      .text(`Generated ${new Date().toISOString()}`, {
        width: usableWidth,
        align: "center",
      });
    doc.moveDown(0.4);
    doc.text("micromanus briefing report", { width: usableWidth, align: "center" });
    doc.fillColor("#000000");

    // --- Table of contents ---
    doc.addPage();
    doc.fontSize(16).font("Helvetica-Bold").text("Contents", { width: usableWidth });
    doc.moveDown(1);
    for (const [i, section] of input.sections.entries()) {
      doc
        .fontSize(11)
        .font("Helvetica")
        .text(`${i + 1}. ${section.heading}`, { width: usableWidth });
      doc.moveDown(0.35);
    }
    doc.moveDown(0.5);
    doc.fontSize(11).text(`${input.sections.length + 1}. Sources`, { width: usableWidth });

    // --- One section per page (continues onto following pages if long) ---
    for (const [i, section] of input.sections.entries()) {
      doc.addPage();
      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor("#666666")
        .text(`Section ${i + 1} of ${input.sections.length}`, left, top, {
          width: usableWidth,
          lineBreak: false,
        });
      doc.fillColor("#000000");
      doc.moveDown(1.2);
      doc.fontSize(14).font("Helvetica-Bold").text(section.heading, { width: usableWidth });
      doc.moveDown(0.6);
      doc.fontSize(11).font("Helvetica").text(section.body, {
        width: usableWidth,
        align: "left",
        lineGap: 3,
      });
    }

    // --- Sources (from Tavily via web_search) ---
    doc.addPage();
    doc.fontSize(16).font("Helvetica-Bold").text("Sources", { width: usableWidth });
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#555555")
      .text("Citations from live web search (Tavily).", { width: usableWidth });
    doc.fillColor("#000000");
    doc.moveDown(0.8);

    for (const [i, source] of input.sources.entries()) {
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text(`${i + 1}. ${source.title}`, { width: usableWidth });
      doc.moveDown(0.15);
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#1a0dab")
        .text(source.url, { width: usableWidth, link: source.url });
      doc.fillColor("#000000");
      doc.moveDown(0.55);
    }

    // Stamp footers without triggering PDFKit auto page-breaks in the bottom margin.
    const range = doc.bufferedPageRange();
    pages = Math.max(range.count, 1);
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const oldBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const bottom = doc.page.height - oldBottom / 2;
      doc
        .fontSize(8)
        .fillColor("#666666")
        .text(`Page ${i + 1} of ${range.count}`, left, bottom, {
          width: usableWidth,
          align: "center",
          lineBreak: false,
        });
      doc.page.margins.bottom = oldBottom;
    }
    doc.fillColor("#000000");
    doc.end();
  });
}

export type CreatePdfToolOptions = {
  userId: string;
  chatId: string;
  /** Called when a PDF is successfully uploaded (orchestration emits SSE pdf_ready). */
  onCreated?: (meta: PdfCreatedMeta) => void;
};

/**
 * PDF creation tool for AI SDK tool-calling.
 * Does not write to Postgres — returns a signed Storage URL only.
 * At most one upload per tool instance (per chat completion request).
 */
export function createPdfTool(options: CreatePdfToolOptions) {
  const { userId, chatId, onCreated } = options;
  let cached: CreatePdfOutput | undefined;

  return tool({
    description:
      "Create a detailed multi-page PDF briefing report. " +
      `Required: at least ${MIN_SECTIONS} sections, each with ≥${MIN_SECTION_BODY} characters of multi-paragraph analysis (not bullet stubs). ` +
      "Required: sources array with title+url taken from prior web_search (Tavily) results — do not invent URLs. " +
      "Use after 2+ web_search calls covering different angles of the topic. " +
      "Call at most once per assistant reply — repeated calls return the same file. " +
      "Layout includes title page, contents, one section start per page, and a sources page — aim for a thorough 5+ page report. " +
      "Returns a temporary download URL.",
    inputSchema: createPdfInputSchema,
    execute: async (input) => {
      if (cached) {
        console.log(
          `pdf tool skipped duplicate upload chatId=${chatId} path=${cached.path} pages=${cached.pages}`,
        );
        return cached;
      }

      try {
        const filename = sanitizePdfFilename(input.filename);
        const { buffer: pdfBytes, pages } = await renderPdfBuffer(input);
        const uploaded = await uploadChatPdf({
          userId,
          chatId,
          filename,
          bytes: pdfBytes,
        });

        const parsed = createPdfOutputSchema.parse({ ...uploaded, pages });
        cached = parsed;
        console.log(
          `pdf tool invoked chatId=${chatId} bytes=${parsed.bytes} pages=${parsed.pages} path=${parsed.path} sections=${input.sections.length} sources=${input.sources.length}`,
        );
        onCreated?.({ url: parsed.url, filename: parsed.filename, path: parsed.path });
        return parsed;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "pdf_failed";
        console.error(`pdf tool failed chatId=${chatId} message=${msg}`);
        throw err;
      }
    },
  });
}
