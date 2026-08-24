const crypto = require("node:crypto");
const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { start } = require("./1_process_logic/1start");
const {
  ProcessMatch,
  PROCESS_MATCH_RECORD_TYPES,
  MATCHED_PROCESS_MATCH_FILTER,
} = require("#utils/processMatch");
const {
  INTERNAL_SALES_ROW_ID,
  INTERNAL_PDF_ROW_ID,
} = require("#utils/processRowInternalIds");
const {
  buildMatchedPdfUploadRowIdSet,
  loadProcessMatches,
  distinctMatchedRowIds: distinctMatchedRowIdsForCompany,
} = require("#utils/processMatchPdfResolve");
const { extractInvFromSalesRow } = require("#utils/salesInvFinancialYearUniq");
const { normalizePdfInv } = require("#controllers/company/admin/process/pdf/jvpdfdata");
const {
  HeaderMapping,
  sanitizeHeaderMapping,
  normalizeManualMatchDescriptionBody,
} = require("#utils/headerMapping");
const { normalizeSbNoForMatch } = require("#utils/shippingBillNo");

const PDF_DESCRIPTION_FIELD = "id.4.DESCRIPTION";
const DEFAULT_SALES_DISPLAY_KEYS = ["inv", "qty1", "qty2", "amount"];
const DEFAULT_PDF_DISPLAY_KEYS = ["inv", "qty", "amount"];

const ROW_STATUS = {
  AVAILABLE: "available",
  EXCEPTION: "exception",
  IGNORED: "ignored",
};

const UPDATABLE_ROW_STATUSES = new Set([
  ROW_STATUS.EXCEPTION,
  ROW_STATUS.IGNORED,
]);

function normalizeRowStatus(value) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === ROW_STATUS.EXCEPTION || raw === ROW_STATUS.IGNORED) return raw;
  return ROW_STATUS.AVAILABLE;
}

function isClosedRowStatus(value) {
  const status = normalizeRowStatus(value);
  return status === ROW_STATUS.EXCEPTION || status === ROW_STATUS.IGNORED;
}

function stripInternalRowIds(row) {
  if (!row || typeof row !== "object") return row;
  const o = { ...row };
  delete o[INTERNAL_SALES_ROW_ID];
  delete o[INTERNAL_PDF_ROW_ID];
  return o;
}

function buildProcessBatchCounts({
  totalSalesRowCount,
  totalPdfRowCount,
  alreadyMatchedSalesCount,
  alreadyMatchedPdfCount,
  unmatchedSalesBeforeCount,
  unmatchedPdfBeforeCount,
}) {
  return {
    totalSalesRowCount,
    totalPdfRowCount,
    alreadyMatchedSalesCount,
    alreadyMatchedPdfCount,
    unmatchedSalesBeforeCount,
    unmatchedPdfBeforeCount,
  };
}

async function distinctMatchedRowIds(companyId, field) {
  return distinctMatchedRowIdsForCompany(companyId, field, ProcessMatch);
}

function extractInvFromRowData(data) {
  return extractInvFromSalesRow(data);
}

function normalizeInvoiceKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return normalizePdfInv(raw) || raw;
}

function invoiceKeysMatch(rowInv, queryInv) {
  const a = normalizeInvoiceKey(rowInv);
  const b = normalizeInvoiceKey(queryInv);
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function resolveSalesDisplayKeys(salesMapping = {}) {
  const keys = DEFAULT_SALES_DISPLAY_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(salesMapping, key)
  );
  return keys.length ? keys : [...DEFAULT_SALES_DISPLAY_KEYS];
}

function resolvePdfDisplayKeys(pdfMapping = {}) {
  const keys = DEFAULT_PDF_DISPLAY_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(pdfMapping, key)
  );
  return keys.length ? keys : [...DEFAULT_PDF_DISPLAY_KEYS];
}

function extractSalesDescriptionValue(data, descriptionColumn) {
  if (!data || typeof data !== "object") return "";
  if (data.description != null && String(data.description).trim()) {
    return String(data.description).trim();
  }
  const column = String(descriptionColumn || "").trim();
  if (column && data[column] != null && String(data[column]).trim()) {
    return String(data[column]).trim();
  }
  return "";
}

function extractPdfDescriptionValue(data) {
  if (!data || typeof data !== "object") return "";
  const raw = data[PDF_DESCRIPTION_FIELD] ?? data.description;
  return raw != null && String(raw).trim() ? String(raw).trim() : "";
}

function pickMappedDisplayValues(data, displayKeys) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  for (const key of displayKeys) {
    out[key] = data[key] ?? null;
  }
  return out;
}

async function loadManualMatchDisplayConfig(companyId) {
  const doc = await HeaderMapping.findOne({ companyId }).lean();
  const headerMapping = sanitizeHeaderMapping(doc);
  const salesMapping =
    headerMapping?.sales && typeof headerMapping.sales === "object"
      ? headerMapping.sales
      : {};
  const pdfMapping =
    headerMapping?.pdf && typeof headerMapping.pdf === "object" ? headerMapping.pdf : {};
  const manualMatchDescription = normalizeManualMatchDescriptionBody(
    headerMapping?.manualMatchDescription || {}
  );

  const salesDisplayKeys = resolveSalesDisplayKeys(salesMapping);
  const pdfDisplayKeys = resolvePdfDisplayKeys(pdfMapping);

  return {
    salesDisplayKeys,
    pdfDisplayKeys,
    salesDescriptionColumn: manualMatchDescription.column || "",
    pdfDescriptionField: PDF_DESCRIPTION_FIELD,
    displayColumns: {
      sales: [...salesDisplayKeys, "description"],
      pdf: [...pdfDisplayKeys, "description"],
    },
  };
}

function serializeSalesUploadRowForManualMatch(doc, displayConfig) {
  const data = doc?.data && typeof doc.data === "object" ? doc.data : {};
  const description = extractSalesDescriptionValue(
    data,
    displayConfig.salesDescriptionColumn
  );
  const displayValues = pickMappedDisplayValues(data, displayConfig.salesDisplayKeys);

  return {
    id: doc.rowId,
    rowId: doc.rowId,
    rowIndex: doc.rowIndex,
    uploadId: doc.uploadId,
    pdfUploadId: doc.pdfUploadId,
    invoice: extractInvFromRowData(data),
    description,
    displayValues,
    data,
    rowStatus: normalizeRowStatus(doc.rowStatus),
    source: doc.source,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function serializePdfUploadRowForManualMatch(doc, displayConfig) {
  const data = doc?.data && typeof doc.data === "object" ? doc.data : {};
  const description = extractPdfDescriptionValue(data);
  const displayValues = pickMappedDisplayValues(data, displayConfig.pdfDisplayKeys);

  return {
    id: doc.pdfRowId,
    pdfRowId: doc.pdfRowId,
    pdfRowIndex: doc.pdfRowIndex,
    uploadId: doc.uploadId,
    pdfUploadId: doc.pdfUploadId,
    invoice: extractInvFromRowData(data),
    description,
    displayValues,
    data,
    rowStatus: normalizeRowStatus(doc.rowStatus),
    source: doc.source,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function serializeSalesUploadRow(doc) {
  return {
    id: doc.rowId,
    rowId: doc.rowId,
    rowIndex: doc.rowIndex,
    uploadId: doc.uploadId,
    pdfUploadId: doc.pdfUploadId,
    invoice: extractInvFromRowData(doc.data),
    data: doc.data,
    source: doc.source,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function serializePdfUploadRow(doc) {
  return {
    id: doc.pdfRowId,
    pdfRowId: doc.pdfRowId,
    pdfRowIndex: doc.pdfRowIndex,
    uploadId: doc.uploadId,
    pdfUploadId: doc.pdfUploadId,
    invoice: extractInvFromRowData(doc.data),
    data: doc.data,
    source: doc.source,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function loadUnmatchedUploadRows(companyId) {
  const SalesUploadRow = mongoose.models.SalesUploadRow;
  const PdfUploadRow = mongoose.models.PdfUploadRow;

  if (!SalesUploadRow || !PdfUploadRow) {
    return {
      error: "Upload row models are not registered. Load sales/PDF routes once.",
    };
  }

  const [salesDocs, pdfDocs, matchedSalesRowIds, processMatches] = await Promise.all([
    SalesUploadRow.find({ companyId })
      .sort({ createdAt: 1, pdfUploadId: 1, rowIndex: 1 })
      .lean(),
    PdfUploadRow.find({ companyId })
      .sort({ createdAt: 1, pdfUploadId: 1, pdfRowIndex: 1 })
      .lean(),
    distinctMatchedRowIds(companyId, "salesRowId"),
    loadProcessMatches(companyId, ProcessMatch),
  ]);

  const matchedSalesSet = new Set(matchedSalesRowIds.map((id) => String(id)));
  const matchedPdfUploadRowIdSet = buildMatchedPdfUploadRowIdSet(pdfDocs, processMatches);

  const unmatchedSalesDocs = salesDocs.filter(
    (d) =>
      !matchedSalesSet.has(String(d.rowId)) && !isClosedRowStatus(d.rowStatus)
  );
  const unmatchedPdfDocs = pdfDocs.filter(
    (d) =>
      !matchedPdfUploadRowIdSet.has(String(d.pdfRowId).trim()) &&
      !isClosedRowStatus(d.rowStatus)
  );

  return {
    salesDocs,
    pdfDocs,
    unmatchedSalesDocs,
    unmatchedPdfDocs,
    matchedSalesSet,
    matchedPdfUploadRowIdSet,
    salesRows: unmatchedSalesDocs.map(serializeSalesUploadRow),
    pdfRows: unmatchedPdfDocs.map(serializePdfUploadRow),
  };
}

function collectPdfInvoiceKeys(pdfDocs) {
  const keys = new Set();
  for (const doc of pdfDocs) {
    const inv = extractInvFromRowData(doc?.data);
    const key = normalizeInvoiceKey(inv);
    if (key) keys.add(key.toLowerCase());
  }
  return keys;
}

const SALES_ITM_STATUS_KEY = "ITM STATUS";
const SALES_INV_STATUS_KEY = "INV STATUS";
const ITM_STATUS = {
  MATCHED: "matched",
  UNMATCHED: "Unmatched",
};
const INV_STATUS = {
  MATCHED: "Matched",
  PARTIALLY_MATCHED: "Partially Matched",
};

function normalizeItmStatus(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "matched") return ITM_STATUS.MATCHED;
  if (raw === "unmatched") return ITM_STATUS.UNMATCHED;
  return "";
}

function readSalesDataStatus(data, key) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  return String(data[key] ?? "").trim();
}

/**
 * Fetch sales rows for one invoice, set/update ITM STATUS from processmatch,
 * then set INV STATUS on every sales row for that invoice:
 * - any ITM STATUS = Unmatched → Partially Matched
 * - all ITM STATUS = matched and sales count === pdf count → Matched
 * - all ITM STATUS = matched and counts differ → Partially Matched
 */
async function updateSalesInvoiceStatusByInv(companyId, invoice) {
  const result = await updateSalesInvoiceStatusForInvoices(companyId, [invoice]);
  const key = normalizeInvoiceKey(invoice).toLowerCase();
  const row = (result.invoices || []).find((item) => item.invoiceKey === key) || {
    invoice: String(invoice ?? "").trim(),
    invoiceKey: key,
    salesRowCount: 0,
    pdfRowCount: 0,
    invStatus: "",
    updated: 0,
  };
  return { ...result, ...row };
}

async function updateSalesInvoiceStatusForInvoices(companyId, invoices) {
  const invoiceKeys = [
    ...new Set(
      (Array.isArray(invoices) ? invoices : [])
        .map((inv) => normalizeInvoiceKey(inv).toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (!companyId || !invoiceKeys.length) {
    return { updated: 0, invoices: [] };
  }

  const SalesUploadRow = mongoose.models.SalesUploadRow;
  const PdfUploadRow = mongoose.models.PdfUploadRow;
  if (!SalesUploadRow || !PdfUploadRow) {
    return { updated: 0, invoices: [], error: "Upload row models are not registered." };
  }

  const keySet = new Set(invoiceKeys);
  const [salesDocs, pdfDocs, matchedSalesRowIds] = await Promise.all([
    SalesUploadRow.find({ companyId }).select({ rowId: 1, data: 1 }).lean(),
    PdfUploadRow.find({ companyId }).select({ data: 1 }).lean(),
    distinctMatchedRowIds(companyId, "salesRowId"),
  ]);
  const matchedSalesSet = new Set(matchedSalesRowIds.map((id) => String(id)));

  const salesByInv = new Map();
  for (const doc of salesDocs) {
    const key = normalizeInvoiceKey(extractInvFromRowData(doc?.data)).toLowerCase();
    if (!key || !keySet.has(key)) continue;
    if (!salesByInv.has(key)) salesByInv.set(key, []);
    salesByInv.get(key).push(doc);
  }

  const pdfCountByInv = new Map();
  for (const doc of pdfDocs) {
    const key = normalizeInvoiceKey(extractInvFromRowData(doc?.data)).toLowerCase();
    if (!key || !keySet.has(key)) continue;
    pdfCountByInv.set(key, (pdfCountByInv.get(key) || 0) + 1);
  }

  const ops = [];
  const invoiceSummaries = [];

  for (const invoiceKey of invoiceKeys) {
    const salesRows = salesByInv.get(invoiceKey) || [];
    const pdfRowCount = pdfCountByInv.get(invoiceKey) || 0;
    const salesRowCount = salesRows.length;
    let displayInv = invoiceKey;

    for (const doc of salesRows) {
      const inv = extractInvFromRowData(doc?.data);
      if (inv) displayInv = inv;
      doc._itmStatus = matchedSalesSet.has(String(doc.rowId))
        ? ITM_STATUS.MATCHED
        : ITM_STATUS.UNMATCHED;
    }

    const hasUnmatched = salesRows.some(
      (doc) => normalizeItmStatus(doc._itmStatus) === ITM_STATUS.UNMATCHED
    );
    const allMatched =
      salesRowCount > 0 &&
      salesRows.every((doc) => normalizeItmStatus(doc._itmStatus) === ITM_STATUS.MATCHED);

    let invStatus = INV_STATUS.PARTIALLY_MATCHED;
    if (!hasUnmatched && allMatched && salesRowCount === pdfRowCount) {
      invStatus = INV_STATUS.MATCHED;
    }

    let updatedForInv = 0;
    for (const doc of salesRows) {
      const currentInv = readSalesDataStatus(doc.data, SALES_INV_STATUS_KEY);
      const currentItm = normalizeItmStatus(readSalesDataStatus(doc.data, SALES_ITM_STATUS_KEY));
      if (currentInv === invStatus && currentItm === doc._itmStatus) continue;
      ops.push({
        updateOne: {
          filter: { companyId, rowId: doc.rowId },
          update: {
            $set: {
              [`data.${SALES_ITM_STATUS_KEY}`]: doc._itmStatus,
              [`data.${SALES_INV_STATUS_KEY}`]: invStatus,
            },
          },
        },
      });
      updatedForInv += 1;
    }

    invoiceSummaries.push({
      invoice: displayInv,
      invoiceKey,
      salesRowCount,
      pdfRowCount,
      invStatus,
      updated: updatedForInv,
    });
  }

  let updated = 0;
  if (ops.length) {
    const bulk = await SalesUploadRow.bulkWrite(ops, { ordered: false });
    updated = (bulk.modifiedCount || 0) + (bulk.upsertedCount || 0);
  }

  return { updated, invoices: invoiceSummaries };
}

async function applyItmStatusToProcessedSalesRows(companyId, salesDocsForRun, newlyMatchedSalesIds) {
  const SalesUploadRow = mongoose.models.SalesUploadRow;
  if (!SalesUploadRow || !Array.isArray(salesDocsForRun) || !salesDocsForRun.length) {
    return { updated: 0 };
  }

  const matchedSet = newlyMatchedSalesIds instanceof Set
    ? newlyMatchedSalesIds
    : new Set(newlyMatchedSalesIds || []);
  const ops = salesDocsForRun
    .map((doc) => {
      const rowId = String(doc?.rowId || "").trim();
      if (!rowId) return null;
      const itmStatus = matchedSet.has(rowId) ? ITM_STATUS.MATCHED : ITM_STATUS.UNMATCHED;
      return {
        updateOne: {
          filter: { companyId, rowId },
          update: { $set: { [`data.${SALES_ITM_STATUS_KEY}`]: itmStatus } },
        },
      };
    })
    .filter(Boolean);

  if (!ops.length) return { updated: 0 };
  const bulk = await SalesUploadRow.bulkWrite(ops, { ordered: false });
  return { updated: (bulk.modifiedCount || 0) + (bulk.upsertedCount || 0) };
}

function collectUnmatchedSalesInvoiceNumbers(unmatchedSalesDocs, pdfDocs = []) {
  const pdfInvoiceKeys = collectPdfInvoiceKeys(pdfDocs);
  const invoices = new Set();

  for (const doc of unmatchedSalesDocs) {
    const inv = extractInvFromRowData(doc?.data);
    if (!inv) continue;
    const key = normalizeInvoiceKey(inv);
    if (!key || !pdfInvoiceKeys.has(key.toLowerCase())) continue;
    invoices.add(inv);
  }

  return [...invoices].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
  );
}

/**
 * Distinct invoice numbers that have at least one row (sales OR pdf) whose
 * rowStatus matches the target status (exception | ignored).
 * An invoice with one exception row and one ignored row appears in BOTH filters.
 */
function collectInvoicesByRowStatus(salesDocs = [], pdfDocs = [], targetStatus) {
  const target = normalizeRowStatus(targetStatus);
  const invoices = new Set();

  const addFrom = (docs) => {
    for (const doc of docs || []) {
      if (normalizeRowStatus(doc?.rowStatus) !== target) continue;
      const inv = extractInvFromRowData(doc?.data);
      if (inv) invoices.add(inv);
    }
  };

  addFrom(salesDocs);
  addFrom(pdfDocs);

  return [...invoices].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
  );
}

const FILTER_DATE_MAPPING_KEYS = ["date", "fromDate", "filterDate"];

function getFilterDateColumnName(filterDate) {
  if (!filterDate || typeof filterDate !== "object" || Array.isArray(filterDate)) {
    return null;
  }
  for (const key of FILTER_DATE_MAPPING_KEYS) {
    const value = String(filterDate[key] ?? "").trim();
    if (value) return value;
  }
  for (const value of Object.values(filterDate)) {
    const v = String(value ?? "").trim();
    if (v) return v;
  }
  return null;
}

function parseBoundaryDate(value, boundary) {
  const str = String(value ?? "").trim();
  if (!str) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]) - 1;
    const d = Number(ymd[3]);
    if (boundary === "start") return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    return new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
  }
  const dt = new Date(str);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseFlexibleSalesDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = xlsx.SSF?.parse_date_code?.(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    }
  }

  const str = String(value).trim();
  if (!str) return null;

  if (/^\d+(\.\d+)?$/.test(str)) {
    const serial = Number(str);
    if (Number.isFinite(serial)) {
      const parsed = xlsx.SSF?.parse_date_code?.(serial);
      if (parsed?.y && parsed?.m && parsed?.d) {
        return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      }
    }
  }

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (isoDate) {
    return new Date(
      Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
    );
  }

  const dmySlash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
  if (dmySlash) {
    return new Date(
      Date.UTC(Number(dmySlash[3]), Number(dmySlash[2]) - 1, Number(dmySlash[1]))
    );
  }

  const dmyDot = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(str);
  if (dmyDot) {
    return new Date(
      Date.UTC(Number(dmyDot[3]), Number(dmyDot[2]) - 1, Number(dmyDot[1]))
    );
  }

  const dmyDash = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(str);
  if (dmyDash) {
    return new Date(
      Date.UTC(Number(dmyDash[3]), Number(dmyDash[2]) - 1, Number(dmyDash[1]))
    );
  }

  const dt = new Date(str);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function resolveSalesDataColumnValue(data, columnName) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const col = String(columnName || "").trim();
  if (!col) return null;
  if (data[col] != null && String(data[col]).trim() !== "") return data[col];
  const lower = col.toLowerCase();
  for (const [key, value] of Object.entries(data)) {
    if (String(key).toLowerCase() === lower && value != null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function isSalesRowDateInRange(doc, columnName, fromDate, toDate) {
  const raw = resolveSalesDataColumnValue(doc?.data, columnName);
  const rowDate = parseFlexibleSalesDate(raw);
  if (!rowDate) return false;
  const from = parseBoundaryDate(fromDate, "start");
  const to = parseBoundaryDate(toDate, "end");
  if (from && rowDate < from) return false;
  if (to && rowDate > to) return false;
  return true;
}

function extractSbNoFromPdfData(data) {
  if (!data || typeof data !== "object") return "";
  return String(data["SB No"] ?? data.sbNo ?? data.SBNo ?? "").trim();
}

/**
 * Fully matched invoice:
 * - at least one sales + one PDF row
 * - at least one matched pair
 * - every remaining row is Ignored (Exception / Available unmatched → fail)
 */
function isInvoiceFullyMatched(salesRows, pdfRows) {
  if (!salesRows.length || !pdfRows.length) return false;

  let matchedSales = 0;
  let matchedPdf = 0;

  for (const row of salesRows) {
    if (row.isMatched) {
      matchedSales += 1;
      continue;
    }
    if (normalizeRowStatus(row.rowStatus) !== ROW_STATUS.IGNORED) return false;
  }

  for (const row of pdfRows) {
    if (row.isMatched) {
      matchedPdf += 1;
      continue;
    }
    if (normalizeRowStatus(row.rowStatus) !== ROW_STATUS.IGNORED) return false;
  }

  return matchedSales > 0 && matchedPdf > 0;
}

function parseManualMatchPairs(body = {}) {
  const rawMatches = Array.isArray(body.matches)
    ? body.matches
    : Array.isArray(body.pairs)
      ? body.pairs
      : null;

  if (rawMatches) {
    const pairs = [];
    for (const item of rawMatches) {
      if (!item || typeof item !== "object") continue;
      const salesRowId = String(item.salesRowId ?? item.salesId ?? item.salesid ?? "").trim();
      const pdfRowId = String(item.pdfRowId ?? item.pdfId ?? item.pdfid ?? "").trim();
      if (!salesRowId || !pdfRowId) {
        return { error: "Each match must include both salesRowId and pdfRowId." };
      }
      pairs.push({ salesRowId, pdfRowId });
    }
    if (!pairs.length) {
      return { error: "At least one sales/pdf row pair is required." };
    }
    return { pairs };
  }

  const salesRowIds = Array.isArray(body.salesRowIds)
    ? body.salesRowIds
    : Array.isArray(body.salesIds)
      ? body.salesIds
      : null;
  const pdfRowIds = Array.isArray(body.pdfRowIds)
    ? body.pdfRowIds
    : Array.isArray(body.pdfIds)
      ? body.pdfIds
      : null;

  if (salesRowIds && pdfRowIds) {
    if (salesRowIds.length !== pdfRowIds.length) {
      return {
        error: "salesRowIds and pdfRowIds must have the same length when sent as parallel arrays.",
      };
    }
    const pairs = salesRowIds.map((salesRowId, idx) => ({
      salesRowId: String(salesRowId ?? "").trim(),
      pdfRowId: String(pdfRowIds[idx] ?? "").trim(),
    }));
    if (pairs.some((p) => !p.salesRowId || !p.pdfRowId)) {
      return { error: "Each salesRowId/pdfRowId entry must be a non-empty string." };
    }
    return { pairs };
  }

  const salesRowId = String(body.salesRowId ?? body.salesId ?? body.salesid ?? "").trim();
  const pdfRowId = String(body.pdfRowId ?? body.pdfId ?? body.pdfid ?? "").trim();
  if (salesRowId && pdfRowId) {
    return { pairs: [{ salesRowId, pdfRowId }] };
  }

  return { error: "Request body must include matches: [{ salesRowId, pdfRowId }, ...]." };
}



async function runStartProcessForCompany(companyId) {
  if (!companyId) {
    return {
      success: false,
      message: "Company admin access is required.",
    };
  }

  const SalesUploadRow = mongoose.models.SalesUploadRow;
  const PdfUploadRow = mongoose.models.PdfUploadRow;

  if (!SalesUploadRow) {
    return {
      success: false,
      message: "SalesUploadRow model is not registered. Load sales routes once.",
    };
  }
  if (!PdfUploadRow) {
    return {
      success: false,
      message: "PdfUploadRow model is not registered. Load PDF routes once.",
    };
  }

  const [salesDocs, pdfDocs, matchedSalesRowIds, processMatches] = await Promise.all([
    SalesUploadRow.find({ companyId })
      .sort({ createdAt: 1, pdfUploadId: 1, rowIndex: 1 })
      .lean(),
    PdfUploadRow.find({ companyId })
      .sort({ createdAt: 1, pdfUploadId: 1, pdfRowIndex: 1 })
      .lean(),
    distinctMatchedRowIds(companyId, "salesRowId"),
    loadProcessMatches(companyId, ProcessMatch),
  ]);

  if (!salesDocs.length) {
    return {
      success: false,
      message:
        "No stored sales rows for this company. Upload sales via POST /upload-sales-file first.",
    };
  }
  if (!pdfDocs.length) {
    return {
      success: false,
      message:
        "No stored PDF rows for this company. Upload PDFs via POST /upload-pdf first.",
    };
  }

  const matchedSalesSet = new Set(matchedSalesRowIds.map((id) => String(id)));
  const matchedPdfUploadRowIdSet = buildMatchedPdfUploadRowIdSet(
    pdfDocs,
    processMatches
  );

  const salesDocsForRun = salesDocs.filter(
    (d) =>
      !matchedSalesSet.has(String(d.rowId)) && !isClosedRowStatus(d.rowStatus)
  );
  const pdfDocsForRun = pdfDocs.filter(
    (d) =>
      !matchedPdfUploadRowIdSet.has(String(d.pdfRowId).trim()) &&
      !isClosedRowStatus(d.rowStatus)
  );

  const alreadyMatchedSalesCount = salesDocs.length - salesDocsForRun.length;
  const alreadyMatchedPdfCount = pdfDocs.length - pdfDocsForRun.length;
  const unmatchedSalesBeforeCount = salesDocsForRun.length;
  const unmatchedPdfBeforeCount = pdfDocsForRun.length;

  const batchCounts = buildProcessBatchCounts({
    totalSalesRowCount: salesDocs.length,
    totalPdfRowCount: pdfDocs.length,
    alreadyMatchedSalesCount,
    alreadyMatchedPdfCount,
    unmatchedSalesBeforeCount,
    unmatchedPdfBeforeCount,
  });

  if (!salesDocsForRun.length) {
    return {
      success: false,
      message:
        "Every sales row is already linked in processmatch. Nothing left to match on the sales side.",
      totalSalesRowCount: salesDocs.length,
      totalPdfRowCount: pdfDocs.length,
      alreadyMatchedSalesCount,
      alreadyMatchedPdfCount,
      unmatchedSalesBeforeCount,
      unmatchedPdfBeforeCount,
    };
  }
  if (!pdfDocsForRun.length) {
    return {
      success: false,
      message:
        "Every PDF row is already linked in processmatch. Nothing left to match on the PDF side.",
      totalSalesRowCount: salesDocs.length,
      totalPdfRowCount: pdfDocs.length,
      alreadyMatchedSalesCount,
      alreadyMatchedPdfCount,
      unmatchedSalesBeforeCount,
      unmatchedPdfBeforeCount,
    };
  }

  const batchId = crypto.randomUUID();
  const matchedAt = new Date();

  const salesExcelData = salesDocsForRun.map((doc) => ({
    ...doc.data,
    [INTERNAL_SALES_ROW_ID]: doc.rowId,
  }));
  const pdfItems = pdfDocsForRun.map((doc) => ({
    ...doc.data,
    [INTERNAL_PDF_ROW_ID]: doc.pdfRowId,
  }));

  const result = await start(salesExcelData, pdfItems, companyId, {
    preprocessed: true,
  });

  const matchedList = Array.isArray(result.matched) ? result.matched : [];

  const salesRemainingCount = Array.isArray(result.remainingSalesRows)
    ? result.remainingSalesRows.length
    : 0;
  const pdfRemainingCount = Array.isArray(result.remainingPdfsRows)
    ? result.remainingPdfsRows.length
    : 0;

  // Same source as GET /get-unmatched-invoices: unique unmatched sales invoices
  // that also exist on PDF rows (after this run's remaining sales).
  const remainingSalesDocs = (result.remainingSalesRows || []).map((row) => ({
    data: stripInternalRowIds(row),
  }));
  const unmatchedInvoicesFoundInPdfCount = collectUnmatchedSalesInvoiceNumbers(
    remainingSalesDocs,
    pdfDocs
  ).length;

  const matchDocs = matchedList
    .map((item) => {
      const salesRowId = item.salesRow?.[INTERNAL_SALES_ROW_ID];
      const pdfRowId = item.pdfRow?.[INTERNAL_PDF_ROW_ID];
      if (
        salesRowId === undefined ||
        salesRowId === null ||
        String(salesRowId).trim() === "" ||
        pdfRowId === undefined ||
        pdfRowId === null ||
        String(pdfRowId).trim() === ""
      ) {
        return null;
      }
      return {
        companyId,
        batchId,
        matchedAt,
        recordType: PROCESS_MATCH_RECORD_TYPES.MATCHED,
        matchType: "auto",
        unmatchedInvoicesFoundInPdfCount,
        seq: item.seq,
        salesCombination: String(item.salesCombination ?? "").trim(),
        pdfCombination: String(item.pdfCombination ?? "").trim(),
        matchValue: String(item.matchValue ?? "").trim(),
        matchDuplicate: Boolean(item.matchDuplicate),
        salesRowId: String(salesRowId).trim(),
        pdfRowId: String(pdfRowId).trim(),
        salesRemainingCount,
        pdfRemainingCount,
        ...batchCounts,
      };
    })
    .filter(Boolean);

  let matchesSaved = 0;
  if (matchDocs.length) {
    await ProcessMatch.insertMany(matchDocs, { ordered: false });
    matchesSaved = matchDocs.length;
  }

  const newlyMatchedSalesIds = new Set(matchDocs.map((doc) => String(doc.salesRowId)));
  const itmStatusResult = await applyItmStatusToProcessedSalesRows(
    companyId,
    salesDocsForRun,
    newlyMatchedSalesIds
  );
  const processInvoiceNos = [
    ...new Set(
      salesDocsForRun
        .map((doc) => extractInvFromRowData(doc?.data))
        .filter(Boolean)
    ),
  ];
  const invStatusResult = await updateSalesInvoiceStatusForInvoices(
    companyId,
    processInvoiceNos
  );

  return {
    success: true,
    message: "Process finished. New matches saved with batch counts.",
    batchId,
    matchedAt,
    totalSalesRowCount: salesDocs.length,
    totalPdfRowCount: pdfDocs.length,
    alreadyMatchedSalesCount,
    alreadyMatchedPdfCount,
    unmatchedSalesBeforeCount,
    unmatchedPdfBeforeCount,
    salesRowCount: salesExcelData.length,
    pdfRowCount: pdfItems.length,
    matchesSaved,
    matchDuplicateRuleCount: result.matchDuplicateRuleCount ?? 0,
    salesRemainingCount,
    pdfRemainingCount,
    unmatchedInvoicesFoundInPdfCount,
    itmStatusUpdated: itmStatusResult.updated,
    invStatusUpdated: invStatusResult.updated,
    invStatusInvoices: invStatusResult.invoices,
    stillUnmatchedSales: (result.remainingSalesRows || []).map(stripInternalRowIds),
    stillUnmatchedPdf: (result.remainingPdfsRows || []).map(stripInternalRowIds),
  };
}

async function startProcess(req, res) {
  const companyId = req.companyId;

  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const result = await runStartProcessForCompany(companyId);

  if (!result.success) {
    const status =
      result.totalSalesRowCount != null || result.totalPdfRowCount != null ? 400 : 500;
    return res.status(status).json(result);
  }

  return res.status(200).json({
    ...result,
    message:
      "Process finished on rows not yet present in processmatch. New matches saved; still-unmatched row payloads are included below.",
  });
}

function prefixPdfRowData(pdfData, prefix) {
  if (!pdfData || typeof pdfData !== "object" || Array.isArray(pdfData)) {
    return {};
  }
  const out = {};
  for (const [k, v] of Object.entries(pdfData)) {
    out[`${prefix}${k}`] = v;
  }
  return out;
}

function serializeProcessMatchDoc(doc) {
  if (!doc) return null;
  return {
    id: doc._id?.toString?.() || String(doc._id),
    batchId: doc.batchId,
    matchedAt: doc.matchedAt,
    recordType: doc.recordType || PROCESS_MATCH_RECORD_TYPES.MATCHED,
    seq: doc.seq,
    salesCombination: doc.salesCombination,
    pdfCombination: doc.pdfCombination,
    matchValue: doc.matchValue,
    matchDuplicate: Boolean(doc.matchDuplicate),
    salesRowId: doc.salesRowId,
    pdfRowId: doc.pdfRowId,
    totalSalesRowCount:
      typeof doc.totalSalesRowCount === "number" ? doc.totalSalesRowCount : null,
    totalPdfRowCount:
      typeof doc.totalPdfRowCount === "number" ? doc.totalPdfRowCount : null,
    alreadyMatchedSalesCount:
      typeof doc.alreadyMatchedSalesCount === "number"
        ? doc.alreadyMatchedSalesCount
        : null,
    alreadyMatchedPdfCount:
      typeof doc.alreadyMatchedPdfCount === "number" ? doc.alreadyMatchedPdfCount : null,
    unmatchedSalesBeforeCount:
      typeof doc.unmatchedSalesBeforeCount === "number"
        ? doc.unmatchedSalesBeforeCount
        : null,
    unmatchedPdfBeforeCount:
      typeof doc.unmatchedPdfBeforeCount === "number"
        ? doc.unmatchedPdfBeforeCount
        : null,
    salesRemainingCount:
      typeof doc.salesRemainingCount === "number" ? doc.salesRemainingCount : null,
    pdfRemainingCount:
      typeof doc.pdfRemainingCount === "number" ? doc.pdfRemainingCount : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** GET /process-dates — list batch ids and dates that have saved process matches for this company. */
async function listProcessBatches(req, res) {
  const companyId = req.companyId;

  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  let companyOid;
  try {
    companyOid = new mongoose.Types.ObjectId(String(companyId));
  } catch {
    return res.status(400).json({
      success: false,
      message: "Invalid company context.",
    });
  }

  const batches = await ProcessMatch.aggregate([
    { $match: { companyId: companyOid, ...MATCHED_PROCESS_MATCH_FILTER } },
    {
      $group: {
        _id: "$batchId",
        matchedAt: { $max: "$matchedAt" },
        matchCount: { $sum: 1 },
        totalSalesRowCount: { $max: "$totalSalesRowCount" },
        totalPdfRowCount: { $max: "$totalPdfRowCount" },
        alreadyMatchedSalesCount: { $max: "$alreadyMatchedSalesCount" },
        alreadyMatchedPdfCount: { $max: "$alreadyMatchedPdfCount" },
        unmatchedSalesBeforeCount: { $max: "$unmatchedSalesBeforeCount" },
        unmatchedPdfBeforeCount: { $max: "$unmatchedPdfBeforeCount" },
        salesRemainingCount: { $max: "$salesRemainingCount" },
        pdfRemainingCount: { $max: "$pdfRemainingCount" },
        unmatchedInvoicesFoundInPdfCount: {
          $max: "$unmatchedInvoicesFoundInPdfCount",
        },
      },
    },
    { $sort: { matchedAt: -1 } },
    {
      $project: {
        _id: 0,
        id: "$_id",
        matchedAt: 1,
        matchCount: 1,
        totalSalesRowCount: 1,
        totalPdfRowCount: 1,
        alreadyMatchedSalesCount: 1,
        alreadyMatchedPdfCount: 1,
        unmatchedSalesBeforeCount: 1,
        unmatchedPdfBeforeCount: 1,
        salesRemainingCount: 1,
        pdfRemainingCount: 1,
        unmatchedInvoicesFoundInPdfCount: 1,
      },
    },
  ]);

  return res.status(200).json({
    success: true,
    count: batches.length,
    batches,
  });
}

/**
 * GET /datiles-date-data?id=<batchId>
 * Each processmatch row plus a flat merged object (sales + pdf fields with pdf_ prefix).
 */
async function getProcessBatchDetail(req, res) {
  const companyId = req.companyId;
  const batchId = String(req.query.id ?? "").trim();

  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }
  if (!batchId) {
    return res.status(400).json({
      success: false,
      message: "Query parameter `id` (process batch id) is required.",
    });
  }

  const SalesUploadRow = mongoose.models.SalesUploadRow;
  const PdfUploadRow = mongoose.models.PdfUploadRow;

  if (!SalesUploadRow || !PdfUploadRow) {
    return res.status(500).json({
      success: false,
      message: "Upload row models are not registered.",
    });
  }

  const matches = await ProcessMatch.find({
    companyId,
    batchId,
    ...MATCHED_PROCESS_MATCH_FILTER,
  })
    .sort({ seq: 1, salesRowId: 1 })
    .lean();

  if (!matches.length) {
    return res.status(404).json({
      success: false,
      message: "No process data found for this batch id.",
    });
  }

  const salesRowIds = [...new Set(matches.map((m) => m.salesRowId))];
  const pdfRowIds = [...new Set(matches.map((m) => m.pdfRowId))];

  const [salesDocs, pdfDocs] = await Promise.all([
    SalesUploadRow.find({ companyId, rowId: { $in: salesRowIds } }).lean(),
    PdfUploadRow.find({ companyId, pdfRowId: { $in: pdfRowIds } }).lean(),
  ]);

  const salesByRowId = new Map(salesDocs.map((d) => [d.rowId, d]));
  const pdfByRowId = new Map(pdfDocs.map((d) => [d.pdfRowId, d]));

  const rows = matches.map((m) => {
    const salesDoc = salesByRowId.get(m.salesRowId) || null;
    const pdfDoc = pdfByRowId.get(m.pdfRowId) || null;
    const pm = serializeProcessMatchDoc(m);
    const salesData =
      salesDoc?.data && typeof salesDoc.data === "object" && !Array.isArray(salesDoc.data)
        ? salesDoc.data
        : {};
    const pdfData =
      pdfDoc?.data && typeof pdfDoc.data === "object" && !Array.isArray(pdfDoc.data)
        ? pdfDoc.data
        : {};

    return {
      processMatch: pm,
      merged: {
        ...pm,
        ...salesData,
        ...prefixPdfRowData(pdfData, "pdf_"),
      },
    };
  });

  const first = matches[0];
  const batchMeta = await ProcessMatch.findOne({ companyId, batchId })
    .sort({ matchedAt: -1 })
    .lean();

  return res.status(200).json({
    success: true,
    batchId,
    matchedAt: first?.matchedAt,
    totalSalesRowCount:
      typeof batchMeta?.totalSalesRowCount === "number"
        ? batchMeta.totalSalesRowCount
        : null,
    totalPdfRowCount:
      typeof batchMeta?.totalPdfRowCount === "number" ? batchMeta.totalPdfRowCount : null,
    alreadyMatchedSalesCount:
      typeof batchMeta?.alreadyMatchedSalesCount === "number"
        ? batchMeta.alreadyMatchedSalesCount
        : null,
    alreadyMatchedPdfCount:
      typeof batchMeta?.alreadyMatchedPdfCount === "number"
        ? batchMeta.alreadyMatchedPdfCount
        : null,
    unmatchedSalesBeforeCount:
      typeof batchMeta?.unmatchedSalesBeforeCount === "number"
        ? batchMeta.unmatchedSalesBeforeCount
        : null,
    unmatchedPdfBeforeCount:
      typeof batchMeta?.unmatchedPdfBeforeCount === "number"
        ? batchMeta.unmatchedPdfBeforeCount
        : null,
    unmatchedInvoicesFoundInPdfCount:
      typeof batchMeta?.unmatchedInvoicesFoundInPdfCount === "number"
        ? batchMeta.unmatchedInvoicesFoundInPdfCount
        : null,
    salesRemainingCount:
      typeof first?.salesRemainingCount === "number" ? first.salesRemainingCount : null,
    pdfRemainingCount:
      typeof first?.pdfRemainingCount === "number" ? first.pdfRemainingCount : null,
    count: rows.length,
    rows,
  });
}

/**
 * GET /get-unmatched-rows
 * Sales and PDF upload rows for this company that are not referenced in processmatch yet.
 */
async function getUnmatchedRows(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const loaded = await loadUnmatchedUploadRows(companyId);
  if (loaded.error) {
    return res.status(500).json({
      success: false,
      message: loaded.error,
    });
  }

  const {
    salesDocs,
    pdfDocs,
    salesRows,
    pdfRows,
  } = loaded;

  return res.status(200).json({
    success: true,
    totalSalesRowCount: salesDocs.length,
    totalPdfRowCount: pdfDocs.length,
    matchedSalesRowCount: salesDocs.length - salesRows.length,
    matchedPdfRowCount: pdfDocs.length - pdfRows.length,
    salesUnmatchedCount: salesRows.length,
    pdfUnmatchedCount: pdfRows.length,
    salesRows,
    pdfRows,
  });
}

/**
 * GET /get-unmatched-invoices?status=exception|ignored
 * - No status (default): distinct invoice numbers that still have unmatched
 *   (Available) sales rows and at least one PDF row.
 * - status=exception: invoices that have at least one Exception row.
 * - status=ignored:   invoices that have at least one Ignored row.
 * (An invoice with one Exception + one Ignored row shows up in both.)
 */
async function getUnmatchedInvoices(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const loaded = await loadUnmatchedUploadRows(companyId);
  if (loaded.error) {
    return res.status(500).json({
      success: false,
      message: loaded.error,
    });
  }

  const statusFilter = String(req.query.status ?? req.query.filter ?? "")
    .trim()
    .toLowerCase();

  let invoices;
  let appliedStatus;
  if (statusFilter === ROW_STATUS.EXCEPTION || statusFilter === ROW_STATUS.IGNORED) {
    appliedStatus = statusFilter;
    invoices = collectInvoicesByRowStatus(
      loaded.salesDocs,
      loaded.pdfDocs,
      statusFilter
    );
  } else {
    appliedStatus = ROW_STATUS.AVAILABLE;
    invoices = collectUnmatchedSalesInvoiceNumbers(
      loaded.unmatchedSalesDocs,
      loaded.pdfDocs
    );
  }

  return res.status(200).json({
    success: true,
    status: appliedStatus,
    count: invoices.length,
    invoices,
  });
}

/**
 * GET /get-unmatched-rows-by-invoice?invoice=<inv>
 * Unmatched sales + PDF rows for one invoice number (includes row ids).
 */
async function getUnmatchedRowsByInvoice(req, res) {
  const companyId = req.companyId;
  const invoice = String(req.query.invoice ?? req.query.inv ?? "").trim();

  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }
  if (!invoice) {
    return res.status(400).json({
      success: false,
      message: "Query parameter `invoice` is required.",
    });
  }

  const loaded = await loadUnmatchedUploadRows(companyId);
  if (loaded.error) {
    return res.status(500).json({
      success: false,
      message: loaded.error,
    });
  }

  const displayConfig = await loadManualMatchDisplayConfig(companyId);

  const salesRows = loaded.salesDocs
    .filter((doc) => invoiceKeysMatch(extractInvFromRowData(doc.data), invoice))
    .map((doc) => {
      const isMatched = loaded.matchedSalesSet.has(String(doc.rowId));
      const rowStatus = isMatched
        ? ROW_STATUS.AVAILABLE
        : normalizeRowStatus(doc.rowStatus);
      return {
        ...serializeSalesUploadRowForManualMatch(doc, displayConfig),
        isMatched,
        rowStatus: isMatched ? "matched" : rowStatus,
      };
    })
    .sort((a, b) => {
      if (Boolean(a.isMatched) !== Boolean(b.isMatched)) {
        return a.isMatched ? 1 : -1;
      }
      const aClosed = isClosedRowStatus(a.rowStatus);
      const bClosed = isClosedRowStatus(b.rowStatus);
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      return (a.rowIndex ?? 0) - (b.rowIndex ?? 0);
    });

  const pdfRows = loaded.pdfDocs
    .filter((doc) => invoiceKeysMatch(extractInvFromRowData(doc.data), invoice))
    .map((doc) => {
      const isMatched = loaded.matchedPdfUploadRowIdSet.has(
        String(doc.pdfRowId).trim()
      );
      const rowStatus = isMatched
        ? ROW_STATUS.AVAILABLE
        : normalizeRowStatus(doc.rowStatus);
      return {
        ...serializePdfUploadRowForManualMatch(doc, displayConfig),
        isMatched,
        rowStatus: isMatched ? "matched" : rowStatus,
      };
    })
    .sort((a, b) => {
      if (Boolean(a.isMatched) !== Boolean(b.isMatched)) {
        return a.isMatched ? 1 : -1;
      }
      const aClosed = isClosedRowStatus(a.rowStatus);
      const bClosed = isClosedRowStatus(b.rowStatus);
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      return (a.pdfRowIndex ?? 0) - (b.pdfRowIndex ?? 0);
    });

  const unmatchedSalesCount = salesRows.filter(
    (row) => !row.isMatched && !isClosedRowStatus(row.rowStatus)
  ).length;
  const unmatchedPdfCount = pdfRows.filter(
    (row) => !row.isMatched && !isClosedRowStatus(row.rowStatus)
  ).length;
  const matchedSalesCount = salesRows.filter((row) => row.isMatched).length;
  const matchedPdfCount = pdfRows.filter((row) => row.isMatched).length;

  return res.status(200).json({
    success: true,
    invoice,
    salesCount: salesRows.length,
    pdfCount: pdfRows.length,
    unmatchedSalesCount,
    unmatchedPdfCount,
    matchedSalesCount,
    matchedPdfCount,
    displayColumns: displayConfig.displayColumns,
    salesDescriptionColumn: displayConfig.salesDescriptionColumn,
    pdfDescriptionField: displayConfig.pdfDescriptionField,
    salesRows,
    pdfRows,
  });
}

/**
 * GET /fully-matched-sb-by-date?companyId=&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Sales rows filtered by headerMapping.filterDate column → unique invoices →
 * keep only fully matched invoices (matched + Ignored) → unique PDF SB Nos.
 */
async function getFullyMatchedSbByDate(req, res) {
  // Siteadmin passes companyId; company-admin session may still set req.companyId.
  const companyIdRaw = String(
    req.query.companyId ??
      req.body?.companyId ??
      req.params?.companyId ??
      req.companyId ??
      ""
  ).trim();
  if (!companyIdRaw) {
    return res.status(400).json({
      success: false,
      message: "Query parameter `companyId` is required.",
    });
  }
  if (!mongoose.Types.ObjectId.isValid(companyIdRaw)) {
    return res.status(400).json({
      success: false,
      message: "Invalid `companyId`.",
    });
  }
  const companyId = companyIdRaw;

  const startDate = String(
    req.query.startDate ?? req.query.fromDate ?? req.query.start ?? ""
  ).trim();
  const endDate = String(
    req.query.endDate ?? req.query.toDate ?? req.query.end ?? ""
  ).trim();

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      message: "Query parameters `startDate` and `endDate` are required (YYYY-MM-DD).",
    });
  }
  if (!parseBoundaryDate(startDate, "start") || !parseBoundaryDate(endDate, "end")) {
    return res.status(400).json({
      success: false,
      message: "Invalid `startDate` or `endDate`. Use YYYY-MM-DD.",
    });
  }

  // Ensure upload-row models are registered (siteadmin billing may run without hitting sales/pdf routes first).
  require("#controllers/company/admin/process/sales/salesdata");
  require("#controllers/company/admin/process/pdf/pdfdata");

  const headerDoc = await HeaderMapping.findOne({ companyId })
    .select({ filterDate: 1 })
    .lean();
  const filterDateColumn = getFilterDateColumnName(headerDoc?.filterDate);
  if (!filterDateColumn) {
    return res.status(400).json({
      success: false,
      message:
        'filterDate header mapping is required (e.g. { "date": "Billing Date" }).',
    });
  }

  const loaded = await loadUnmatchedUploadRows(companyId);
  if (loaded.error) {
    return res.status(500).json({
      success: false,
      message: loaded.error,
    });
  }

  const salesInRange = loaded.salesDocs.filter((doc) =>
    isSalesRowDateInRange(doc, filterDateColumn, startDate, endDate)
  );

  const invoiceByNormKey = new Map();
  for (const doc of salesInRange) {
    const inv = extractInvFromRowData(doc?.data);
    const key = normalizeInvoiceKey(inv);
    if (!key) continue;
    const norm = key.toLowerCase();
    if (!invoiceByNormKey.has(norm)) {
      invoiceByNormKey.set(norm, inv);
    }
  }

  const invoiceNormKeys = new Set(invoiceByNormKey.keys());

  const salesByInv = new Map();
  for (const doc of loaded.salesDocs) {
    const inv = extractInvFromRowData(doc?.data);
    const key = normalizeInvoiceKey(inv);
    if (!key) continue;
    const norm = key.toLowerCase();
    if (!invoiceNormKeys.has(norm)) continue;
    if (!salesByInv.has(norm)) salesByInv.set(norm, []);
    salesByInv.get(norm).push({
      invoice: inv,
      isMatched: loaded.matchedSalesSet.has(String(doc.rowId)),
      rowStatus: normalizeRowStatus(doc.rowStatus),
    });
  }

  const pdfByInv = new Map();
  for (const doc of loaded.pdfDocs) {
    const inv = extractInvFromRowData(doc?.data);
    const key = normalizeInvoiceKey(inv);
    if (!key) continue;
    const norm = key.toLowerCase();
    if (!invoiceNormKeys.has(norm)) continue;
    if (!pdfByInv.has(norm)) pdfByInv.set(norm, []);
    const isMatched = loaded.matchedPdfUploadRowIdSet.has(String(doc.pdfRowId).trim());
    pdfByInv.get(norm).push({
      invoice: inv,
      isMatched,
      rowStatus: normalizeRowStatus(doc.rowStatus),
      sbNo: isMatched ? extractSbNoFromPdfData(doc.data) : "",
    });
  }

  const fullyMatched = [];
  const globalSbNoByNorm = new Map();

  for (const [norm, displayInv] of invoiceByNormKey.entries()) {
    const salesRows = salesByInv.get(norm) || [];
    const pdfRows = pdfByInv.get(norm) || [];
    if (!isInvoiceFullyMatched(salesRows, pdfRows)) continue;

    const invSbNoByNorm = new Map();
    for (const row of pdfRows) {
      if (!row.isMatched) continue;
      const sbNo = String(row.sbNo || "").trim();
      if (!sbNo) continue;
      const sbKey = normalizeSbNoForMatch(sbNo);
      if (!sbKey) continue;
      if (!invSbNoByNorm.has(sbKey)) invSbNoByNorm.set(sbKey, sbNo);
      if (!globalSbNoByNorm.has(sbKey)) globalSbNoByNorm.set(sbKey, sbNo);
    }

    const sbNos = [...invSbNoByNorm.values()].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
    );

    fullyMatched.push({
      invoice: displayInv,
      sbNos,
      sbNo: sbNos[0] || "",
    });
  }

  fullyMatched.sort((a, b) =>
    String(a.invoice).localeCompare(String(b.invoice), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
  const sbNos = [...globalSbNoByNorm.values()].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
  );

  return res.status(200).json({
    success: true,
    companyId,
    startDate,
    endDate,
    filterDateColumn,
    salesRowsInRange: salesInRange.length,
    uniqueInvoicesInRange: invoiceByNormKey.size,
    fullyMatchedInvoiceCount: fullyMatched.length,
    fullyMatched,
    sbNoCount: sbNos.length,
    sbNos,
  });
}

/**
 * POST /manual-match-rows-by-invoice
 * Body: { matches: [{ salesRowId, pdfRowId }, ...] }
 * Also accepts parallel arrays salesRowIds + pdfRowIds.
 */
async function manualMatchRowsByInvoice(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const parsed = parseManualMatchPairs(req.body || {});
  if (parsed.error) {
    return res.status(400).json({
      success: false,
      message: parsed.error,
    });
  }

  const invoice = String(req.body?.invoice ?? req.body?.inv ?? "").trim();
  const pairs = parsed.pairs;

  const SalesUploadRow = mongoose.models.SalesUploadRow;
  const PdfUploadRow = mongoose.models.PdfUploadRow;
  if (!SalesUploadRow || !PdfUploadRow) {
    return res.status(500).json({
      success: false,
      message: "Upload row models are not registered.",
    });
  }

  const salesRowIds = [...new Set(pairs.map((p) => p.salesRowId))];
  const pdfRowIds = [...new Set(pairs.map((p) => p.pdfRowId))];

  const [salesDocs, pdfDocs, allPdfDocs, matchedSalesRowIds, processMatches] = await Promise.all([
    SalesUploadRow.find({ companyId, rowId: { $in: salesRowIds } }).lean(),
    PdfUploadRow.find({ companyId, pdfRowId: { $in: pdfRowIds } }).lean(),
    PdfUploadRow.find({ companyId }).select({ pdfRowId: 1, rowId: 1, data: 1 }).lean(),
    distinctMatchedRowIds(companyId, "salesRowId"),
    loadProcessMatches(companyId, ProcessMatch),
  ]);

  const salesByRowId = new Map(salesDocs.map((d) => [String(d.rowId), d]));
  const pdfByRowId = new Map(pdfDocs.map((d) => [String(d.pdfRowId), d]));
  const matchedSalesSet = new Set(matchedSalesRowIds.map((id) => String(id)));
  const matchedPdfUploadRowIdSet = buildMatchedPdfUploadRowIdSet(allPdfDocs, processMatches);
  const usedSalesIds = new Set();
  const usedPdfIds = new Set();

  const errors = [];
  const validPairs = [];

  for (const pair of pairs) {
    const salesDoc = salesByRowId.get(pair.salesRowId);
    const pdfDoc = pdfByRowId.get(pair.pdfRowId);

    if (!salesDoc) {
      errors.push({ ...pair, message: "Sales row not found for this company." });
      continue;
    }
    if (!pdfDoc) {
      errors.push({ ...pair, message: "PDF row not found for this company." });
      continue;
    }
    if (matchedSalesSet.has(pair.salesRowId)) {
      errors.push({ ...pair, message: "Sales row is already matched." });
      continue;
    }
    if (matchedPdfUploadRowIdSet.has(pair.pdfRowId)) {
      errors.push({ ...pair, message: "PDF row is already matched." });
      continue;
    }
    if (isClosedRowStatus(salesDoc.rowStatus)) {
      errors.push({
        ...pair,
        message: `Sales row status is "${normalizeRowStatus(salesDoc.rowStatus)}" and cannot be matched.`,
      });
      continue;
    }
    if (isClosedRowStatus(pdfDoc.rowStatus)) {
      errors.push({
        ...pair,
        message: `PDF row status is "${normalizeRowStatus(pdfDoc.rowStatus)}" and cannot be matched.`,
      });
      continue;
    }
    if (usedSalesIds.has(pair.salesRowId)) {
      errors.push({ ...pair, message: "Duplicate salesRowId in request." });
      continue;
    }
    if (usedPdfIds.has(pair.pdfRowId)) {
      errors.push({ ...pair, message: "Duplicate pdfRowId in request." });
      continue;
    }

    const salesInv = extractInvFromRowData(salesDoc.data);
    const pdfInv = extractInvFromRowData(pdfDoc.data);
    if (invoice && (!invoiceKeysMatch(salesInv, invoice) || !invoiceKeysMatch(pdfInv, invoice))) {
      errors.push({
        ...pair,
        message: `Row invoice does not match requested invoice "${invoice}".`,
      });
      continue;
    }
    if (!invoiceKeysMatch(salesInv, pdfInv)) {
      errors.push({
        ...pair,
        message: `Sales invoice "${salesInv || "—"}" does not match PDF invoice "${pdfInv || "—"}".`,
      });
      continue;
    }

    validPairs.push({
      ...pair,
      matchValue: normalizeInvoiceKey(salesInv) || salesInv,
    });
    usedSalesIds.add(pair.salesRowId);
    usedPdfIds.add(pair.pdfRowId);
  }

  if (!validPairs.length) {
    return res.status(400).json({
      success: false,
      message: "No valid row pairs to save.",
      errors,
    });
  }

  const batchId = crypto.randomUUID();
  const matchedAt = new Date();
  const matchValue = validPairs[0].matchValue || invoice || "";

  const matchDocs = validPairs.map((pair, idx) => ({
    companyId,
    batchId,
    matchedAt,
    recordType: PROCESS_MATCH_RECORD_TYPES.MATCHED,
    matchType: "manual",
    seq: idx + 1,
    salesCombination: "INV",
    pdfCombination: "INV",
    matchValue: pair.matchValue || matchValue,
    matchDuplicate: false,
    salesRowId: pair.salesRowId,
    pdfRowId: pair.pdfRowId,
    salesRemainingCount: 0,
    pdfRemainingCount: 0,
  }));

  await ProcessMatch.insertMany(matchDocs, { ordered: false });

  const invoiceNos = [
    ...new Set(
      validPairs
        .map((pair) => {
          const salesDoc = salesByRowId.get(pair.salesRowId);
          return extractInvFromRowData(salesDoc?.data);
        })
        .filter(Boolean)
    ),
  ];
  if (invoice) invoiceNos.push(invoice);
  const invStatusResult = await updateSalesInvoiceStatusForInvoices(companyId, invoiceNos);

  return res.status(200).json({
    success: true,
    message: `Saved ${matchDocs.length} manual match(es).`,
    batchId,
    matchedAt,
    invoice: invoice || matchValue,
    matchesSaved: matchDocs.length,
    invStatusUpdated: invStatusResult.updated,
    invStatusInvoices: invStatusResult.invoices,
    matches: matchDocs.map((doc) => ({
      salesRowId: doc.salesRowId,
      pdfRowId: doc.pdfRowId,
      matchValue: doc.matchValue,
    })),
    errors,
  });
}

/**
 * POST /update-row-status
 * Body: { side: "sales"|"pdf", rowId: string, status: "available"|"exception"|"ignored" }
 * Moves an unmatched row between Available <-> Exception/Ignored. Matched rows are rejected.
 */
async function updateRowStatus(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const side = String(req.body?.side ?? req.body?.type ?? "")
    .trim()
    .toLowerCase();
  const rowId = String(
    req.body?.rowId ?? req.body?.pdfRowId ?? req.body?.id ?? ""
  ).trim();
  const status = normalizeRowStatus(req.body?.status ?? req.body?.rowStatus);

  if (side !== "sales" && side !== "pdf") {
    return res.status(400).json({
      success: false,
      message: '`side` must be "sales" or "pdf".',
    });
  }
  if (!rowId) {
    return res.status(400).json({
      success: false,
      message: "`rowId` is required.",
    });
  }
  if (
    status !== ROW_STATUS.AVAILABLE &&
    !UPDATABLE_ROW_STATUSES.has(status)
  ) {
    return res.status(400).json({
      success: false,
      message: '`status` must be "available", "exception", or "ignored".',
    });
  }

  const SalesUploadRow = mongoose.models.SalesUploadRow;
  const PdfUploadRow = mongoose.models.PdfUploadRow;
  if (!SalesUploadRow || !PdfUploadRow) {
    return res.status(500).json({
      success: false,
      message: "Upload row models are not registered.",
    });
  }

  if (side === "sales") {
    const matchedSalesIds = await distinctMatchedRowIds(companyId, "salesRowId");
    if (matchedSalesIds.map(String).includes(rowId)) {
      return res.status(400).json({
        success: false,
        message: "Matched sales rows cannot change status.",
      });
    }

    const existing = await SalesUploadRow.findOne({ companyId, rowId }).lean();
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Sales row not found for this company.",
      });
    }

    const doc = await SalesUploadRow.findOneAndUpdate(
      { companyId, rowId },
      { $set: { rowStatus: status } },
      { new: true }
    ).lean();

    return res.status(200).json({
      success: true,
      message: `Sales row status updated to ${status}.`,
      side: "sales",
      rowId: doc.rowId,
      rowStatus: normalizeRowStatus(doc.rowStatus),
    });
  }

  const processMatches = await loadProcessMatches(companyId, ProcessMatch);
  const pdfDocs = await PdfUploadRow.find({ companyId })
    .select({ pdfRowId: 1, rowId: 1, data: 1 })
    .lean();
  const matchedPdfIds = buildMatchedPdfUploadRowIdSet(pdfDocs, processMatches);
  if (matchedPdfIds.has(rowId)) {
    return res.status(400).json({
      success: false,
      message: "Matched PDF rows cannot change status.",
    });
  }

  const existing = await PdfUploadRow.findOne({ companyId, pdfRowId: rowId }).lean();
  if (!existing) {
    return res.status(404).json({
      success: false,
      message: "PDF row not found for this company.",
    });
  }

  const doc = await PdfUploadRow.findOneAndUpdate(
    { companyId, pdfRowId: rowId },
    { $set: { rowStatus: status } },
    { new: true }
  ).lean();

  return res.status(200).json({
    success: true,
    message: `PDF row status updated to ${status}.`,
    side: "pdf",
    rowId: doc.pdfRowId,
    rowStatus: normalizeRowStatus(doc.rowStatus),
  });
}

function parseMergeRowIds(body = {}) {
  const fromArray = Array.isArray(body.rowIds)
    ? body.rowIds
    : Array.isArray(body.ids)
      ? body.ids
      : Array.isArray(body.salesRowIds)
        ? body.salesRowIds
        : null;

  if (fromArray && fromArray.length >= 2) {
    return {
      keepRowId: String(fromArray[0] ?? "").trim(),
      removeRowId: String(fromArray[1] ?? "").trim(),
    };
  }

  const keepRowId = String(
    body.keepRowId ??
      body.rowId1 ??
      body.salesRowId1 ??
      body.primaryRowId ??
      body.firstRowId ??
      ""
  ).trim();
  const removeRowId = String(
    body.removeRowId ??
      body.rowId2 ??
      body.salesRowId2 ??
      body.secondaryRowId ??
      body.secondRowId ??
      ""
  ).trim();

  return { keepRowId, removeRowId };
}

/**
 * POST /merge-rows
 * Body: { rowId1, rowId2 } or { rowIds: [id1, id2] }
 *
 * Merges two sales upload rows into the first:
 * - columns with sales-data-clean `sum: true` → numeric sum
 * - all other columns → keep first row value (no description concat)
 * Deletes the second row and remaps processmatch.salesRowId if needed.
 */
async function mergeRows(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const { keepRowId, removeRowId } = parseMergeRowIds(req.body || {});
  if (!keepRowId || !removeRowId) {
    return res.status(400).json({
      success: false,
      message: "Provide two sales row ids (rowId1 + rowId2, or rowIds: [id1, id2]).",
    });
  }
  if (keepRowId === removeRowId) {
    return res.status(400).json({
      success: false,
      message: "Cannot merge a row with itself.",
    });
  }

  const SalesUploadRow = mongoose.models.SalesUploadRow;
  if (!SalesUploadRow) {
    return res.status(500).json({
      success: false,
      message: "SalesUploadRow model is not registered. Load sales routes once.",
    });
  }

  const {
    loadSalesDataCleanRules,
    mergeSalesRowData,
  } = require("#utils/applySalesDataClean");

  const [keepDoc, removeDoc, cleanRules] = await Promise.all([
    SalesUploadRow.findOne({ companyId, rowId: keepRowId }),
    SalesUploadRow.findOne({ companyId, rowId: removeRowId }),
    loadSalesDataCleanRules(companyId),
  ]);

  if (!keepDoc) {
    return res.status(404).json({
      success: false,
      message: `Keep sales row not found: ${keepRowId}`,
    });
  }
  if (!removeDoc) {
    return res.status(404).json({
      success: false,
      message: `Remove sales row not found: ${removeRowId}`,
    });
  }

  const primaryData =
    keepDoc.data && typeof keepDoc.data === "object" ? keepDoc.data : {};
  const secondaryData =
    removeDoc.data && typeof removeDoc.data === "object" ? removeDoc.data : {};

  const sumColumns = (cleanRules || [])
    .filter((r) => r.sum)
    .map((r) => r.columnName);

  const mergedData = mergeSalesRowData(primaryData, secondaryData, cleanRules);

  keepDoc.data = mergedData;
  await keepDoc.save();

  // Remap any processmatch links from removed sales row → kept row.
  const remapResult = await ProcessMatch.updateMany(
    {
      companyId,
      salesRowId: removeRowId,
    },
    { $set: { salesRowId: keepRowId } }
  );

  await SalesUploadRow.deleteOne({ companyId, rowId: removeRowId });

  return res.status(200).json({
    success: true,
    message: "Sales rows merged.",
    keepRowId,
    removeRowId,
    sumColumns,
    remappedProcessMatches: remapResult.modifiedCount || 0,
    mergedRow: {
      rowId: keepDoc.rowId,
      rowIndex: keepDoc.rowIndex,
      data: mergedData,
      rowStatus: keepDoc.rowStatus || "available",
    },
  });
}

module.exports = {
  startProcess,
  runStartProcessForCompany,
  listProcessBatches,
  getProcessBatchDetail,
  getUnmatchedRows,
  getUnmatchedInvoices,
  getUnmatchedRowsByInvoice,
  getFullyMatchedSbByDate,
  manualMatchRowsByInvoice,
  updateRowStatus,
  mergeRows,
  updateSalesInvoiceStatusByInv,
};
