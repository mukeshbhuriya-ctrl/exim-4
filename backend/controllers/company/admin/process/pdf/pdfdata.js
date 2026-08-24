const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { Combination } = require("#utils/combination");
const { HeaderMapping, sanitizeHeaderMapping } = require("#utils/headerMapping");
const {
  getSalesAndPdfRoundMappings,
  buildPdfRowsWithMappingRoundAndCombinations,
} = require("../1_process_logic/round");
const { processPdf, buildJsonOutput } = require("./pdf_extract_data");
const { processAndSaveJvPdfRows } = require("./jvpdfdata");
const { exportVarToExcelBuffer } = require("#utils/exportVarToExcelBuffer");
const { tryInsertUniqueShippingBill, normalizeSbNoForMatch } = require("#utils/shippingBillNo");
const { reconcileStoredPendingEbrcRows } = require("#utils/ebrcBulkDownloadData");
const { expandUploadFilesToPdfFiles } = require("#utils/emlPdfAttachments");

const pdfUploadRowSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    uploadId: { type: String, required: true, index: true },
    pdfUploadId: { type: String, required: true, index: true },
    pdfRowId: { type: String, required: true, unique: true, index: true },
    pdfRowIndex: { type: Number, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    /** Manual disposition: available | exception | ignored */
    rowStatus: {
      type: String,
      enum: ["available", "exception", "ignored"],
      default: "available",
      trim: true,
      index: true,
    },
    source: {
      pdfOriginalName: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

pdfUploadRowSchema.index({ companyId: 1, "data.SB No": 1 });

const PdfUploadRow =
  mongoose.models.PdfUploadRow ||
  mongoose.model("PdfUploadRow", pdfUploadRowSchema);

function extractSbNoFromPdfFileResponse(fileResponse) {
  const fr = fileResponse && typeof fileResponse === "object" ? fileResponse : {};
  const top = String(fr["SB No"] ?? "").trim();
  if (top) return top;

  const rows = Array.isArray(fr.data) ? fr.data : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const sb = String(row["SB No"] ?? "").trim();
    if (sb) return sb;
  }
  return "";
}

async function pdfSbNoAlreadyStored(companyId, sbNo) {
  const raw = String(sbNo ?? "").trim();
  const want = normalizeSbNoForMatch(raw);
  if (!want) return { exists: false, sbNo: "" };

  const oid = new mongoose.Types.ObjectId(String(companyId));
  const existingValues = await PdfUploadRow.distinct("data.SB No", {
    companyId: oid,
    "data.SB No": { $nin: [null, ""] },
  });

  for (const existing of existingValues) {
    if (normalizeSbNoForMatch(existing) === want) {
      return { exists: true, sbNo: String(existing).trim() };
    }
  }
  return { exists: false, sbNo: raw };
}

function hasStoredValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function removeEmptyFields(row) {
  const source = row && typeof row === "object" && !Array.isArray(row) ? row : {};
  const cleaned = {};
  for (const [key, value] of Object.entries(source)) {
    if (hasStoredValue(value)) cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Extract flattened line-item rows from one PDF buffer (same shape as stored PdfUploadRow.data).
 */
async function extractPdfRowsFromBuffer(buffer, originalname = "upload.pdf") {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-extract-"));
  const safeName = `${crypto.randomUUID()}-${originalname || "upload.pdf"}`;
  const tempPdfPath = path.join(tempRoot, safeName);
  try {
    await fs.writeFile(tempPdfPath, buffer);
    const extracted = await processPdf(tempPdfPath);
    const built = buildJsonOutput(tempPdfPath, extracted, originalname || "upload.pdf");
    const fileResponse = {
      ...built,
      data: (built.data || []).map(removeEmptyFields),
    };
    return fileResponse.data || [];
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Core PDF ingest used by multipart upload and Gmail mailbox fetch.
 *
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @param {{ buffer: Buffer, originalname?: string, gmailMessageId?: string }[]} pdfFiles
 */
async function processUploadedPdfFiles(companyId, pdfFiles) {
  if (!companyId) {
    throw new Error("Company admin access is required.");
  }
  if (!Array.isArray(pdfFiles) || !pdfFiles.length) {
    throw new Error("At least one PDF file is required.");
  }

  const combinationDoc = await Combination.findOne({ companyId });
  const pdfCombination = Array.isArray(combinationDoc?.pdfCombination)
    ? combinationDoc.pdfCombination
    : [];
  const pdfCombinationDefs = pdfCombination
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  if (!combinationDoc || !pdfCombinationDefs.length) {
    throw new Error(
      "PDF combination is not configured for this company. Create a combination with at least one PDF field rule before uploading."
    );
  }

  const headerMappingDoc = await HeaderMapping.findOne({ companyId });
  const headerMapping = sanitizeHeaderMapping(headerMappingDoc);
  const pdfheadermaping =
    headerMapping?.pdf && typeof headerMapping.pdf === "object"
      ? headerMapping.pdf
      : {};
  const { pdfround } = getSalesAndPdfRoundMappings(headerMapping);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-upload-"));
  const results = [];
  const errors = [];
  const skipped = [];
  const uploadId = crypto.randomUUID();
  let totalStoredRows = 0;
  const seenSbNosInBatch = new Set();

  try {
    for (const file of pdfFiles) {
      const pdfUploadId = crypto.randomUUID();
      const safeName = `${crypto.randomUUID()}-${file.originalname || "upload.pdf"}`;
      const tempPdfPath = path.join(tempRoot, safeName);

      try {
        await fs.writeFile(tempPdfPath, file.buffer);
        const extracted = await processPdf(tempPdfPath);
        const built = buildJsonOutput(
          tempPdfPath,
          extracted,
          file.originalname || safeName
        );
        const fileResponse = {
          ...built,
          data: (built.data || []).map(removeEmptyFields),
        };

        const sbNo = extractSbNoFromPdfFileResponse(fileResponse);
        const sbNoKey = normalizeSbNoForMatch(sbNo);
        if (sbNoKey) {
          if (seenSbNosInBatch.has(sbNoKey)) {
            skipped.push({
              source_pdf: file.originalname || safeName,
              sbNo,
              reason: "duplicate_sb_no_in_request",
              gmailMessageId: file.gmailMessageId || null,
            });
            continue;
          }

          const { exists, sbNo: existingSbNo } = await pdfSbNoAlreadyStored(companyId, sbNo);
          if (exists) {
            skipped.push({
              source_pdf: file.originalname || safeName,
              sbNo: existingSbNo || sbNo,
              reason: "duplicate_sb_no",
              data_already_stored: true,
              gmailMessageId: file.gmailMessageId || null,
            });
            continue;
          }
          seenSbNosInBatch.add(sbNoKey);
        }

        const rowsWithCombinations = buildPdfRowsWithMappingRoundAndCombinations(
          fileResponse.data || [],
          pdfheadermaping,
          pdfround,
          pdfCombinationDefs
        ).map(removeEmptyFields);

        const jvPdfResult = await processAndSaveJvPdfRows({
          companyId,
          pdfRows: rowsWithCombinations,
          sourceFileName: file.originalname || safeName,
        });

        // SB dedup already passed — store all line items for this shipping bill.
        const rowsForPdfData = rowsWithCombinations;

        const rowDocs = rowsForPdfData.map((row, idx) => ({
          companyId,
          uploadId,
          pdfUploadId,
          pdfRowId: crypto.randomUUID(),
          pdfRowIndex: idx,
          data: row,
          source: { pdfOriginalName: file.originalname || safeName },
        }));

        const shippingBillNoResult = await tryInsertUniqueShippingBill(companyId, fileResponse, {
          source: "pdf",
          pdfRowId: rowDocs[0]?.pdfRowId || "",
        });
        await reconcileStoredPendingEbrcRows(companyId, [fileResponse]);

        let fileStoredRows = 0;
        if (rowDocs.length) {
          const inserted = await PdfUploadRow.insertMany(rowDocs, { ordered: false });
          fileStoredRows = inserted.length;
          totalStoredRows += fileStoredRows;
        }

        results.push({
          ...fileResponse,
          data: rowsWithCombinations,
          jv_saved_rows: jvPdfResult.saved_rows,
          jv_rows: jvPdfResult.rows,
          jv_summary: {
            grouped_rows: jvPdfResult.grouped_rows,
            skipped_duplicate_in_input: jvPdfResult.skipped_duplicate_in_input,
            skipped_existing_in_collection: jvPdfResult.skipped_existing_in_collection,
            new_inv_count: jvPdfResult.newInvKeys?.length ?? 0,
          },
          pdfUploadId,
          stored_rows: fileStoredRows,
          shippingBillNo: shippingBillNoResult,
          gmailMessageId: file.gmailMessageId || null,
        });
      } catch (err) {
        errors.push({
          source_pdf: file.originalname || safeName,
          gmailMessageId: file.gmailMessageId || null,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  return {
    uploadId,
    total_files: pdfFiles.length,
    processed_files: results.length,
    skipped_files: skipped.length,
    failed_files: errors.length,
    stored_rows: totalStoredRows,
    files: results,
    skipped,
    errors,
  };
}

async function uploadMultiplePdf(req, res) {
  const uploadedFiles = [
    ...(req.files?.pdfFile || []),
    ...(req.files?.pdfFiles || []),
    ...(req.files?.emlFile || []),
    ...(req.files?.emlFiles || []),
    ...(req.files?.msgFile || []),
    ...(req.files?.msgFiles || []),
  ];

  if (!uploadedFiles.length) {
    return res.status(400).json({
      success: false,
      message:
        "Missing file field `pdfFile`, `pdfFiles`, `emlFile`, `emlFiles`, `msgFile`, or `msgFiles`.",
    });
  }
  if (!req.companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  try {
    const { pdfFiles, mailSkipped } = await expandUploadFilesToPdfFiles(uploadedFiles);

    if (!pdfFiles.length) {
      const onlyMailWithoutPdf =
        mailSkipped.length > 0 &&
        mailSkipped.every((entry) => entry.reason === "no_pdf_attachment");
      return res.status(400).json({
        success: false,
        message: onlyMailWithoutPdf
          ? "No PDF attachment found in the uploaded EML/MSG file(s)."
          : "At least one PDF file is required.",
        data: { mail_skipped: mailSkipped, eml_skipped: mailSkipped },
      });
    }

    const data = await processUploadedPdfFiles(req.companyId, pdfFiles);
    if (mailSkipped.length) {
      data.mail_skipped = mailSkipped;
      data.eml_skipped = mailSkipped;
    }

    const allOk = data.errors.length === 0;
    let message = "PDF files processed successfully.";
    if (!allOk) {
      message = "Some PDF files failed to process.";
    } else if (data.skipped_files > 0 && data.processed_files === 0) {
      message = "All PDF file(s) were skipped (SB No already stored in database).";
    } else if (data.skipped_files > 0) {
      message = "PDF files processed; some were skipped as duplicate SB No.";
    } else if (mailSkipped.length > 0) {
      message = "PDF files extracted from mail attachments and processed successfully.";
    }

    return res.status(200).json({
      success: allOk,
      message,
      data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("combination") ? 400 : message.includes("required") ? 400 : 500;
    return res.status(status).json({
      success: false,
      message,
    });
  }
}

function docToExcelRow(doc) {
  const data =
    doc.data && typeof doc.data === "object" && !Array.isArray(doc.data)
      ? doc.data
      : {};

  const meta = {
    pdfRowId: doc.pdfRowId,
    pdfRowIndex: doc.pdfRowIndex,
    uploadId: doc.uploadId,
    pdfUploadId: doc.pdfUploadId,
    pdfOriginalName: doc.source?.pdfOriginalName ?? "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : "",
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : "",
  };

  return { ...meta, ...data };
}

function parsePdfDataPagination(query) {
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 500;

  let page = parseInt(String(query.page ?? "1"), 10);
  let limit = parseInt(String(query.limit ?? String(DEFAULT_LIMIT)), 10);

  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

/** All stored PDF rows for the company as JSON (not a file download). Query: page (default 1), limit (default 50, max 500). */
async function getAllPdfData(req, res, next) {
  try {
    const companyId = req.companyId;

    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const PdfUploadRow = mongoose.models.PdfUploadRow;

    if (!PdfUploadRow) {
      return res.status(500).json({
        success: false,
        message: "PdfUploadRow model is not registered.",
      });
    }

    const { page, limit, skip } = parsePdfDataPagination(req.query || {});
    const filter = { companyId };

    const [total, docs] = await Promise.all([
      PdfUploadRow.countDocuments(filter),
      PdfUploadRow.find(filter)
        .sort({ createdAt: 1, pdfUploadId: 1, pdfRowIndex: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages,
      count: docs.length,
      data: docs.map((doc) =>
        doc.data !== undefined &&
        doc.data !== null &&
        typeof doc.data === "object" &&
        !Array.isArray(doc.data)
          ? doc.data
          : {}
      ),
    });
  } catch (err) {
    return next(err);
  }
}

async function getPdfDataInToExcel(req, res, next) {
  try {
    const companyId = req.companyId;

    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const PdfUploadRow = mongoose.models.PdfUploadRow;

    if (!PdfUploadRow) {
      return res.status(500).json({
        success: false,
        message: "PdfUploadRow model is not registered.",
      });
    }

    const docs = await PdfUploadRow.find({ companyId })
      .sort({ createdAt: 1, pdfUploadId: 1, pdfRowIndex: 1 })
      .lean();

    const rows = docs.map(docToExcelRow);
    const buffer = exportVarToExcelBuffer(rows, "PdfUploadRows");

    const safeId = String(companyId).replace(/[^a-zA-Z0-9-_]/g, "");
    const filename = `company-pdf-rows-${safeId}-${Date.now()}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    return res.status(200).send(buffer);
  } catch (err) {
    return next(err);
  }
}
















module.exports = {
  getAllPdfData,
  getPdfDataInToExcel,
  uploadMultiplePdf,
  processUploadedPdfFiles,
  extractPdfRowsFromBuffer,
};
