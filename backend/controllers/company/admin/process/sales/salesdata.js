const crypto = require("node:crypto");
const mongoose = require("mongoose");
const nodeFetch = require("node-fetch");
const AbortController =
  typeof globalThis.AbortController === "function"
    ? globalThis.AbortController
    : nodeFetch?.AbortController;
const xlsx = require("xlsx");
const { Combination } = require("#utils/combination");
const { HeaderMapping, sanitizeHeaderMapping, normalizeFinancialYearBody } = require("#utils/headerMapping");
const {
  getSalesAndPdfRoundMappings,
  buildSalesRowsWithMappingRoundAndCombinations,
} = require("../1_process_logic/round");
const { exportVarToExcelBuffer } = require("#utils/exportVarToExcelBuffer");
const { processAndSaveJvSalesRows, getRowValueForSourceColumn, getJvDateSourceColumn, isEmptyJvDateValue, normalizeInv: normalizeJvInv } = require("./jvsalesdata");
const { cleanSalesRowsForCompany } = require("#utils/applySalesDataClean");
const { applyFinancialYearToRows } = require("#utils/financialYearFromDate");
const {
  filterSalesRowsByInvFinancialYear,
  extractInvFromSalesRow,
} = require("#utils/salesInvFinancialYearUniq");
const { loadConfigure, sanitizeAutomationSection } = require("#utils/configure");
const { validateRequestCompanyId } = require("#utils/requestCompanyId");
const {
  collectReportDatesFromPayload,
  markSalesSapDatesReceived,
  getMissingSalesSapDatesForRecentDays,
  formatDateKey,
} = require("#utils/salesSapReceiveLog");
const { upsertProcessStatus } = require("#utils/automationLog");
const {
  AUTOMATION_PROCESSES,
  PROCESS_STATUS,
} = require("../../../../../automation/constants");

const salesUploadRowSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    uploadId: { type: String, required: true, index: true },
    pdfUploadId: { type: String, required: true, index: true },
    rowId: { type: String, required: true, unique: true, index: true },
    rowIndex: { type: Number, required: true },
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
      salesOriginalName: { type: String, default: "" },
      pdfOriginalName: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

salesUploadRowSchema.index({ companyId: 1, "data.inv": 1, "data.financialYear": 1 });

const SalesUploadRow =
  mongoose.models.SalesUploadRow ||
  mongoose.model("SalesUploadRow", salesUploadRowSchema);

const SAP_RUN_REPORT_URL = String(
  process.env.SAP_RUN_REPORT_URL || "http://127.0.0.1:5000/run-report"
).trim();

/** 0 = wait indefinitely (no AbortController). Else cap in ms. */
function sapRunReportTimeoutMs() {
  const raw = process.env.SAP_RUN_REPORT_TIMEOUT_MS;
  if (raw === undefined || raw === null || String(raw).trim() === "") return 0;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Node's built-in fetch (Undici) uses a short default headersTimeout (~5m) → UND_ERR_HEADERS_TIMEOUT
 * for slow SAP endpoints. Use node-fetch for /run-report only (configurable timeout).
 */
function sapNodeFetchTimeoutMs(socketTimeoutMs, outboundTimeoutMs) {
  if (outboundTimeoutMs > 0) return outboundTimeoutMs;
  const raw = process.env.SAP_NODE_FETCH_TIMEOUT_MS;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const n = Number.parseInt(String(raw), 10);
    if (Number.isFinite(n) && n > 0) return n;
    if (Number.isFinite(n) && n === 0) return 0;
  }
  return socketTimeoutMs;
}

function normalizeSalesExcelValue(value) {
  if (typeof value !== "string") return value;

  const original = value;
  const trimmed = value.trim();
  if (!trimmed) return original;

  const quoteMatch = trimmed.match(/^(['"])(.*)\1$/);
  const text = quoteMatch ? quoteMatch[2].trim() : trimmed;

  if (text.includes("|")) {
    const normalizedParts = text
      .split("|")
      .map((part) => normalizeSalesExcelValue(part));
    const normalizedText = normalizedParts.join("|");
    return normalizedText === text && !quoteMatch ? original : normalizedText;
  }

  if (!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?$/.test(text)) {
    return original;
  }

  const withoutCommas = text.replace(/,/g, "");
  const zeroDecimalMatch = withoutCommas.match(/^([+-]?\d+)\.0+$/);
  if (zeroDecimalMatch) return zeroDecimalMatch[1];

  return text.includes(",") ? withoutCommas : original;
}

function normalizeSalesExcelRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      normalizeSalesExcelValue(value),
    ])
  );
}

function normalizeSalesExcelRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(normalizeSalesExcelRow);
}

function applyConfiguredFinancialYear(rows, headerMapping) {
  const { column } = normalizeFinancialYearBody(headerMapping?.financialYear || {});
  if (!column) return { rows, dateColumn: "" };
  return {
    rows: applyFinancialYearToRows(rows, column),
    dateColumn: column,
  };
}

async function isJvAutomationEnabled(companyId) {
  const configureDoc = await loadConfigure(companyId);
  const automation = sanitizeAutomationSection(configureDoc);
  return automation?.jv?.enabled === true;
}

/**
 * When JV automation is enabled: stamp jv_date_null / jv_data_create on each sales row.
 * jv_date_null = true when the jvProcess.date source column is empty.
 * jv_data_create = true when a jvsalesdata document exists for that invoice.
 */
function applyJvAutomationFlagsToSalesRows(rows, jvProcessMapping, jvDataInvSet) {
  const list = Array.isArray(rows) ? rows : [];
  const dateCol = getJvDateSourceColumn(jvProcessMapping);
  const invSet =
    jvDataInvSet instanceof Set
      ? jvDataInvSet
      : new Set(Array.isArray(jvDataInvSet) ? jvDataInvSet : []);

  return list.map((row) => {
    const data = row && typeof row === "object" && !Array.isArray(row) ? { ...row } : {};
    const dateVal = dateCol ? getRowValueForSourceColumn(data, dateCol) : null;
    const dateNull = !dateCol || isEmptyJvDateValue(dateVal);
    const inv = normalizeJvInv(extractInvFromSalesRow(data));
    data.jv_date_null = dateNull;
    data.jv_data_create = !dateNull && inv ? invSet.has(inv) : false;
    return data;
  });
}

/**
 * Create jvsalesdata (when mapping exists) and optionally stamp JV flags on sales rows.
 * Flags + null-date skip only apply when automation.jv.enabled === true.
 */
async function runJvSalesSideEffects({
  companyId,
  rawRows,
  rowsForSalesInsert,
  jvProcessMapping,
  sourceFileName,
  jvEnabled,
}) {
  const emptyJvResult = {
    configured: false,
    message: jvEnabled ? "JV process header mapping is empty." : "JV automation disabled.",
    input_rows: Array.isArray(rawRows) ? rawRows.length : 0,
    mapped_rows: 0,
    skipped_duplicate_in_file: 0,
    skipped_existing_in_collection: 0,
    skipped_null_date: 0,
    saved_rows: 0,
    rows: [],
    jvDataInvSet: new Set(),
  };

  if (!jvEnabled) {
    // Preserve prior behavior: still create jvsalesdata when mapping exists, but no flags.
    const jvResult = await processAndSaveJvSalesRows({
      companyId,
      rawRows,
      jvProcessMapping,
      sourceFileName,
      requireDate: false,
    });
    return {
      jvResult,
      salesRows: Array.isArray(rowsForSalesInsert) ? rowsForSalesInsert : [],
    };
  }

  const mappingKeys = Object.keys(jvProcessMapping || {});
  if (!mappingKeys.length) {
    const salesRows = applyJvAutomationFlagsToSalesRows(
      rowsForSalesInsert,
      jvProcessMapping,
      new Set()
    );
    return { jvResult: emptyJvResult, salesRows };
  }

  const jvResult = await processAndSaveJvSalesRows({
    companyId,
    rawRows,
    jvProcessMapping,
    sourceFileName,
    requireDate: true,
  });

  const salesRows = applyJvAutomationFlagsToSalesRows(
    rowsForSalesInsert,
    jvProcessMapping,
    jvResult.jvDataInvSet || new Set()
  );

  return { jvResult, salesRows };
}

async function buildSalesUploadRowDocs(companyId, rowsWithCombinations, meta) {
  const { rowsToInsert, skipped } = await filterSalesRowsByInvFinancialYear(
    SalesUploadRow,
    companyId,
    rowsWithCombinations
  );

  const rowDocs = rowsToInsert.map((row, idx) => ({
    companyId,
    uploadId: meta.uploadId,
    pdfUploadId: meta.salesFileUploadId,
    rowId: crypto.randomUUID(),
    rowIndex: idx,
    data: row,
    source: {
      salesOriginalName: meta.salesOriginalName || "",
      pdfOriginalName: meta.pdfOriginalName || "",
    },
  }));

  return { rowDocs, skippedDuplicates: skipped };
}

function salesDocToExcelRow(doc) {
  const data =
    doc.data && typeof doc.data === "object" && !Array.isArray(doc.data)
      ? doc.data
      : {};

  const meta = {
    rowId: doc.rowId,
    rowIndex: doc.rowIndex,
    uploadId: doc.uploadId,
    pdfUploadId: doc.pdfUploadId,
    salesOriginalName: doc.source?.salesOriginalName ?? "",
    pdfOriginalName: doc.source?.pdfOriginalName ?? "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : "",
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : "",
  };

  return { ...meta, ...data };
}

function parseSalesDataPagination(query) {
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

/** GET: all stored sales row `data` blobs for the company. Query: page (default 1), limit (default 50, max 500). */
async function getAllSalesData(req, res, next) {
  try {
    const companyId = req.companyId;

    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const { page, limit, skip } = parseSalesDataPagination(req.query || {});
    const filter = { companyId };

    const [total, docs] = await Promise.all([
      SalesUploadRow.countDocuments(filter),
      SalesUploadRow.find(filter)
        .sort({ createdAt: 1, pdfUploadId: 1, rowIndex: 1 })
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
      rows: docs.map((doc) =>
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

/** GET: download all stored sales rows as one Excel file (meta columns + row data). */
async function getSalesDataInToExcel(req, res, next) {
  try {
    const companyId = req.companyId;

    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const docs = await SalesUploadRow.find({ companyId })
      .sort({ createdAt: 1, pdfUploadId: 1, rowIndex: 1 })
      .lean();

    const rows = docs.map(salesDocToExcelRow);
    const buffer = exportVarToExcelBuffer(rows, "SalesUploadRows");

    const safeId = String(companyId).replace(/[^a-zA-Z0-9-_]/g, "");
    const filename = `company-sales-rows-${safeId}-${Date.now()}.xlsx`;

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

async function uploadSalesFile(req, res) {
  const salesFiles = [
    ...(req.files?.salesFile || []),
    ...(req.files?.salesFiles || []),
  ];
  const companyId = req.companyId;

  if (!salesFiles.length) {
    return res.status(400).json({
      success: false,
      message: "Missing file field `salesFile` or `salesFiles`.",
    });
  }
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const combinationDoc = await Combination.findOne({ companyId });
  const salesCombination = Array.isArray(combinationDoc?.salesCombination)
    ? combinationDoc.salesCombination
    : [];
  const salesCombinationDefs = salesCombination
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  if (!combinationDoc || !salesCombinationDefs.length) {
    return res.status(400).json({
      success: false,
      message:
        "Sales combination is not configured for this company. Create a combination with at least one sales field rule before uploading.",
    });
  }

  const headerMappingDoc = await HeaderMapping.findOne({ companyId });
  const headerMapping = sanitizeHeaderMapping(headerMappingDoc);
  const saledheadermapping =
    headerMapping?.sales && typeof headerMapping.sales === "object"
      ? headerMapping.sales
      : {};
  const jvProcessMapping =
    headerMapping?.jvProcess && typeof headerMapping.jvProcess === "object"
      ? headerMapping.jvProcess
      : {};
  const { salesround } = getSalesAndPdfRoundMappings(headerMapping);

  const results = [];
  const errors = [];
  const uploadId = crypto.randomUUID();
  let totalStoredRows = 0;

  for (const file of salesFiles) {
    const salesFileUploadId = crypto.randomUUID();
    const safeName = file.originalname || "sales.xlsx";

    try {
      const workbook = xlsx.read(file.buffer, { type: "buffer", cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;

      if (!firstSheet) {
        throw new Error("Unable to read Excel sheet from file.");
      }

      const parsedRows = normalizeSalesExcelRows(
        xlsx.utils.sheet_to_json(firstSheet, { defval: null })
      );

      const { rules: cleanRules, cleanedRows: rawRows, skipped_null_rows: skippedNullRows } =
        await cleanSalesRowsForCompany(companyId, parsedRows);

      const { rows: rowsWithFinancialYear, dateColumn: financialYearDateColumn } =
        applyConfiguredFinancialYear(rawRows, headerMapping);

      const rowsWithCombinations = buildSalesRowsWithMappingRoundAndCombinations(
        rowsWithFinancialYear,
        saledheadermapping,
        salesround,
        salesCombinationDefs
      );

      const jvEnabled = await isJvAutomationEnabled(companyId);
      const { jvResult, salesRows: rowsReadyForInsert } = await runJvSalesSideEffects({
        companyId,
        rawRows: rowsWithFinancialYear,
        rowsForSalesInsert: rowsWithCombinations,
        jvProcessMapping,
        sourceFileName: safeName,
        jvEnabled,
      });

      const { rowDocs, skippedDuplicates } = await buildSalesUploadRowDocs(
        companyId,
        rowsReadyForInsert,
        {
          uploadId,
          salesFileUploadId,
          salesOriginalName: safeName,
        }
      );

      if (rowDocs.length) {
        const inserted = await SalesUploadRow.insertMany(rowDocs, { ordered: false });
        totalStoredRows += inserted.length;
      }

      results.push({
        source_file: safeName,
        salesFileUploadId,
        stored_rows: rowDocs.length,
        skipped_duplicate_rows: skippedDuplicates.length,
        skipped_duplicates: skippedDuplicates,
        skipped_null_rows: skippedNullRows,
        sales_data_clean_rules_applied: cleanRules.length,
        financial_year_date_column: financialYearDateColumn || null,
        jv_saved_rows: jvResult.saved_rows,
        jv_rows: jvResult.rows,
        jv_summary: {
          jv_enabled: jvEnabled,
          configured: jvResult.configured,
          mapped_rows: jvResult.mapped_rows,
          skipped_duplicate_in_file: jvResult.skipped_duplicate_in_file,
          skipped_existing_in_collection: jvResult.skipped_existing_in_collection,
          skipped_null_date: jvResult.skipped_null_date ?? 0,
        },
        rows: rowsReadyForInsert,
      });
    } catch (err) {
      errors.push({
        source_file: safeName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return res.status(200).json({
    success: errors.length === 0,
    message:
      errors.length === 0
        ? "Sales files processed successfully."
        : "Some sales files failed to process.",
    data: {
      uploadId,
      total_files: salesFiles.length,
      processed_files: results.length,
      failed_files: errors.length,
      stored_rows: totalStoredRows,
      files: results,
      errors,
    },
  });
}

function resolveSapIngestCompanyId(req, payload = {}) {
  const fromBody = String(
    payload.companyid ?? payload.companyId ?? payload.company_id ?? ""
  ).trim();
  const fromAuth = req.companyId ? String(req.companyId).trim() : "";
  return fromBody || fromAuth;
}

function isInlineSapPayload(payload = {}) {
  return Array.isArray(payload.data);
}

async function callSapRunReportService(payload, { socketTimeoutMs, outboundTimeoutMs }) {
  const controller = outboundTimeoutMs > 0 ? new AbortController() : null;
  const timeoutId =
    controller && outboundTimeoutMs > 0
      ? setTimeout(() => controller.abort(), outboundTimeoutMs)
      : null;

  try {
    const nfTimeout = sapNodeFetchTimeoutMs(socketTimeoutMs, outboundTimeoutMs);
    const fetchOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    };
    if (controller) fetchOptions.signal = controller.signal;
    if (nfTimeout > 0) fetchOptions.timeout = nfTimeout;

    console.log(
      `[DEBUG] Calling SAP service at ${SAP_RUN_REPORT_URL} (node-fetch timeoutMs=${nfTimeout || "none"})`
    );
    const response = await nodeFetch(SAP_RUN_REPORT_URL, fetchOptions);
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!response.ok) {
      console.error(`[DEBUG] SAP service error: status ${response.status}, body:`, parsed);
      return {
        ok: false,
        status: 502,
        body: {
          success: false,
          message: "SAP service returned non-success status.",
          upstreamStatus: response.status,
          upstreamBody: parsed,
        },
      };
    }
    return { ok: true, sapResponse: parsed };
  } catch (error) {
    const cause = error && error.cause;
    const isUndiciHeadersTimeout =
      (cause && cause.code === "UND_ERR_HEADERS_TIMEOUT") ||
      (error && error.code === "UND_ERR_HEADERS_TIMEOUT");
    const isAbort =
      error &&
      (error.name === "AbortError" ||
        error.type === "aborted" ||
        error.code === "ERR_ABORTED");
    console.error(`[DEBUG] SAP fetch error:`, error);
    return {
      ok: false,
      status: isAbort ? 504 : 502,
      body: {
        success: false,
        message: isAbort
          ? outboundTimeoutMs > 0
            ? `SAP service request timed out after ${outboundTimeoutMs}ms (raise SAP_RUN_REPORT_TIMEOUT_MS or set 0 for no outbound limit).`
            : "SAP service request was aborted."
          : isUndiciHeadersTimeout
            ? "SAP service was too slow sending response headers (Undici headersTimeout). This route now uses node-fetch; restart the server. If it persists, raise SAP_NODE_FETCH_TIMEOUT_MS."
            : error instanceof Error
              ? error.message
              : "Could not call SAP report service.",
      },
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function processAndStoreSapSalesRows(companyId, sapResponse) {
  const rows = Array.isArray(sapResponse?.data) ? sapResponse.data : [];

  if (!rows.length) {
    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        message: "SAP report received; no rows to store.",
        data: {
          uploadId: null,
          salesFileUploadId: null,
          stored_rows: 0,
          source_count: 0,
          companyId: String(companyId),
          connection: sapResponse?.connection ?? "",
          completed_at: sapResponse?.completed_at ?? "",
          sapResponse,
        },
      },
    };
  }

  const combinationDoc = await Combination.findOne({ companyId });
  const salesCombination = Array.isArray(combinationDoc?.salesCombination)
    ? combinationDoc.salesCombination
    : [];
  const salesCombinationDefs = salesCombination
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  if (!combinationDoc || !salesCombinationDefs.length) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        message:
          "Sales combination is not configured for this company. Create a combination with at least one sales field rule before uploading.",
      },
    };
  }

  const headerMappingDoc = await HeaderMapping.findOne({ companyId });
  const headerMapping = sanitizeHeaderMapping(headerMappingDoc);
  const saledheadermapping =
    headerMapping?.sales && typeof headerMapping.sales === "object"
      ? headerMapping.sales
      : {};
  const jvProcessMapping =
    headerMapping?.jvProcess && typeof headerMapping.jvProcess === "object"
      ? headerMapping.jvProcess
      : {};
  const { salesround } = getSalesAndPdfRoundMappings(headerMapping);

  const parsedRows = normalizeSalesExcelRows(
    rows.map((row) =>
      row && typeof row === "object" && !Array.isArray(row) ? row : {}
    )
  );

  const { rules: cleanRules, cleanedRows: rawRows, skipped_null_rows: skippedNullRows } =
    await cleanSalesRowsForCompany(companyId, parsedRows);

  const { rows: rowsWithFinancialYear, dateColumn: financialYearDateColumn } =
    applyConfiguredFinancialYear(rawRows, headerMapping);

  const rowsWithCombinations = buildSalesRowsWithMappingRoundAndCombinations(
    rowsWithFinancialYear,
    saledheadermapping,
    salesround,
    salesCombinationDefs
  );

  const jvEnabled = await isJvAutomationEnabled(companyId);
  const { jvResult, salesRows: rowsReadyForInsert } = await runJvSalesSideEffects({
    companyId,
    rawRows: rowsWithFinancialYear,
    rowsForSalesInsert: rowsWithCombinations,
    jvProcessMapping,
    sourceFileName: "SAP run-report",
    jvEnabled,
  });

  const uploadId = crypto.randomUUID();
  const salesFileUploadId = crypto.randomUUID();

  const { rowDocs, skippedDuplicates } = await buildSalesUploadRowDocs(
    companyId,
    rowsReadyForInsert,
    {
      uploadId,
      salesFileUploadId,
      salesOriginalName: "SAP run-report",
    }
  );

  console.log(`[DEBUG] Saving ${rowDocs.length} SAP rows after header map + combinations`);

  let insertedRows = [];
  try {
    if (rowDocs.length) {
      insertedRows = await SalesUploadRow.insertMany(rowDocs, { ordered: false });
    }
  } catch (error) {
    console.error(`[DEBUG] SAP insertMany error:`, error);
    return {
      ok: false,
      status: 500,
      body: {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to save SAP rows after processing.",
        data: {
          uploadId,
          salesFileUploadId,
          companyId: String(companyId),
          source_count: rows.length,
          connection: sapResponse?.connection ?? "",
          completed_at: sapResponse?.completed_at ?? "",
        },
      },
    };
  }

  console.log(`[DEBUG] Finished saving: ${insertedRows.length} rows`);

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      message: "SAP report processed and sales rows stored successfully.",
      data: {
        uploadId,
        salesFileUploadId,
        companyId: String(companyId),
        stored_rows: insertedRows.length,
        sales_data_clean_rules_applied: cleanRules.length,
        skipped_null_rows: skippedNullRows,
        financial_year_date_column: financialYearDateColumn || null,
        skipped_duplicate_rows: skippedDuplicates.length,
        skipped_duplicates: skippedDuplicates,
        failed_rows: 0,
        source_count: rows.length,
        connection: sapResponse?.connection ?? "",
        completed_at: sapResponse?.completed_at ?? "",
        jv_saved_rows: jvResult.saved_rows,
        jv_rows: jvResult.rows,
        jv_summary: {
          jv_enabled: jvEnabled,
          configured: jvResult.configured,
          mapped_rows: jvResult.mapped_rows,
          skipped_duplicate_in_file: jvResult.skipped_duplicate_in_file,
          skipped_existing_in_collection: jvResult.skipped_existing_in_collection,
          skipped_null_date: jvResult.skipped_null_date ?? 0,
        },
        errors: [],
      },
    },
  };
}

function extractSapLogsFromPayload(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { present: false, logs: null };
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "logs") &&
      !Object.prototype.hasOwnProperty.call(payload, "log")) {
    return { present: false, logs: null };
  }
  const logs = Object.prototype.hasOwnProperty.call(payload, "logs")
    ? payload.logs
    : payload.log;
  return { present: true, logs };
}

/**
 * Map frontend `logs` into automationlog process entry for 1_sales.
 */
function buildSalesAutomationLogEntry(logs, fallback = {}) {
  const ranAt = new Date();
  const base = {
    status: fallback.success === false ? PROCESS_STATUS.FAILED : PROCESS_STATUS.SUCCESSFUL,
    error: fallback.error ?? null,
    summary: null,
    ranAt,
  };

  if (logs == null) {
    return base;
  }

  if (typeof logs !== "object" || Array.isArray(logs)) {
    return {
      ...base,
      summary: { logs },
    };
  }

  const statusRaw = String(logs.status ?? "").trim().toLowerCase();
  let status = base.status;
  if (
    statusRaw === "failed" ||
    statusRaw === "fail" ||
    statusRaw === "error" ||
    statusRaw === "unsuccessful"
  ) {
    status = PROCESS_STATUS.FAILED;
  } else if (statusRaw === "skip" || statusRaw === "skipped") {
    status = PROCESS_STATUS.SKIP;
  } else if (
    statusRaw === "successful" ||
    statusRaw === "success" ||
    statusRaw === "ok"
  ) {
    status = PROCESS_STATUS.SUCCESSFUL;
  }

  let ranAtValue = ranAt;
  if (logs.ranAt) {
    const parsed = new Date(logs.ranAt);
    if (!Number.isNaN(parsed.getTime())) ranAtValue = parsed;
  }

  const summaryFromLogs =
    logs.summary !== undefined
      ? logs.summary
      : (() => {
          const { status: _s, error: _e, ranAt: _r, ...rest } = logs;
          return Object.keys(rest).length ? rest : null;
        })();

  return {
    status,
    error:
      logs.error != null
        ? typeof logs.error === "string"
          ? logs.error
          : JSON.stringify(logs.error)
        : base.error,
    summary: summaryFromLogs,
    ranAt: ranAtValue,
  };
}

async function persistSapLogsToAutomation(companyId, logs, fallback = {}) {
  if (!companyId) return null;
  const entry = buildSalesAutomationLogEntry(logs, fallback);
  const dateKey = formatDateKey(entry.ranAt || new Date());
  return upsertProcessStatus(companyId, dateKey, AUTOMATION_PROCESSES.SALES, entry);
}

async function fetchFormSap(req, res) {
  const payload =
    req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

  const companyId = resolveSapIngestCompanyId(req, payload);
  if (!companyId) {
    return res.status(400).json({
      success: false,
      message: "Provide `companyid` in the request body or use company admin auth.",
    });
  }

  if (req.companyId && String(req.companyId) !== String(companyId)) {
    return res.status(403).json({
      success: false,
      message: "companyid does not match the authenticated company.",
    });
  }

  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid companyid.",
    });
  }

  const logsInfo = extractSapLogsFromPayload(payload);
  const isInline = isInlineSapPayload(payload);
  const reportDatesInfo = collectReportDatesFromPayload(payload);
  if (!isInline && reportDatesInfo.error) {
    return res.status(400).json({
      success: false,
      message: reportDatesInfo.error,
    });
  }
  const reportDates = reportDatesInfo.error ? [] : reportDatesInfo.dates || [];

  if (reportDates.length) {
    console.log(
      `[DEBUG] SAP data-from-sap for company ${companyId}: fetching date(s) ${reportDates.join(", ")}`
    );
    if (reportDatesInfo.sapLow && reportDatesInfo.sapHigh) {
      console.log(
        `[DEBUG] SAP report range: REPORT_DATE_LOW=${reportDatesInfo.sapLow}, REPORT_DATE_HIGH=${reportDatesInfo.sapHigh}`
      );
    }
  } else if (!isInline) {
    console.log(`[DEBUG] SAP data-from-sap for company ${companyId}: no report date(s) in request`);
  }

  let sapResponse;

  if (isInline) {
    console.log(
      `[DEBUG] Ingesting inline SAP payload for company ${companyId}: ${payload.data.length} row(s)${
        reportDates.length ? `, report date(s): ${reportDates.join(", ")}` : ""
      }`
    );
    sapResponse = payload;
  } else {
    const outboundTimeoutMs = sapRunReportTimeoutMs();
    const socketTimeoutMs =
      outboundTimeoutMs > 0
        ? outboundTimeoutMs + 5 * 60 * 1000
        : Number.parseInt(process.env.HTTP_SERVER_TIMEOUT_MS || String(2 * 60 * 60 * 1000), 10);

    if (req.socket && typeof req.socket.setTimeout === "function") {
      req.socket.setTimeout(socketTimeoutMs);
    }
    if (typeof res.setTimeout === "function") {
      res.setTimeout(socketTimeoutMs);
    }

    const sapPayload = { ...payload };
    // Do not forward frontend automation `logs` to the SAP service.
    delete sapPayload.logs;
    delete sapPayload.log;
    if (reportDatesInfo.sapLow && reportDatesInfo.sapHigh) {
      sapPayload.REPORT_DATE_LOW = reportDatesInfo.sapLow;
      sapPayload.REPORT_DATE_HIGH = reportDatesInfo.sapHigh;
    }

    console.log(
      `[DEBUG] Starting SAP fetch for company ${companyId} with payload:`,
      JSON.stringify(sapPayload, null, 2)
    );
    console.log(
      `[DEBUG] SAP URL=${SAP_RUN_REPORT_URL} outboundTimeoutMs=${outboundTimeoutMs || "none"} socketTimeoutMs=${socketTimeoutMs}`
    );

    const fetchResult = await callSapRunReportService(sapPayload, {
      socketTimeoutMs,
      outboundTimeoutMs,
    });
    if (!fetchResult.ok) {
      if (logsInfo.present) {
        try {
          await persistSapLogsToAutomation(companyId, logsInfo.logs, {
            success: false,
            error:
              fetchResult.body?.message ||
              fetchResult.body?.detail ||
              "SAP fetch failed.",
          });
        } catch (logErr) {
          console.warn(
            "[data-from-sap] failed to write automation log after SAP fetch error:",
            logErr instanceof Error ? logErr.message : logErr
          );
        }
      }
      return res.status(fetchResult.status).json(fetchResult.body);
    }
    sapResponse = fetchResult.sapResponse;
    console.log(`[DEBUG] SAP response received:`, JSON.stringify(sapResponse, null, 2));
  }

  const result = await processAndStoreSapSalesRows(companyId, sapResponse);

  if (result.body && typeof result.body === "object") {
    if (!result.body.data || typeof result.body.data !== "object") {
      result.body.data = {};
    }
    result.body.data.report_dates = reportDates;
    if (reportDatesInfo.sapLow && reportDatesInfo.sapHigh) {
      result.body.data.REPORT_DATE_LOW = reportDatesInfo.sapLow;
      result.body.data.REPORT_DATE_HIGH = reportDatesInfo.sapHigh;
    }
  }

  if (result.ok && reportDates.length) {
    const storedRows = Number(result.body?.data?.stored_rows) || 0;
    const uploadId = result.body?.data?.uploadId || "";
    const source = isInline ? "inline" : "sap";
    const receiveMeta = {
      storedRows,
      uploadId,
      source,
    };
    if (logsInfo.present) {
      receiveMeta.logs = logsInfo.logs;
    }
    await markSalesSapDatesReceived(companyId, reportDates, receiveMeta);
    if (result.body?.data && typeof result.body.data === "object") {
      result.body.data.received_dates = reportDates;
    }
  } else if (logsInfo.present && reportDates.length) {
    // Persist logs even when row store failed, so receive-log still has the run result.
    try {
      await markSalesSapDatesReceived(companyId, reportDates, {
        storedRows: 0,
        uploadId: "",
        source: isInline ? "inline" : "sap",
        logs: logsInfo.logs,
      });
    } catch (logErr) {
      console.warn(
        "[data-from-sap] failed to write salessapreceivelog logs:",
        logErr instanceof Error ? logErr.message : logErr
      );
    }
  }

  if (logsInfo.present) {
    try {
      await persistSapLogsToAutomation(companyId, logsInfo.logs, {
        success: Boolean(result.ok),
        error: result.ok
          ? null
          : result.body?.message || result.body?.detail || "SAP ingest failed.",
      });
      if (result.body?.data && typeof result.body.data === "object") {
        result.body.data.automation_log_saved = true;
      }
    } catch (logErr) {
      console.warn(
        "[data-from-sap] failed to write automation log:",
        logErr instanceof Error ? logErr.message : logErr
      );
    }
  }

  return res.status(result.status).json(result.body);
}

/**
 * POST /api/company/admin/process/sales/sap-missing-dates
 * Body: { "companyid": "...", "days": 60 }
 */
async function getSapMissingDates(req, res) {
  try {
    const companyId = validateRequestCompanyId(req, res);
    if (!companyId) return;

    const configureDoc = await loadConfigure(companyId);
    const automation = sanitizeAutomationSection(configureDoc);
    const dataStartFrom = automation?.sales?.dataStartFrom || "";
    const daysRaw = Number.parseInt(
      String(req.body?.days ?? req.query?.days ?? "60"),
      10
    );
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 60;

    const summary = await getMissingSalesSapDatesForRecentDays(companyId, {
      dataStartFrom,
      days,
    });

    return res.status(200).json({
      success: true,
      ...summary,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to load missing SAP dates.",
    });
  }
}

/**
 * POST /api/company/admin/process/sales/without-billing-date-invoice
 * Body: { "companyName": "GFL" }
 * Returns distinct invoice numbers where "Billing Date" is null/missing.
 */
async function withoutBillingDateInvoice(req, res) {
  try {
    const companyName = String(req.body?.companyName || "").trim();
    if (!companyName) {
      return res.status(400).json({ success: false, message: "companyName is required." });
    }

    const { Company } = require("#utils/company");
    const { HeaderMapping } = require("#utils/headerMapping");
    const { extractInvFromSalesRow } = require("#utils/salesInvFinancialYearUniq");

    const company = await Company.findOne({
      name: { $regex: new RegExp(`^${companyName}$`, "i") },
    }).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: `Company "${companyName}" not found.` });
    }
    const companyId = company._id;

    // Resolve the billing date column name from header mapping
    let billingDateKey = "Billing Date";
    const headerMappingDoc = await HeaderMapping.findOne({ companyId }).lean();
    if (headerMappingDoc?.filterDate?.date) {
      billingDateKey = headerMappingDoc.filterDate.date;
    }

    const SalesUploadRow = mongoose.models.SalesUploadRow;
    const rows = await SalesUploadRow.find(
      {
        companyId,
        $or: [
          { [`data.${billingDateKey}`]: null },
          { [`data.${billingDateKey}`]: "" },
          { [`data.${billingDateKey}`]: { $exists: false } },
        ],
      },
      { "data.inv": 1, "data.INV_2": 1, "data.invoice": 1, "data.Invoice No": 1 }
    ).lean();

    const invSet = new Set();
    for (const row of rows) {
      const inv = extractInvFromSalesRow(row?.data || {});
      if (inv) invSet.add(inv);
    }

    const sorted = [...invSet].sort((a, b) => String(a).localeCompare(String(b)));

    return res.status(200).json({
      success: true,
      companyName: company.name,
      billingDateKey,
      count: sorted.length,
      invoices: sorted,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch invoices.",
    });
  }
}

module.exports = {
  getAllSalesData,
  getSalesDataInToExcel,
  uploadSalesFile,
  fetchFormSap,
  getSapMissingDates,
  withoutBillingDateInvoice,
};
