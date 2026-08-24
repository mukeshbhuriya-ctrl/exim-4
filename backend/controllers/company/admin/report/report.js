const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { ProcessMatch, MATCHED_PROCESS_MATCH_FILTER } = require("#utils/processMatch");
const { ChaMatchProcess } = require("#utils/chaMatchCollections");
const { SbOnline, makeShippingBillKey } = require("#utils/sbOnline");
const { DgftProcess } = require("#utils/dgftProcess");
const { DgftBatch } = require("#utils/dgftBatch");
const { ReportTemplate } = require("#utils/reportTemplate");
const { HeaderMapping } = require("#utils/headerMapping");
const { Combination } = require("#utils/combination");
const {
  getSalesInvFromRow,
  resolveSalesInvSource,
} = require("#controllers/company/admin/cha/match_process");
const { buildSalesInvStatusLabelByInv } = require("#controllers/company/admin/dashboard/salesInvMatchCounts");
const { buildPdfFlatColumnCatalog } = require("#controllers/company/admin/process/pdf/pdf_extract_data");
const { buildShippingReportColumnCatalog } = require("../../../../web_scraping/shipping_bill/dricat");
require("#utils/chaData");

const MAX_REPORT_ROWS = 25000;
const REPORT_STATUS_COLUMN = "status";

/** Supported report segments. `dgft` / `cha` can be merge flags on SB/PDF reports; `cha` alone is a full report type. */
const REPORT_ROW_TYPES = new Set(["pdf", "sb", "dgft", "cha"]);

/**
 * Normalize `type` from JSON: "pdf", "sb", "sb,dgft", "pdf,sb", "pdf,sb,dgft",
 * "pdf+sb", or ["pdf","sb","dgft"].
 * `dgft` is accepted as an optional flag on top of SB-capable reports.
 */
function normalizeTypeInput(raw) {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x ?? "").trim().toLowerCase())
      .filter(Boolean);
  }
  const s = String(raw).trim().toLowerCase();
  if (!s) return [];
  if (s.includes(",") || s.includes("+")) {
    return s
      .split(/[,+]/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [s];
}

function normalizeRowstype(raw) {
  const parts = normalizeTypeInput(raw);
  if (!parts.length) return "";

  const uniq = [...new Set(parts)];
  for (const p of uniq) {
    if (!REPORT_ROW_TYPES.has(p)) return "";
  }

  const hasPdf = uniq.includes("pdf");
  const hasSb = uniq.includes("sb");
  const hasCha = uniq.includes("cha");
  const hasDgft = uniq.includes("dgft");

  if (uniq.length === 1 && hasCha) return "cha";
  if (uniq.length === 1 && hasPdf) return "pdf";
  if (uniq.length === 1 && hasSb) return "sb";
  if (uniq.length === 2 && hasSb && hasDgft) return "sb";
  if (uniq.length === 2 && hasPdf && hasCha) return "pdf";
  if (uniq.length === 2 && hasSb && hasCha) return "sb";
  if (uniq.length === 3 && hasSb && hasCha && hasDgft) return "sb";
  if (uniq.length === 2 && hasPdf && hasSb) return "pdf,sb";
  if (uniq.length === 3 && hasPdf && hasSb && hasCha) return "pdf,sb";
  if (uniq.length === 4 && hasPdf && hasSb && hasCha && hasDgft) return "pdf,sb";

  return "";
}

function readReportInput(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const q = req.query || {};
  const rawType = body.type ?? body.rowstype ?? body.rowsType ?? q.rowstype ?? q.rowsType;
  const rowstype = normalizeRowstype(rawType);
  const typeParts = normalizeTypeInput(rawType);
  const includeDgft = typeParts.includes("dgft");
  const includeCha = typeParts.includes("cha");
  const rawColumns = body.columns ?? q.columns;
  let columns = [];
  if (Array.isArray(rawColumns)) {
    columns = rawColumns.map((c) => String(c ?? "").trim()).filter(Boolean);
  } else if (typeof rawColumns === "string") {
    columns = rawColumns
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
  }
  const fromDate =
    body.fromDate ?? body.from ?? q.fromDate ?? q.from ?? null;
  const toDate = body.toDate ?? body.to ?? q.toDate ?? q.to ?? null;
  const templateId = String(
    body.templateId ?? body.templateid ?? q.templateId ?? q.templateid ?? ""
  ).trim();
  return { rowstype, fromDate, toDate, includeDgft, includeCha, columns, templateId };
}

function ensureStatusInColumnList(columns) {
  const list = Array.isArray(columns)
    ? columns.map((c) => String(c ?? "").trim()).filter(Boolean)
    : [];
  if (!list.length || list.includes(REPORT_STATUS_COLUMN)) return list;
  return [REPORT_STATUS_COLUMN, ...list];
}

function ensureStatusInColumnOrder(columnOrder) {
  const list = Array.isArray(columnOrder)
    ? columnOrder.map((c) => String(c ?? "").trim()).filter(Boolean)
    : [];
  if (!list.length || list.includes(REPORT_STATUS_COLUMN)) return list;
  return [REPORT_STATUS_COLUMN, ...list];
}

function salesDataFromReportRow(row) {
  const merged =
    row?.merged && typeof row.merged === "object" && !Array.isArray(row.merged)
      ? row.merged
      : {};
  const out = {};
  for (const [key, value] of Object.entries(merged)) {
    if (key.startsWith("sales.")) {
      out[key.slice(6)] = value;
    }
  }
  if (Object.keys(out).length) return out;

  const salesData = row?.salesRow?.data;
  if (salesData && typeof salesData === "object" && !Array.isArray(salesData)) {
    return salesData;
  }
  return {};
}

function applyReportRowMatchStatus(rows, statusByInv, salesInvSource) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const inv = getSalesInvFromRow(salesDataFromReportRow(row), salesInvSource);
    const status =
      inv && statusByInv instanceof Map && statusByInv.has(inv) ? statusByInv.get(inv) : "";
    return {
      ...row,
      merged: {
        ...(row.merged || {}),
        [REPORT_STATUS_COLUMN]: status,
      },
    };
  });
}

function projectRowsByColumns(rows, columns) {
  const list = Array.isArray(rows) ? rows : [];
  const wanted = Array.isArray(columns) ? columns.filter(Boolean) : [];
  if (!wanted.length) return list;

  const namespaces = ["sales", "pdf", "sb", "dgft", "pm", "cha", "cm"];

  function resolveValue(src, requestedKey) {
    if (Object.prototype.hasOwnProperty.call(src, requestedKey)) {
      return src[requestedKey];
    }
    for (const ns of namespaces) {
      const k = `${ns}.${requestedKey}`;
      if (Object.prototype.hasOwnProperty.call(src, k)) return src[k];
    }
    return "";
  }

  return list.map((row) => {
    const src = row && typeof row === "object" && !Array.isArray(row) ? row : {};
    const out = {};
    for (const key of wanted) {
      out[key] = resolveValue(src, key);
    }
    return out;
  });
}

function resolveMergedColumnValue(src, requestedKey, preferredNamespaces = []) {
  if (Object.prototype.hasOwnProperty.call(src, requestedKey)) {
    return src[requestedKey];
  }

  const fallbackNamespaces = ["sales", "pdf", "sb", "dgft", "pm", "cha", "cm"];
  const namespaces = [...new Set([...(preferredNamespaces || []), ...fallbackNamespaces])];
  for (const ns of namespaces) {
    const k = `${ns}.${requestedKey}`;
    if (Object.prototype.hasOwnProperty.call(src, k)) return src[k];
  }
  return "";
}

function normalizeMappingItemsInput(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const type = String(item.type ?? "").trim();
      const sourceHeader = String(
        item.sourceHeader ?? item.sourceColumn ?? item.source ?? ""
      ).trim();
      const customHeader = String(
        item.customHeader ?? item.outputColumn ?? item.custom ?? sourceHeader
      ).trim();
      if (!type || !sourceHeader) return null;
      const seq = Number(item.seq);
      const dataTypeRaw = String(
        item.dataType ?? item.columnType ?? item.valueType ?? "string"
      )
        .trim()
        .toLowerCase();
      const dataType = ["date", "number", "decimal"].includes(dataTypeRaw)
        ? dataTypeRaw
        : "string";
      return {
        seq: Number.isFinite(seq) && seq >= 1 ? seq : index + 1,
        type,
        sourceHeader,
        customHeader: customHeader || sourceHeader,
        dataType,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.seq - b.seq);
}

function buildMappingFromItems(items) {
  const mapping = {};
  for (const item of items) {
    if (!mapping[item.type]) mapping[item.type] = {};
    mapping[item.type][item.sourceHeader] = item.customHeader;
  }
  return mapping;
}

/** Output column headers in template seq order (mappingItems preferred). */
function templateColumnOrder(templateDoc) {
  if (!templateDoc) return [];
  const items = normalizeMappingItemsInput(templateDoc.mappingItems);
  if (items.length) {
    const seen = new Set();
    const order = [];
    for (const item of items) {
      const key = item.customHeader;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
    return order;
  }

  const mapping =
    templateDoc.mapping && typeof templateDoc.mapping === "object" && !Array.isArray(templateDoc.mapping)
      ? templateDoc.mapping
      : {};
  const sectionOrder = ["sales", "pdf", "shipping", "sb", "dgft", "cha", "pm", "cm"];
  const order = [];
  const seen = new Set();
  for (const section of sectionOrder) {
    const sectionMapping = mapping[section];
    if (!sectionMapping || typeof sectionMapping !== "object" || Array.isArray(sectionMapping)) {
      continue;
    }
    for (const outputColumn of Object.values(sectionMapping)) {
      const key = String(outputColumn ?? "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
  }
  for (const [section, sectionMapping] of Object.entries(mapping)) {
    if (sectionOrder.includes(section)) continue;
    if (!sectionMapping || typeof sectionMapping !== "object" || Array.isArray(sectionMapping)) {
      continue;
    }
    for (const outputColumn of Object.values(sectionMapping)) {
      const key = String(outputColumn ?? "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
  }
  return order;
}

function projectRowsByTemplate(rows, mapping, mappingItems) {
  const list = Array.isArray(rows) ? rows : [];
  const mapObj = mapping && typeof mapping === "object" && !Array.isArray(mapping) ? mapping : {};
  const orderedItems = normalizeMappingItemsInput(mappingItems);
  if (!Object.keys(mapObj).length && !orderedItems.length) return list;

  const sectionToNamespaces = {
    sales: ["sales"],
    pdf: ["pdf"],
    shipping: ["sb"],
    sb: ["sb"],
    dgft: ["dgft"],
    pm: ["pm"],
    cha: ["cha", "cm"],
    cm: ["cm"],
  };

  const entries = [];
  if (orderedItems.length) {
    for (const item of orderedItems) {
      entries.push({
        sourceKey: item.sourceHeader,
        outputKey: item.customHeader,
        preferredNamespaces: sectionToNamespaces[String(item.type).toLowerCase()] || [],
      });
    }
  } else {
    for (const [section, sectionMapping] of Object.entries(mapObj)) {
      if (!sectionMapping || typeof sectionMapping !== "object" || Array.isArray(sectionMapping)) {
        continue;
      }
      for (const [sourceColumn, outputColumn] of Object.entries(sectionMapping)) {
        const sourceKey = String(sourceColumn ?? "").trim();
        const outputKey = String(outputColumn ?? "").trim();
        if (!sourceKey || !outputKey) continue;
        entries.push({
          sourceKey,
          outputKey,
          preferredNamespaces: sectionToNamespaces[String(section).toLowerCase()] || [],
        });
      }
    }
  }
  if (!entries.length) return list;

  return list.map((row) => {
    const src = row && typeof row === "object" && !Array.isArray(row) ? row : {};
    const out = {};
    for (const item of entries) {
      out[item.outputKey] = resolveMergedColumnValue(
        src,
        item.sourceKey,
        item.preferredNamespaces
      );
    }
    return out;
  });
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

async function loadFilterDateColumnForReport(companyId) {
  const doc = await HeaderMapping.findOne({
    companyId: new mongoose.Types.ObjectId(String(companyId)),
  })
    .select({ filterDate: 1 })
    .lean();
  return getFilterDateColumnName(doc?.filterDate);
}

function resolveReportFetchDates(fromDate, toDate, filterDateColumn) {
  const useMappedDateFilter = Boolean(filterDateColumn && (fromDate || toDate));
  return {
    useMappedDateFilter,
    fetchFromDate: useMappedDateFilter ? null : fromDate,
    fetchToDate: useMappedDateFilter ? null : toDate,
  };
}

function hasReportCellValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function parseFlexibleReportDate(value) {
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

  // Excel serial date stored as a numeric string, e.g. "45772" -> a real date.
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

function resolveReportRowDateValue(row, columnName) {
  const merged =
    row?.merged && typeof row.merged === "object" && !Array.isArray(row.merged)
      ? row.merged
      : {};
  let val = resolveMergedColumnValue(merged, columnName, ["sales", "pdf", "sb", "cha"]);
  if (hasReportCellValue(val)) return val;

  const salesData = row?.salesRow?.data;
  if (salesData && typeof salesData === "object" && !Array.isArray(salesData)) {
    if (hasReportCellValue(salesData[columnName])) return salesData[columnName];
    const lower = String(columnName).toLowerCase();
    for (const [key, value] of Object.entries(salesData)) {
      if (String(key).toLowerCase() === lower && hasReportCellValue(value)) {
        return value;
      }
    }
  }

  return val;
}

function isReportRowDateInRange(row, columnName, fromDate, toDate) {
  const rowDate = parseFlexibleReportDate(resolveReportRowDateValue(row, columnName));
  if (!rowDate) return false;

  const from = parseBoundaryDate(fromDate, "start");
  const to = parseBoundaryDate(toDate, "end");
  if (from && rowDate < from) return false;
  if (to && rowDate > to) return false;
  return true;
}

function filterReportRowsByMappedDate(rows, fromDate, toDate, filterDateColumn) {
  const list = Array.isArray(rows) ? rows : [];
  if (!filterDateColumn || (!fromDate && !toDate)) return list;

  return list.filter((row) =>
    isReportRowDateInRange(row, filterDateColumn, fromDate, toDate)
  );
}

async function loadSalesRowIdsWithProcessMatch(companyId) {
  const oid = new mongoose.Types.ObjectId(String(companyId));
  const ids = await ProcessMatch.distinct("salesRowId", {
    companyId: oid,
    ...MATCHED_PROCESS_MATCH_FILTER,
    salesRowId: { $nin: [null, ""] },
  });
  return new Set(ids.map((id) => String(id)).filter(Boolean));
}

/** Ensure sales rows with no PDF process-match are present in PDF/SB reports. */
async function appendUnmatchedSalesReportRows(companyId, rows, buildUnmatchedRow) {
  const SalesUploadRow = mongoose.models.SalesUploadRow;
  if (!SalesUploadRow || typeof buildUnmatchedRow !== "function") {
    return Array.isArray(rows) ? rows : [];
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));
  const matchedSalesIds = await loadSalesRowIdsWithProcessMatch(companyId);
  const presentSalesIds = new Set(
    (Array.isArray(rows) ? rows : []).map((r) => getSalesRowIdFromReportRow(r)).filter(Boolean)
  );

  const candidates = await SalesUploadRow.find({ companyId: oid })
    .sort({ createdAt: 1, rowIndex: 1 })
    .lean();

  const out = [...(Array.isArray(rows) ? rows : [])];
  for (const salesDoc of candidates) {
    const sid = String(salesDoc?.rowId ?? "").trim();
    if (!sid || matchedSalesIds.has(sid) || presentSalesIds.has(sid)) continue;
    out.push(buildUnmatchedRow(salesDoc));
    presentSalesIds.add(sid);
  }
  return out;
}

function applyMappedDateFilterToRows(rows, fromDate, toDate, filterDateColumn, useMappedDateFilter) {
  if (!useMappedDateFilter || !filterDateColumn) return rows;
  return filterReportRowsByMappedDate(rows, fromDate, toDate, filterDateColumn);
}

/** Mongo filter on ProcessMatch.matchedAt; null if no bounds. */
function buildMatchedAtRange(fromDate, toDate) {
  const range = {};
  const from = parseBoundaryDate(fromDate, "start");
  const to = parseBoundaryDate(toDate, "end");
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return Object.keys(range).length ? range : null;
}

function assertReportRowLimit(count, label) {
  if (count > MAX_REPORT_ROWS) {
    const err = new Error(
      `Too many ${label} (${count}). Narrow fromDate/toDate or raise limit (max ${MAX_REPORT_ROWS}).`
    );
    err.statusCode = 400;
    throw err;
  }
}

function salesDataFromDoc(salesDoc) {
  return salesDoc?.data && typeof salesDoc.data === "object" && !Array.isArray(salesDoc.data)
    ? salesDoc.data
    : {};
}

function salesRowPayloadFromDoc(salesDoc) {
  if (!salesDoc) return null;
  return {
    rowId: salesDoc.rowId,
    rowIndex: salesDoc.rowIndex,
    uploadId: salesDoc.uploadId,
    pdfUploadId: salesDoc.pdfUploadId,
    data: salesDoc.data,
    source: salesDoc.source,
    createdAt: salesDoc.createdAt,
    updatedAt: salesDoc.updatedAt,
  };
}

function groupMatchesBySalesRowId(matches) {
  const map = new Map();
  for (const m of matches || []) {
    const sid = String(m.salesRowId ?? "").trim();
    if (!sid) continue;
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push(m);
  }
  return map;
}

/** Scoped sales upload rows + processmatch rows for report (sales createdAt + match matchedAt). */
async function loadSalesAndMatchesForReport(companyId, matchedAtRange, fromDate, toDate) {
  const SalesUploadRow = mongoose.models.SalesUploadRow;
  if (!SalesUploadRow) {
    const err = new Error(
      "SalesUploadRow model is not registered. Load process upload routes once."
    );
    err.statusCode = 500;
    throw err;
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));
  const createdAtRange = buildMatchedAtRange(fromDate, toDate);
  const salesFilter = { companyId: oid };
  if (createdAtRange) salesFilter.createdAt = createdAtRange;

  const scopedSales = await SalesUploadRow.find(salesFilter)
    .sort({ createdAt: 1, rowIndex: 1 })
    .lean();

  const matchFilter = { companyId: oid, ...MATCHED_PROCESS_MATCH_FILTER };
  if (matchedAtRange) matchFilter.matchedAt = matchedAtRange;
  const matches = await ProcessMatch.find(matchFilter)
    .sort({ matchedAt: -1, seq: 1, salesRowId: 1 })
    .lean();

  const scopedIds = new Set(scopedSales.map((d) => d.rowId));
  const matchOnlyIds = [
    ...new Set(
      matches
        .map((m) => m.salesRowId)
        .filter((id) => id && !scopedIds.has(id))
    ),
  ];
  const extraSales = matchOnlyIds.length
    ? await SalesUploadRow.find({ companyId: oid, rowId: { $in: matchOnlyIds } }).lean()
    : [];

  const salesByRowId = new Map();
  for (const d of [...scopedSales, ...extraSales]) {
    salesByRowId.set(d.rowId, d);
  }

  return {
    oid,
    scopedSales,
    scopedIds,
    matches,
    salesByRowId,
    matchesBySalesRowId: groupMatchesBySalesRowId(matches),
  };
}

/** Flat keys like `sales.IRN`, `pdf.Port Code` for report / Excel (no row/upload/batch ids). */
function prefixDotted(namespace, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[`${namespace}.${k}`] = v;
  }
  return out;
}

function formatMergeScalar(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Process-match fields only needed for reporting/debug. */
function pmBusinessFieldsForMerge(pm) {
  if (!pm) return {};
  return {
    "pm.matchedAt": formatMergeScalar(pm.matchedAt),
    "pm.seq": pm.seq ?? "",
    "pm.matchType": pm.matchType ?? "",
    "pm.salesCombination": pm.salesCombination ?? "",
    "pm.pdfCombination": pm.pdfCombination ?? "",
    "pm.matchValue": pm.matchValue ?? "",
    "pm.salesRemainingCount":
      typeof pm.salesRemainingCount === "number" ? pm.salesRemainingCount : "",
    "pm.pdfRemainingCount":
      typeof pm.pdfRemainingCount === "number" ? pm.pdfRemainingCount : "",
    "pm.salesRowId": pm.salesRowId ?? "",
    "pm.pdfRowId": pm.pdfRowId ?? "",
  };
}

function serializeProcessMatchDoc(doc) {
  if (!doc) return null;
  return {
    id: doc._id?.toString?.() || String(doc._id),
    batchId: doc.batchId,
    matchedAt: doc.matchedAt,
    seq: doc.seq,
    matchType: doc.matchType ?? "",
    salesCombination: doc.salesCombination,
    pdfCombination: doc.pdfCombination,
    matchValue: doc.matchValue,
    salesRowId: doc.salesRowId,
    pdfRowId: doc.pdfRowId,
    salesRemainingCount:
      typeof doc.salesRemainingCount === "number" ? doc.salesRemainingCount : null,
    pdfRemainingCount:
      typeof doc.pdfRemainingCount === "number" ? doc.pdfRemainingCount : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function buildPdfFallbackByCombinationMap(PdfUploadRow, companyOid, matches) {
  const needed = [];
  const seen = new Set();
  for (const m of matches || []) {
    const combo = String(m?.pdfCombination ?? "").trim();
    const value = String(m?.matchValue ?? "").trim();
    if (!combo || !value) continue;
    const key = `${combo}|||${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    needed.push({ combo, value });
  }
  if (!needed.length) return new Map();

  const orConditions = needed.map(({ combo, value }) => ({
    [`data.${combo}`]: value,
  }));
  const docs = await PdfUploadRow.find({ companyId: companyOid, $or: orConditions }).lean();

  const out = new Map();
  for (const d of docs) {
    const data =
      d?.data && typeof d.data === "object" && !Array.isArray(d.data) ? d.data : {};
    for (const { combo, value } of needed) {
      if (String(data[combo] ?? "").trim() === value) {
        const k = `${combo}|||${value}`;
        if (!out.has(k)) out.set(k, d);
      }
    }
  }
  return out;
}

function buildUnmatchedPdfReportRow(salesDoc) {
  const salesData = salesDataFromDoc(salesDoc);
  return {
    processMatch: null,
    salesRow: salesRowPayloadFromDoc(salesDoc),
    pdfRow: null,
    merged: {
      "pm.matchStatus": "unmatched",
      "pm.salesRowId": salesDoc?.rowId ?? "",
      ...prefixDotted("sales", salesData),
      "pm.pdfJoinFound": "no",
    },
  };
}

function buildMatchedPdfReportRow(m, salesDoc, pdfDoc) {
  const pm = serializeProcessMatchDoc(m);
  const salesData = salesDataFromDoc(salesDoc);
  const pdfData =
    pdfDoc?.data && typeof pdfDoc.data === "object" && !Array.isArray(pdfDoc.data)
      ? pdfDoc.data
      : {};

  return {
    processMatch: pm,
    salesRow: salesRowPayloadFromDoc(salesDoc),
    pdfRow: pdfDoc
      ? {
          pdfRowId: pdfDoc.pdfRowId,
          pdfRowIndex: pdfDoc.pdfRowIndex,
          uploadId: pdfDoc.uploadId,
          pdfUploadId: pdfDoc.pdfUploadId,
          data: pdfDoc.data,
          source: pdfDoc.source,
          createdAt: pdfDoc.createdAt,
          updatedAt: pdfDoc.updatedAt,
        }
      : null,
    merged: {
      "pm.matchStatus": "matched",
      ...pmBusinessFieldsForMerge(pm),
      ...prefixDotted("sales", salesData),
      ...prefixDotted("pdf", pdfData),
      "pm.pdfJoinFound": pdfDoc ? "yes" : "no",
    },
  };
}

async function fetchPdfCombinedRows(companyId, matchedAtRange, fromDate, toDate) {
  const PdfUploadRow = mongoose.models.PdfUploadRow;
  if (!PdfUploadRow) {
    const err = new Error(
      "PdfUploadRow model is not registered. Load process upload routes once."
    );
    err.statusCode = 500;
    throw err;
  }

  const { oid, scopedSales, scopedIds, matches, salesByRowId, matchesBySalesRowId } =
    await loadSalesAndMatchesForReport(companyId, matchedAtRange, fromDate, toDate);

  const pdfRowIds = [
    ...new Set(
      matches
        .map((m) => String(m.pdfRowId ?? "").trim())
        .filter(Boolean)
    ),
  ];

  const pdfDocsByCompany = pdfRowIds.length
    ? await PdfUploadRow.find({
        companyId: oid,
        $or: [{ pdfRowId: { $in: pdfRowIds } }, { rowId: { $in: pdfRowIds } }],
      }).lean()
    : [];
  const pdfDocs =
    pdfDocsByCompany.length < pdfRowIds.length && pdfRowIds.length
      ? [
          ...pdfDocsByCompany,
          ...(await PdfUploadRow.find({
            $or: [{ pdfRowId: { $in: pdfRowIds } }, { rowId: { $in: pdfRowIds } }],
          }).lean()),
        ]
      : pdfDocsByCompany;

  const pdfByRowId = new Map();
  for (const d of pdfDocs) {
    const id1 = String(d?.pdfRowId ?? "").trim();
    const id2 = String(d?.rowId ?? "").trim();
    if (id1) pdfByRowId.set(id1, d);
    if (id2) pdfByRowId.set(id2, d);
  }
  const pdfByComboAndValue = await buildPdfFallbackByCombinationMap(
    PdfUploadRow,
    oid,
    matches
  );

  function resolvePdfDoc(m) {
    return (
      pdfByRowId.get(String(m.pdfRowId ?? "").trim()) ||
      pdfByComboAndValue.get(
        `${String(m.pdfCombination ?? "").trim()}|||${String(m.matchValue ?? "").trim()}`
      ) ||
      null
    );
  }

  let rows = [];

  for (const salesDoc of scopedSales) {
    const sid = salesDoc.rowId;
    const salesMatches = matchesBySalesRowId.get(sid) || [];
    if (salesMatches.length) {
      for (const m of salesMatches) {
        rows.push(
          buildMatchedPdfReportRow(m, salesDoc, resolvePdfDoc(m))
        );
      }
    } else {
      rows.push(buildUnmatchedPdfReportRow(salesDoc));
    }
  }

  for (const m of matches) {
    if (scopedIds.has(m.salesRowId)) continue;
    const salesDoc = salesByRowId.get(m.salesRowId) || null;
    if (!salesDoc) continue;
    rows.push(buildMatchedPdfReportRow(m, salesDoc, resolvePdfDoc(m)));
  }

  rows = await appendUnmatchedSalesReportRows(
    companyId,
    rows,
    buildUnmatchedPdfReportRow
  );

  assertReportRowLimit(rows.length, "report rows");
  return rows;
}

function serializeChaMatchDoc(doc) {
  if (!doc) return null;
  return {
    id: doc._id?.toString?.() || String(doc._id),
    batchId: doc.batchId,
    matchedAt: doc.matchedAt,
    sbMonthAndYear: doc.sbMonthAndYear,
    chaRowId: doc.chaRowId?.toString?.() || String(doc.chaRowId),
    salesRowId: doc.salesRowId,
    invNo: doc.invNo,
    matchType: doc.matchType,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function cmBusinessFieldsForMerge(cm) {
  if (!cm) return {};
  return {
    "cm.matchedAt": formatMergeScalar(cm.matchedAt),
    "cm.sbMonthAndYear": cm.sbMonthAndYear ?? "",
    "cm.invNo": cm.invNo ?? "",
    "cm.matchType": cm.matchType ?? "",
    "cm.salesRowId": cm.salesRowId ?? "",
    "cm.chaRowId": cm.chaRowId ?? "",
    "cm.batchId": cm.batchId ?? "",
  };
}

function chaDataFieldsForMerge(chaDoc) {
  if (!chaDoc) return {};
  const data = {
    fetchdate: formatMergeScalar(chaDoc.fetchdate),
    icegateId: chaDoc.icegateId ?? "",
    gstin: chaDoc.gstin ?? "",
    gstnId: chaDoc.gstnId ?? "",
    sbMonthAndYear: chaDoc.sbMonthAndYear ?? "",
    docType: chaDoc.docType ?? "",
    siteId: chaDoc.siteId ?? "",
    sbNo: chaDoc.sbNo ?? "",
    sbDt: chaDoc.sbDt ?? "",
    chaNo: chaDoc.chaNo ?? "",
    iec: chaDoc.iec ?? "",
    expName: chaDoc.expName ?? "",
    invNo: chaDoc.invNo ?? "",
    invDt: chaDoc.invDt ?? "",
    taxValue: chaDoc.taxValue ?? "",
    igstAmtPaid: chaDoc.igstAmtPaid ?? "",
    egmNo: chaDoc.egmNo ?? "",
    egmDt: chaDoc.egmDt ?? "",
  };
  return prefixDotted("cha", data);
}

async function fetchChaCombinedRows(companyId, matchedAtRange) {
  const SalesUploadRow = mongoose.models.SalesUploadRow;
  const ChaData = mongoose.models.ChaData;
  if (!SalesUploadRow || !ChaData) {
    const err = new Error(
      "SalesUploadRow / ChaData models are not registered. Load sales and CHA routes once."
    );
    err.statusCode = 500;
    throw err;
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));
  const filter = { companyId: oid };
  if (matchedAtRange) filter.matchedAt = matchedAtRange;

  const matches = await ChaMatchProcess.find(filter)
    .sort({ matchedAt: -1, salesRowId: 1, invNo: 1 })
    .lean();

  if (matches.length > MAX_REPORT_ROWS) {
    const err = new Error(
      `Too many chamatchprocess rows (${matches.length}). Narrow fromDate/toDate or raise limit (max ${MAX_REPORT_ROWS}).`
    );
    err.statusCode = 400;
    throw err;
  }

  const salesRowIds = [...new Set(matches.map((m) => String(m.salesRowId || "").trim()).filter(Boolean))];
  const chaRowIds = [
    ...new Set(
      matches
        .map((m) => m.chaRowId)
        .filter((id) => id != null)
        .map((id) => new mongoose.Types.ObjectId(String(id)))
    ),
  ];

  const [salesDocs, chaDocs] = await Promise.all([
    salesRowIds.length
      ? SalesUploadRow.find({ companyId: oid, rowId: { $in: salesRowIds } }).lean()
      : [],
    chaRowIds.length ? ChaData.find({ companyId: oid, _id: { $in: chaRowIds } }).lean() : [],
  ]);

  const salesByRowId = new Map(salesDocs.map((d) => [d.rowId, d]));
  const chaById = new Map(chaDocs.map((d) => [String(d._id), d]));

  return matches.map((m) => {
    const cm = serializeChaMatchDoc(m);
    const salesDoc = salesByRowId.get(String(m.salesRowId || "").trim()) || null;
    const chaDoc = chaById.get(String(m.chaRowId)) || null;
    const salesData =
      salesDoc?.data && typeof salesDoc.data === "object" && !Array.isArray(salesDoc.data)
        ? salesDoc.data
        : {};

    const merged = {
      ...cmBusinessFieldsForMerge(cm),
      ...prefixDotted("sales", salesData),
      ...chaDataFieldsForMerge(chaDoc),
      "cm.chaJoinFound": chaDoc ? "yes" : "no",
      "cm.salesJoinFound": salesDoc ? "yes" : "no",
    };

    return {
      chaMatch: cm,
      salesRow: salesDoc
        ? {
            rowId: salesDoc.rowId,
            rowIndex: salesDoc.rowIndex,
            uploadId: salesDoc.uploadId,
            data: salesDoc.data,
            createdAt: salesDoc.createdAt,
            updatedAt: salesDoc.updatedAt,
          }
        : null,
      chaRow: chaDoc
        ? {
            id: String(chaDoc._id),
            gstin: chaDoc.gstin,
            sbNo: chaDoc.sbNo,
            invNo: chaDoc.invNo,
            fetchdate: chaDoc.fetchdate,
          }
        : null,
      merged,
    };
  });
}

/** salesRowId → list of merged field objects from chamatchprocess + sales + chadata */
async function buildChaMergedBySalesRowId(companyId, matchedAtRange) {
  const chaRows = await fetchChaCombinedRows(companyId, matchedAtRange);
  const map = new Map();
  for (const row of chaRows) {
    const sid = String(row.merged?.["cm.salesRowId"] ?? row.chaMatch?.salesRowId ?? "").trim();
    if (!sid) continue;
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push(row.merged);
  }
  return map;
}

function getSalesRowIdFromReportRow(row) {
  return String(
    row?.merged?.["pm.salesRowId"] ??
      row?.processMatch?.salesRowId ??
      row?.salesRow?.rowId ??
      row?.merged?.["cm.salesRowId"] ??
      ""
  ).trim();
}

/**
 * When CHA is requested with PDF/SB, expand rows so each CHA match for the same sales row is a report line.
 */
function expandReportRowsWithCha(reportRows, chaBySalesRowId) {
  if (!chaBySalesRowId || chaBySalesRowId.size === 0) {
    return reportRows;
  }

  const out = [];
  for (const row of reportRows) {
    const sid = getSalesRowIdFromReportRow(row);
    const chaMergedList = sid ? chaBySalesRowId.get(sid) : null;
    if (!chaMergedList?.length) {
      out.push({
        ...row,
        merged: { ...(row.merged || {}), "cha.joinFound": "no" },
      });
      continue;
    }
    for (const chaFields of chaMergedList) {
      out.push({
        ...row,
        merged: {
          ...(row.merged || {}),
          ...chaFields,
          "cha.joinFound": "yes",
        },
      });
    }
  }
  return out;
}

async function enrichReportRowsWithCha(companyId, reportRows, matchedAtRange, includeCha) {
  if (!includeCha) return reportRows;
  const chaBySales = await buildChaMergedBySalesRowId(companyId, matchedAtRange);
  return expandReportRowsWithCha(reportRows, chaBySales);
}

function extractSbTripleFromMerged(merged) {
  if (!merged || typeof merged !== "object") {
    return { port: "", sbNo: "", sbDate: "" };
  }
  const port = String(merged["pdf.Port Code"] ?? "").trim();
  const sbNo = String(merged["pdf.SB No"] ?? "").trim();
  const sbDate = String(merged["pdf.SB Date"] ?? "").trim();
  return { port, sbNo, sbDate };
}

function normalizeDateForKey(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  const monthMap = {
    JAN: 1,
    FEB: 2,
    MAR: 3,
    APR: 4,
    MAY: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    NOV: 11,
    DEC: 12,
  };

  const pad2 = (n) => String(Number(n)).padStart(2, "0");
  const toYmd = (y, m, d) => {
    const yy = Number(y);
    const mm = Number(m);
    const dd = Number(d);
    if (!yy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
    return `${yy}-${pad2(mm)}-${pad2(dd)}`;
  };

  let m = /^(\d{2})-([A-Z]{3})-(\d{2}|\d{4})$/i.exec(text);
  if (m) {
    const dd = Number(m[1]);
    const mon = monthMap[String(m[2]).toUpperCase()] || 0;
    let yy = Number(m[3]);
    if (String(m[3]).length === 2) yy += yy >= 70 ? 1900 : 2000;
    return toYmd(yy, mon, dd) || text.toUpperCase();
  }

  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (m) return toYmd(Number(m[3]), Number(m[2]), Number(m[1])) || text;

  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) return toYmd(Number(m[1]), Number(m[2]), Number(m[3])) || text;

  const dt = new Date(text);
  if (!Number.isNaN(dt.getTime())) {
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(
      dt.getUTCDate()
    )}`;
  }

  return text.toUpperCase();
}

function normalizePortForKey(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const upper = text.toUpperCase();
  const inParens = /\(([A-Z0-9]{6})\)/.exec(upper);
  if (inParens) return inParens[1];
  if (/^[A-Z0-9]{6}$/.test(upper)) return upper;
  const embedded = /\b([A-Z0-9]{6})\b/.exec(upper);
  if (embedded) return embedded[1];
  return upper;
}

function makeNormalizedShippingBillKey(sbNo, sbDate, sbLocation) {
  const no = String(sbNo ?? "").trim();
  const date = normalizeDateForKey(sbDate);
  const loc = normalizePortForKey(sbLocation);
  if (!no || !date || !loc) return "";
  return makeShippingBillKey(no, date, loc);
}

function buildSbLookupIndexes(docs) {
  const byKey = new Map();
  const bySbNo = new Map();

  function prefer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.status === "success" && b.status !== "success") return a;
    if (b.status === "success" && a.status !== "success") return b;
    return new Date(a.createdAt || 0) >= new Date(b.createdAt || 0) ? a : b;
  }

  for (const d of docs) {
    const k = makeShippingBillKey(d.sbNo, d.sbDate, d.sbLocation);
    if (k && k !== "||") byKey.set(k, prefer(byKey.get(k), d));
    const nk = makeNormalizedShippingBillKey(d.sbNo, d.sbDate, d.sbLocation);
    if (nk) byKey.set(nk, prefer(byKey.get(nk), d));
    const n = String(d.sbNo || "").trim();
    if (n) bySbNo.set(n, prefer(bySbNo.get(n), d));
  }

  return { byKey, bySbNo };
}

function buildDgftLookupIndexes(docs) {
  const byKey = new Map();
  const bySbNo = new Map();

  function prefer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.status === "success" && b.status !== "success") return a;
    if (b.status === "success" && a.status !== "success") return b;
    return new Date(a.createdAt || 0) >= new Date(b.createdAt || 0) ? a : b;
  }

  for (const d of docs) {
    const input = d?.input && typeof d.input === "object" ? d.input : {};
    const port = String(input.port || "").trim();
    const sbNo = String(input.sbNumber || "").trim();
    const sbDate = String(input.sbDate || "").trim();
    const k = makeShippingBillKey(sbNo, sbDate, port);
    if (k && k !== "||") byKey.set(k, prefer(byKey.get(k), d));
    const nk = makeNormalizedShippingBillKey(sbNo, sbDate, port);
    if (nk) byKey.set(nk, prefer(byKey.get(nk), d));
    if (sbNo) bySbNo.set(sbNo, prefer(bySbNo.get(sbNo), d));
  }

  return { byKey, bySbNo };
}

function flattenObjectToDotted(out, prefix, value) {
  if (value === null || value === undefined) {
    out[prefix] = "";
    return;
  }
  if (value instanceof Date) {
    out[prefix] = value.toISOString();
    return;
  }
  if (Array.isArray(value)) {
    // Arrays are handled by caller (section arrays)
    out[prefix] = value.length ? JSON.stringify(value) : "";
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) {
      out[prefix] = "";
      return;
    }
    for (const [k, v] of entries) {
      flattenObjectToDotted(out, `${prefix}.${k}`, v);
    }
    return;
  }
  out[prefix] = value;
}

function normalizeScrapedDataObject(scraped) {
  if (scraped === null || scraped === undefined) return null;
  if (typeof scraped === "string") {
    try {
      const obj = JSON.parse(scraped);
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }
  return scraped && typeof scraped === "object" ? scraped : null;
}

function readNestedValue(source, path) {
  const parts = String(path || "").split(".");
  let current = source;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function pickMatchingDgftBrcRow(rows, dgftDoc) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;

  const input = dgftDoc?.input && typeof dgftDoc.input === "object" ? dgftDoc.input : {};
  const targetSbNo = String(input.sbNumber || "").trim();

  if (targetSbNo) {
    const exact =
      list.find((row) => String(row?.sbNumber || "").trim() === targetSbNo) ||
      list.find((row) => String(row?.detailResponse?.sbNumber || "").trim() === targetSbNo);
    if (exact) return exact;
  }

  return list[0];
}

function flattenDgftBrcRows(out, rows) {
  const list = Array.isArray(rows) ? rows : [];
  list.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const detail =
      row.detailResponse && typeof row.detailResponse === "object" ? row.detailResponse : null;
    const rowWithoutDetail = { ...row };
    delete rowWithoutDetail.detailResponse;

    for (const [key, value] of Object.entries(rowWithoutDetail)) {
      flattenObjectToDotted(out, `dgft.brc.${index}.${key}`, value);
    }

    if (detail) {
      for (const [key, value] of Object.entries(detail)) {
        flattenObjectToDotted(out, `dgft.brc.${index}.${key}`, value);
      }
    }
  });
}

function flattenObjectToSimpleMap(source, prefix = "", out = {}) {
  if (source === null || source === undefined) {
    if (prefix) out[prefix] = "";
    return out;
  }
  if (source instanceof Date) {
    if (prefix) out[prefix] = source.toISOString();
    return out;
  }
  if (Array.isArray(source)) {
    if (prefix) out[prefix] = source.length ? JSON.stringify(source) : "";
    return out;
  }
  if (typeof source !== "object") {
    if (prefix) out[prefix] = source;
    return out;
  }
  for (const [k, v] of Object.entries(source)) {
    const next = prefix ? `${prefix}.${k}` : k;
    flattenObjectToSimpleMap(v, next, out);
  }
  return out;
}

function appendJoinedValue(out, key, value) {
  const text = String(value ?? "").trim();
  if (!text) return;
  if (!out[key]) {
    out[key] = text;
    return;
  }
  const parts = out[key].split(",").map((x) => x.trim());
  if (!parts.includes(text)) out[key] = `${out[key]},${text}`;
}

function flattenDgftTableRowsJoined(out, tableRows) {
  const rows = Array.isArray(tableRows) ? tableRows : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const flat = flattenObjectToSimpleMap(row);
    for (const [k, v] of Object.entries(flat)) {
      appendJoinedValue(out, k, v);
    }
  }
}

function dgftFieldsForMerge(dgftDoc) {
  if (!dgftDoc) return {};

  const out = {
    "dgft.status": dgftDoc.status ?? "",
    "dgft.errorMessage": String(dgftDoc.errorMessage ?? ""),
  };

  const scraped = normalizeScrapedDataObject(dgftDoc.scrapedData);
  if (!scraped) return out;

  // Only merge DGFT tableRows into report columns.
  // Repeated values across multiple rows are comma-joined in the same key.
  flattenDgftTableRowsJoined(out, scraped.tableRows);

  return out;
}

function scrapedDataSectionsToSbColumns(scrapedObj) {
  const out = {};
  const obj = normalizeScrapedDataObject(scrapedObj);
  if (!obj) return out;

  const sectionMap = [
    // New stored keys (preferred)
    ["Shipping Bill Details", "Shipping Bill Details"],
    ["Current Status", "Current Status"],
    ["LEGM Status", "LEGM Status"],
    ["Drawback Query Details", "Drawback Query Details"],
    ["Gateway EGM Status Enquiry", "Gateway EGM Status Enquiry"],
    // Backward compatible with old stored keys
    ["rows", "Shipping Bill Details"],
    ["queueRows", "Current Status"],
    ["egmRows", "LEGM Status"],
    ["drawbackQueryRows", "Drawback Query Details"],
    ["gatewayExportRows", "Gateway EGM Status Enquiry"],
  ];

  for (const [srcKey, label] of sectionMap) {
    const arr = Array.isArray(obj[srcKey]) ? obj[srcKey] : [];
    for (let i = 0; i < arr.length; i += 1) {
      const row = arr[i];
      if (!row || typeof row !== "object") continue;
      for (const [k, v] of Object.entries(row)) {
        // Always keep index to avoid collisions when multiple rows exist.
        flattenObjectToDotted(out, `sb.${label}.${i}.${k}`, v);
      }
    }
  }

  if (Object.keys(out).length) return out;

  for (const [key, value] of Object.entries(obj)) {
    flattenObjectToDotted(out, `sb.${key}`, value);
  }

  return out;
}

function sbFieldsForMerge(sbDoc) {
  if (!sbDoc) return {};
  const base = {
    "sb.status": sbDoc.status ?? "",
    "sb.sbNo": String(sbDoc.sbNo ?? "").trim(),
    "sb.sbDate": String(sbDoc.sbDate ?? "").trim(),
    "sb.sbLocation": String(sbDoc.sbLocation ?? "").trim(),
    "sb.errorMessage": String(sbDoc.errorMessage ?? ""),
  };
  const sectionCols = scrapedDataSectionsToSbColumns(sbDoc.scrapedData);
  return { ...base, ...sectionCols };
}

function toShippingBillPayload(sbDoc) {
  return {
    id: String(sbDoc._id),
    dayKey: sbDoc.dayKey,
    batchId: sbDoc.batchId,
    shippingBillNoId: sbDoc.shippingBillNo ? String(sbDoc.shippingBillNo) : null,
    sbNo: sbDoc.sbNo,
    sbDate: sbDoc.sbDate,
    sbLocation: sbDoc.sbLocation,
    status: sbDoc.status,
    errorMessage: sbDoc.errorMessage,
    scrapedData: sbDoc.scrapedData,
    inputIndex: sbDoc.inputIndex,
    createdAt: sbDoc.createdAt,
    updatedAt: sbDoc.updatedAt,
  };
}

/**
 * After PDF+sales process-match merge, attach shipping bill fields from
 * `SbOnline` (collection `sbonline`) by PDF row SB No + date + port, else SB No only.
 */
async function fetchPdfPlusSbCombinedRows(
  companyId,
  matchedAtRange,
  includeDgft = false,
  fromDate,
  toDate
) {
  const pdfRows = await fetchPdfCombinedRows(companyId, matchedAtRange, fromDate, toDate);
  const oid = new mongoose.Types.ObjectId(String(companyId));

  const sbNos = new Set();
  for (const row of pdfRows) {
    const t = extractSbTripleFromMerged(row.merged);
    if (t.sbNo) sbNos.add(String(t.sbNo).trim());
  }

  let fallbackDocs = [];
  if (sbNos.size) {
    fallbackDocs = await SbOnline.find({
      companyId: oid,
      sbNo: { $in: [...sbNos] },
    })
      .sort({ createdAt: -1 })
      .lean();
  }

  const dgftDocs = includeDgft && sbNos.size
    ? (
        await Promise.all([
          DgftProcess.find({
            companyId: oid,
            status: "success",
            "input.sbNumber": { $in: [...sbNos] },
          })
            .sort({ createdAt: -1 })
            .lean(),
          DgftBatch.find({
            companyId: oid,
            status: "success",
            "input.sbNumber": { $in: [...sbNos] },
          })
            .sort({ createdAt: -1 })
            .lean(),
        ])
      ).flat()
    : [];

  const { byKey, bySbNo } = buildSbLookupIndexes(fallbackDocs);
  const { byKey: dgftByKey, bySbNo: dgftBySbNo } = buildDgftLookupIndexes(dgftDocs);

  return pdfRows.map((row) => {
    let sbDoc = null;
    let mergeSource = "";
    const { port, sbNo, sbDate } = extractSbTripleFromMerged(row.merged);
    const k = sbNo && sbDate && port ? makeShippingBillKey(sbNo, sbDate, port) : null;
    const nk = makeNormalizedShippingBillKey(sbNo, sbDate, port);
    if (k && k !== "||") sbDoc = byKey.get(k) || null;
    if (!sbDoc && nk) sbDoc = byKey.get(nk) || null;
    if (!sbDoc && sbNo) sbDoc = bySbNo.get(String(sbNo).trim()) || null;
    if (sbDoc) mergeSource = "sbno";

    const sbFlat = sbDoc ? sbFieldsForMerge(sbDoc) : {};
    let dgftDoc = null;
    if (includeDgft) {
      if (k && k !== "||") dgftDoc = dgftByKey.get(k) || null;
      if (!dgftDoc && nk) dgftDoc = dgftByKey.get(nk) || null;
      if (!dgftDoc && sbNo) dgftDoc = dgftBySbNo.get(String(sbNo).trim()) || null;
    }
    const dgftFlat = includeDgft && dgftDoc ? dgftFieldsForMerge(dgftDoc) : {};

    return {
      ...row,
      sbOnline: sbDoc ? toShippingBillPayload(sbDoc) : null,
      merged: {
        ...row.merged,
        ...sbFlat,
        ...dgftFlat,
        ...(mergeSource ? { "sb.matchSource": mergeSource } : {}),
      },
    };
  });
}

function buildUnmatchedSbReportRow(salesDoc) {
  const salesData = salesDataFromDoc(salesDoc);
  return {
    processMatch: null,
    salesRow: salesRowPayloadFromDoc(salesDoc),
    pdfRow: null,
    sbOnline: null,
    merged: {
      "pm.matchStatus": "unmatched",
      "pm.salesRowId": salesDoc?.rowId ?? "",
      ...prefixDotted("sales", salesData),
      "pm.pdfJoinFound": "no",
    },
  };
}

function buildMatchedSbReportRow(m, salesDoc, pdfDoc, sbDoc, dgftFlat, mergeSource) {
  const pm = serializeProcessMatchDoc(m);
  const salesData = salesDataFromDoc(salesDoc);
  const pdfData =
    pdfDoc?.data && typeof pdfDoc.data === "object" && !Array.isArray(pdfDoc.data)
      ? pdfDoc.data
      : {};

  const mergedPmPdfSales = {
    "pm.matchStatus": "matched",
    ...pmBusinessFieldsForMerge(pm),
    ...prefixDotted("sales", salesData),
    ...prefixDotted("pdf", pdfData),
  };
  const sbFlat = sbDoc ? sbFieldsForMerge(sbDoc) : {};

  return {
    processMatch: pm,
    salesRow: salesRowPayloadFromDoc(salesDoc),
    sbOnline: sbDoc
      ? {
          id: String(sbDoc._id),
          dayKey: sbDoc.dayKey,
          batchId: sbDoc.batchId,
          shippingBillNoId: sbDoc.shippingBillNo ? String(sbDoc.shippingBillNo) : null,
          sbNo: sbDoc.sbNo,
          sbDate: sbDoc.sbDate,
          sbLocation: sbDoc.sbLocation,
          status: sbDoc.status,
          errorMessage: sbDoc.errorMessage,
          scrapedData: sbDoc.scrapedData,
          inputIndex: sbDoc.inputIndex,
          createdAt: sbDoc.createdAt,
          updatedAt: sbDoc.updatedAt,
        }
      : null,
    pdfRow: pdfDoc
      ? {
          pdfRowId: pdfDoc.pdfRowId,
          pdfRowIndex: pdfDoc.pdfRowIndex,
          uploadId: pdfDoc.uploadId,
          pdfUploadId: pdfDoc.pdfUploadId,
          data: pdfDoc.data,
          source: pdfDoc.source,
          createdAt: pdfDoc.createdAt,
          updatedAt: pdfDoc.updatedAt,
        }
      : null,
    merged: {
      ...mergedPmPdfSales,
      ...sbFlat,
      ...dgftFlat,
      ...(mergeSource ? { "sb.matchSource": mergeSource } : {}),
      "pm.pdfJoinFound": pdfDoc ? "yes" : "no",
    },
  };
}

function resolveSbAndDgftForMerged(mergedPmPdfSales, byKey, bySbNo, dgftByKey, dgftBySbNo, includeDgft) {
  const { port, sbNo, sbDate } = extractSbTripleFromMerged(mergedPmPdfSales);
  const k = sbNo && sbDate && port ? makeShippingBillKey(sbNo, sbDate, port) : null;
  const nk = makeNormalizedShippingBillKey(sbNo, sbDate, port);
  let sbDoc = null;
  let mergeSource = "";
  if (k && k !== "||") sbDoc = byKey.get(k) || null;
  if (!sbDoc && nk) sbDoc = byKey.get(nk) || null;
  if (!sbDoc && sbNo) sbDoc = bySbNo.get(String(sbNo).trim()) || null;
  if (sbDoc) mergeSource = "sbno";

  let dgftDoc = null;
  if (includeDgft) {
    if (k && k !== "||") dgftDoc = dgftByKey.get(k) || null;
    if (!dgftDoc && nk) dgftDoc = dgftByKey.get(nk) || null;
    if (!dgftDoc && sbNo) dgftDoc = dgftBySbNo.get(String(sbNo).trim()) || null;
  }
  const dgftFlat = includeDgft && dgftDoc ? dgftFieldsForMerge(dgftDoc) : {};
  return { sbDoc, dgftFlat, mergeSource };
}

async function fetchSbLinkedRows(
  companyId,
  matchedAtRange,
  includeDgft = false,
  fromDate,
  toDate
) {
  const PdfUploadRow = mongoose.models.PdfUploadRow;
  if (!PdfUploadRow) {
    const err = new Error("PdfUploadRow model is not registered.");
    err.statusCode = 500;
    throw err;
  }

  const { oid, scopedSales, scopedIds, matches, salesByRowId, matchesBySalesRowId } =
    await loadSalesAndMatchesForReport(companyId, matchedAtRange, fromDate, toDate);

  const pdfRowIds = [
    ...new Set(
      matches
        .map((m) => String(m.pdfRowId ?? "").trim())
        .filter(Boolean)
    ),
  ];
  const pdfDocsByCompany = pdfRowIds.length
    ? await PdfUploadRow.find({
        companyId: oid,
        $or: [{ pdfRowId: { $in: pdfRowIds } }, { rowId: { $in: pdfRowIds } }],
      }).lean()
    : [];
  const pdfDocs =
    pdfDocsByCompany.length < pdfRowIds.length && pdfRowIds.length
      ? [
          ...pdfDocsByCompany,
          ...(await PdfUploadRow.find({
            $or: [{ pdfRowId: { $in: pdfRowIds } }, { rowId: { $in: pdfRowIds } }],
          }).lean()),
        ]
      : pdfDocsByCompany;
  const pdfByRowId = new Map();
  for (const d of pdfDocs) {
    const id1 = String(d?.pdfRowId ?? "").trim();
    const id2 = String(d?.rowId ?? "").trim();
    if (id1) pdfByRowId.set(id1, d);
    if (id2) pdfByRowId.set(id2, d);
  }
  const pdfByComboAndValue = await buildPdfFallbackByCombinationMap(
    PdfUploadRow,
    oid,
    matches
  );

  const sbNos = new Set();
  for (const d of pdfDocs) {
    const data = d?.data && typeof d.data === "object" && !Array.isArray(d.data) ? d.data : {};
    const n = String(data["SB No"] ?? "").trim();
    if (n) sbNos.add(n);
  }

  const fallbackDocs = sbNos.size
    ? await SbOnline.find({
        companyId: oid,
        sbNo: { $in: [...sbNos] },
      })
        .sort({ createdAt: -1 })
        .lean()
    : [];

  const dgftDocs = includeDgft && sbNos.size
    ? (
        await Promise.all([
          DgftProcess.find({
            companyId: oid,
            status: "success",
            "input.sbNumber": { $in: [...sbNos] },
          })
            .sort({ createdAt: -1 })
            .lean(),
          DgftBatch.find({
            companyId: oid,
            status: "success",
            "input.sbNumber": { $in: [...sbNos] },
          })
            .sort({ createdAt: -1 })
            .lean(),
        ])
      ).flat()
    : [];

  const { byKey, bySbNo } = buildSbLookupIndexes(fallbackDocs);
  const { byKey: dgftByKey, bySbNo: dgftBySbNo } = buildDgftLookupIndexes(dgftDocs);

  const pdfRowIdsInDateRange = matchedAtRange ? pdfRowIds : null;

  function resolvePdfDoc(m) {
    return (
      pdfByRowId.get(String(m.pdfRowId ?? "").trim()) ||
      pdfByComboAndValue.get(
        `${String(m.pdfCombination ?? "").trim()}|||${String(m.matchValue ?? "").trim()}`
      ) ||
      null
    );
  }

  function emitMatchedSbRow(m, salesDoc) {
    const pdfDoc = resolvePdfDoc(m);
    const salesData = salesDataFromDoc(salesDoc);
    const pdfData =
      pdfDoc?.data && typeof pdfDoc.data === "object" && !Array.isArray(pdfDoc.data)
        ? pdfDoc.data
        : {};
    const mergedPmPdfSales = {
      "pm.matchStatus": "matched",
      ...pmBusinessFieldsForMerge(serializeProcessMatchDoc(m)),
      ...prefixDotted("sales", salesData),
      ...prefixDotted("pdf", pdfData),
    };
    const { sbDoc, dgftFlat, mergeSource } = resolveSbAndDgftForMerged(
      mergedPmPdfSales,
      byKey,
      bySbNo,
      dgftByKey,
      dgftBySbNo,
      includeDgft
    );
    return buildMatchedSbReportRow(m, salesDoc, pdfDoc, sbDoc, dgftFlat, mergeSource);
  }

  let rows = [];

  for (const salesDoc of scopedSales) {
    const sid = salesDoc.rowId;
    const salesMatches = matchesBySalesRowId.get(sid) || [];
    if (salesMatches.length) {
      for (const m of salesMatches) {
        rows.push(emitMatchedSbRow(m, salesDoc));
      }
    } else {
      rows.push(buildUnmatchedSbReportRow(salesDoc));
    }
  }

  for (const m of matches) {
    if (scopedIds.has(m.salesRowId)) continue;
    const salesDoc = salesByRowId.get(m.salesRowId) || null;
    if (!salesDoc) continue;
    rows.push(emitMatchedSbRow(m, salesDoc));
  }

  rows = await appendUnmatchedSalesReportRows(
    companyId,
    rows,
    buildUnmatchedSbReportRow
  );

  assertReportRowLimit(rows.length, "report rows");

  return {
    rows,
    pdfRowIdsInDateRange,
  };
}

function cellValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function parseNumericCell(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert a value to the right JS type for its Excel cell type:
 * - date    -> JS Date (Excel date cell, dd-mm-yyyy)
 * - number  -> Number (Excel numeric cell)
 * - decimal -> Number (Excel numeric cell, 0.00)
 * - string  -> String / JSON text
 */
function toTypedCellValue(value, dataType) {
  const t = String(dataType || "string").trim().toLowerCase();
  if (t === "date") {
    const d = parseFlexibleReportDate(value);
    if (d) return d;
    return value == null || value === "" ? "" : String(value).trim();
  }
  if (t === "number" || t === "decimal") {
    const n = parseNumericCell(value);
    if (n == null) return value == null || value === "" ? "" : cellValue(value);
    return n;
  }
  return cellValue(value);
}

function buildColumnDataTypeMap(mappingItems) {
  const items = normalizeMappingItemsInput(mappingItems);
  const map = {};
  for (const item of items) {
    const key = String(item.customHeader || "").trim();
    if (!key) continue;
    map[key] = item.dataType || "string";
  }
  return map;
}

function resolveSheetColumnOrder(flatRows, columnOrder) {
  const preferred = Array.isArray(columnOrder)
    ? columnOrder.map((k) => String(k ?? "").trim()).filter(Boolean)
    : [];
  const keys = new Set();
  for (const r of flatRows) {
    if (r && typeof r === "object") {
      for (const k of Object.keys(r)) keys.add(k);
    }
  }
  if (preferred.length) {
    const extra = [...keys].filter((k) => !preferred.includes(k)).sort();
    return [...preferred, ...extra];
  }
  return [...keys].sort();
}

/** Keep raw cell values; order keys like Excel export when template/columns seq is provided. */
function orderReportRowsByColumns(flatRows, columnOrder) {
  const list = Array.isArray(flatRows) ? flatRows : [];
  const order = resolveSheetColumnOrder(list, columnOrder);
  if (!order.length) return list;

  return list.map((r) => {
    const src = r && typeof r === "object" ? r : {};
    const out = {};
    for (const k of order) {
      out[k] = Object.prototype.hasOwnProperty.call(src, k) ? src[k] : "";
    }
    return out;
  });
}

const EXCEL_DATE_FORMAT = "dd-mm-yyyy";
const EXCEL_DECIMAL_FORMAT = "0.00";

function mergedRowsToXlsxBuffer(flatRows, sheetName, columnOrder, columnDataTypes) {
  const typeMap =
    columnDataTypes && typeof columnDataTypes === "object" ? columnDataTypes : {};
  const list = Array.isArray(flatRows) ? flatRows : [];
  const order = resolveSheetColumnOrder(list, columnOrder);
  const header = order.length ? order : ["_empty"];

  const aoa = [header];
  for (const r of list) {
    const src = r && typeof r === "object" ? r : {};
    aoa.push(
      header.map((k) =>
        order.length ? toTypedCellValue(src[k], typeMap[k] || "string") : ""
      )
    );
  }
  if (!list.length) {
    aoa.push(header.map(() => ""));
  }

  const ws = xlsx.utils.aoa_to_sheet(aoa, { cellDates: true });

  // Force Excel cell formats so date/decimal columns are not left as "General".
  for (let c = 0; c < header.length; c += 1) {
    const dt = String(typeMap[header[c]] || "string").trim().toLowerCase();
    if (dt !== "date" && dt !== "decimal") continue;
    for (let rIdx = 1; rIdx < aoa.length; rIdx += 1) {
      const cell = ws[xlsx.utils.encode_cell({ r: rIdx, c })];
      if (!cell || cell.v === "" || cell.v == null) continue;
      if (dt === "date" && cell.t === "d") {
        cell.z = EXCEL_DATE_FORMAT;
      } else if (dt === "decimal" && cell.t === "n") {
        cell.z = EXCEL_DECIMAL_FORMAT;
      }
    }
  }

  const wb = xlsx.utils.book_new();
  const name = String(sheetName || "Report").slice(0, 31) || "Report";
  xlsx.utils.book_append_sheet(wb, ws, name);
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true });
}

function flattenColumnKeys(value, prefix = "", out = new Set()) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    if (!value.length) return out;
    const firstObj = value.find(
      (item) => item && typeof item === "object" && !Array.isArray(item)
    );
    if (firstObj) {
      flattenColumnKeys(firstObj, prefix, out);
    } else if (prefix) {
      out.add(prefix);
    }
    return out;
  }
  if (typeof value !== "object") {
    if (prefix) out.add(prefix);
    return out;
  }

  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${k}` : String(k);
    if (v && typeof v === "object") flattenColumnKeys(v, key, out);
    else out.add(key);
  }
  return out;
}

function columnsFromRowData(rowDoc) {
  const data =
    rowDoc?.data && typeof rowDoc.data === "object" && !Array.isArray(rowDoc.data)
      ? rowDoc.data
      : {};
  return [...flattenColumnKeys(data)];
}

/** Union discovered keys with a full catalog (sorted). */
function mergeDiscoveredColumns(discovered, catalog) {
  const set = new Set();
  for (const k of catalog || []) {
    const s = String(k ?? "").trim();
    if (s) set.add(s);
  }
  for (const k of discovered || []) {
    const s = String(k ?? "").trim();
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

const PDF_FULL_COLUMN_CATALOG = buildPdfFlatColumnCatalog();
const SHIPPING_FULL_COLUMN_CATALOG = buildShippingReportColumnCatalog();

function columnsFromPdfRowDoc(pdfDoc) {
  return mergeDiscoveredColumns(columnsFromRowData(pdfDoc), PDF_FULL_COLUMN_CATALOG);
}

const SHIPPING_SCRAPED_SECTION_KEYS = [
  ["Shipping Bill Details", "Shipping Bill Details"],
  ["Current Status", "Current Status"],
  ["LEGM Status", "LEGM Status"],
  ["Drawback Query Details", "Drawback Query Details"],
  ["Gateway EGM Status Enquiry", "Gateway EGM Status Enquiry"],
  ["rows", "Shipping Bill Details"],
  ["queueRows", "Current Status"],
  ["egmRows", "LEGM Status"],
  ["drawbackQueryRows", "Drawback Query Details"],
  ["gatewayExportRows", "Gateway EGM Status Enquiry"],
];

/**
 * All report column keys for sbonline (matches `sbFieldsForMerge` + full ICEGATE section catalog).
 */
function columnsFromShippingDoc(sbDoc) {
  const discovered = [];

  if (sbDoc) {
    for (const k of Object.keys(sbFieldsForMerge(sbDoc))) {
      discovered.push(k);
    }

    const scraped =
      sbDoc.scrapedData && typeof sbDoc.scrapedData === "object" ? sbDoc.scrapedData : {};

    for (const [k, v] of Object.entries(scraped)) {
      if (Array.isArray(v)) continue;
      if (v !== null && typeof v !== "object") {
        discovered.push(`sb.scrapedData.${k}`);
      }
    }

    for (const [srcKey, label] of SHIPPING_SCRAPED_SECTION_KEYS) {
      const arr = Array.isArray(scraped[srcKey]) ? scraped[srcKey] : [];
      for (let i = 0; i < arr.length; i += 1) {
        const row = arr[i];
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        for (const field of Object.keys(row)) {
          discovered.push(`sb.${label}.${i}.${field}`);
        }
      }
    }
  }

  return mergeDiscoveredColumns(discovered, SHIPPING_FULL_COLUMN_CATALOG);
}

function columnsFromDgftScraped(scrapedData) {
  const src = scrapedData && typeof scrapedData === "object" ? scrapedData : {};
  const firstRow = Array.isArray(src.tableRows) ? src.tableRows[0] : null;
  if (firstRow && typeof firstRow === "object" && !Array.isArray(firstRow)) {
    return [...flattenColumnKeys(firstRow)];
  }
  const firstBrcRow = Array.isArray(src?.brcResponse?.data) ? src.brcResponse.data[0] : null;
  if (firstBrcRow && typeof firstBrcRow === "object" && !Array.isArray(firstBrcRow)) {
    return [...flattenColumnKeys(firstBrcRow)];
  }
  return [...flattenColumnKeys(src)];
}

async function getColumns(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));
  const db = mongoose.connection.db;
  if (!db) {
    return res.status(500).json({
      success: false,
      message: "Database connection is not ready.",
    });
  }

  const ChaData = mongoose.models.ChaData;
  const [salesDoc, pdfDoc, shippingDoc, chaDoc, dgftProcessSample, dgftBatchSample] =
    await Promise.all([
      db.collection("salesuploadrows").findOne({ companyId: oid }, { sort: { createdAt: -1 } }),
      db.collection("pdfuploadrows").findOne({ companyId: oid }, { sort: { createdAt: -1 } }),
      SbOnline.findOne({ companyId: oid }).sort({ createdAt: -1 }).lean(),
      ChaData
        ? ChaData.findOne({ companyId: oid }).sort({ fetchdate: -1 }).lean()
        : db.collection("chadata").findOne({ companyId: oid }, { sort: { fetchdate: -1 } }),
      DgftProcess.findOne({ companyId: oid }).sort({ createdAt: -1 }).lean(),
      DgftBatch.findOne({ companyId: oid }).sort({ createdAt: -1 }).lean(),
    ]);
  const tProc = new Date(dgftProcessSample?.createdAt || 0).getTime();
  const tBatch = new Date(dgftBatchSample?.createdAt || 0).getTime();
  const dgftDoc = tBatch > tProc ? dgftBatchSample : dgftProcessSample || dgftBatchSample;

  const columnsByType = {
    sales: columnsFromRowData(salesDoc),
    pdf: columnsFromPdfRowDoc(pdfDoc),
    shipping: columnsFromShippingDoc(shippingDoc),
    dgft: columnsFromDgftScraped(dgftDoc?.scrapedData),
    cha: chaDoc ? columnsFromRowData({ data: chaDoc }) : [],
  };

  const requested = normalizeTypeInput(req.body?.type ?? req.query?.type);
  const selectedTypes = requested.length
    ? [...new Set(requested.filter((t) => ["sales", "pdf", "shipping", "dgft", "cha"].includes(t)))]
    : ["sales", "pdf", "shipping", "dgft", "cha"];

  const selected = {};
  for (const t of selectedTypes) selected[t] = columnsByType[t] || [];

  return res.status(200).json({
    success: true,
    companyId: String(companyId),
    type: selectedTypes,
    columns: selected,
  });
}

async function createTemplates(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const templateName = String(body.templateName ?? "").trim();
  const mappingItems = normalizeMappingItemsInput(
    body.mappingItems ?? body.items ?? null
  );
  let mapping =
    body.mapping && typeof body.mapping === "object" && !Array.isArray(body.mapping)
      ? body.mapping
      : null;
  if (mappingItems.length) {
    mapping = buildMappingFromItems(mappingItems);
  }

  if (!templateName) {
    return res.status(400).json({
      success: false,
      message: "templateName is required.",
    });
  }
  if (!mapping || !Object.keys(mapping).length) {
    return res.status(400).json({
      success: false,
      message: "mapping must be an object (or send mappingItems with seq).",
    });
  }

  try {
    const companyOid = new mongoose.Types.ObjectId(String(companyId));
    const saved = await ReportTemplate.findOneAndUpdate(
      { companyId: companyOid, templateName },
      {
        $set: {
          mapping,
          mappingItems,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    return res.status(200).json({
      success: true,
      message: "Template saved successfully.",
      data: {
        id: String(saved._id),
        companyId: String(saved.companyId),
        templateName: saved.templateName,
        mapping: saved.mapping || {},
        mappingItems: saved.mappingItems || [],
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      },
    });
  } catch (err) {
    const code = err?.code === 11000 ? 409 : 500;
    if (code >= 500) console.error("[createTemplates]", err);
    return res.status(code).json({
      success: false,
      message:
        code === 409
          ? "Template with same name already exists."
          : err.message || "Template save failed.",
    });
  }
}

async function listTemplates(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  try {
    const companyOid = new mongoose.Types.ObjectId(String(companyId));
    const templates = await ReportTemplate.find(
      { companyId: companyOid },
      { templateName: 1, createdAt: 1, updatedAt: 1 }
    )
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: templates.length,
      data: templates.map((t) => ({
        id: String(t._id),
        templateName: t.templateName,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (err) {
    console.error("[listTemplates]", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch templates.",
    });
  }
}

async function getTemplateById(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const id = String(body.id ?? "").trim();
  if (!id || !mongoose.isValidObjectId(id)) {
    return res.status(400).json({
      success: false,
      message: "Valid id is required.",
    });
  }

  try {
    const companyOid = new mongoose.Types.ObjectId(String(companyId));
    const doc = await ReportTemplate.findOne({
      _id: new mongoose.Types.ObjectId(id),
      companyId: companyOid,
    }).lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Template not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: String(doc._id),
        companyId: String(doc.companyId),
        templateName: doc.templateName,
        mapping: doc.mapping || {},
        mappingItems: doc.mappingItems || [],
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    console.error("[getTemplateById]", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch template.",
    });
  }
}

async function updateTemplateById(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const id = String(body.id ?? "").trim();
  const templateName = String(body.templateName ?? "").trim();
  const mappingItemsRaw = body.mappingItems ?? body.items ?? null;
  const hasMappingItems = Array.isArray(mappingItemsRaw);
  const mappingItems = hasMappingItems ? normalizeMappingItemsInput(mappingItemsRaw) : null;
  let mapping =
    body.mapping && typeof body.mapping === "object" && !Array.isArray(body.mapping)
      ? body.mapping
      : null;
  if (mappingItems && mappingItems.length) {
    mapping = buildMappingFromItems(mappingItems);
  }

  if (!id || !mongoose.isValidObjectId(id)) {
    return res.status(400).json({
      success: false,
      message: "Valid id is required.",
    });
  }
  if (!templateName && !mapping && !hasMappingItems) {
    return res.status(400).json({
      success: false,
      message: "Send templateName and/or mapping (or mappingItems) to update.",
    });
  }

  try {
    const companyOid = new mongoose.Types.ObjectId(String(companyId));
    const update = {};
    if (templateName) update.templateName = templateName;
    if (mapping) update.mapping = mapping;
    if (hasMappingItems) update.mappingItems = mappingItems || [];

    const updated = await ReportTemplate.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id), companyId: companyOid },
      { $set: update },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Template not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Template updated successfully.",
      data: {
        id: String(updated._id),
        companyId: String(updated.companyId),
        templateName: updated.templateName,
        mapping: updated.mapping || {},
        mappingItems: updated.mappingItems || [],
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    const code = err?.code === 11000 ? 409 : 500;
    if (code >= 500) console.error("[updateTemplateById]", err);
    return res.status(code).json({
      success: false,
      message:
        code === 409
          ? "Template name already exists."
          : err.message || "Failed to update template.",
    });
  }
}

function salesMatchStatsFromRows(rows) {
  const matchedSalesIds = new Set();
  const unmatchedSalesIds = new Set();
  let matchedLineCount = 0;
  let unmatchedLineCount = 0;
  for (const r of rows || []) {
    const status = r?.merged?.["pm.matchStatus"];
    const sid = getSalesRowIdFromReportRow(r);
    if (status === "unmatched") {
      unmatchedLineCount += 1;
      if (sid) unmatchedSalesIds.add(sid);
    } else if (status === "matched") {
      matchedLineCount += 1;
      if (sid) matchedSalesIds.add(sid);
    }
  }
  return {
    matchedLineCount,
    unmatchedLineCount,
    matchedSalesRowCount: matchedSalesIds.size,
    unmatchedSalesRowCount: unmatchedSalesIds.size,
  };
}

async function buildReportPayload(
  companyId,
  rowstype,
  fromDate,
  toDate,
  includeDgft = false,
  includeCha = false,
  columns = [],
  templateDoc = null
) {
  const filterDateColumn = await loadFilterDateColumnForReport(companyId);
  if ((fromDate || toDate) && !filterDateColumn) {
    const err = new Error(
      'Report date filter requires filterDate header mapping. Save via POST /api/company/admin/report/filter-date-heder-mapping (e.g. { "date": "Invoice Date" }).'
    );
    err.statusCode = 400;
    throw err;
  }
  const { useMappedDateFilter, fetchFromDate, fetchToDate } = resolveReportFetchDates(
    fromDate,
    toDate,
    filterDateColumn
  );
  const matchedAtRange = buildMatchedAtRange(fetchFromDate, fetchToDate);
  const salesCreatedAtFilter = buildMatchedAtRange(fetchFromDate, fetchToDate);
  const dateFilterMeta = {
    filterDateColumn: filterDateColumn || null,
    dateFilterMode: useMappedDateFilter
      ? "headerMappingColumn"
      : fromDate || toDate
        ? "matchedAtOrCreatedAt"
        : null,
  };

  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const [statusByInv, headerMappingDoc, combinationDoc] = await Promise.all([
    buildSalesInvStatusLabelByInv(companyId),
    HeaderMapping.findOne({ companyId: companyOid }).lean(),
    Combination.findOne({ companyId: companyOid }).lean(),
  ]);
  const salesInvSource = resolveSalesInvSource(headerMappingDoc, combinationDoc);
  const annotateMatchStatus = (rows) =>
    applyReportRowMatchStatus(rows, statusByInv, salesInvSource);

  const columnOrder = ensureStatusInColumnOrder(
    templateDoc
      ? templateColumnOrder(templateDoc)
      : (Array.isArray(columns) ? columns : []).map((c) => String(c ?? "").trim()).filter(Boolean)
  );
  const applyOutputShape = (rows) => {
    const mergedRows = rows.map((r) => r.merged || {});
    if (templateDoc?.mapping || templateDoc?.mappingItems?.length) {
      const projected = projectRowsByTemplate(
        mergedRows,
        templateDoc.mapping,
        templateDoc.mappingItems
      );
      return projected.map((out, index) => ({
        ...out,
        [REPORT_STATUS_COLUMN]: mergedRows[index]?.[REPORT_STATUS_COLUMN] ?? "",
      }));
    }
    const wanted = ensureStatusInColumnList(columns);
    if (!wanted.length) return mergedRows;
    return projectRowsByColumns(mergedRows, wanted);
  };
  const shapeReportRows = (rows) =>
    orderReportRowsByColumns(applyOutputShape(annotateMatchStatus(rows)), columnOrder);
  const reportMeta = {
    columnOrder,
    columnSeq: columnOrder,
    mappingItems: templateDoc?.mappingItems?.length
      ? normalizeMappingItemsInput(templateDoc.mappingItems)
      : [],
  };

  const effectiveType =
    includeCha && rowstype !== "cha" ? `${rowstype}${rowstype ? "," : ""}cha` : rowstype;

  if (rowstype === "cha") {
    let rows = await fetchChaCombinedRows(companyId, matchedAtRange);
    rows = applyMappedDateFilterToRows(
      rows,
      fromDate,
      toDate,
      filterDateColumn,
      useMappedDateFilter
    );
    const mergedRows = shapeReportRows(rows);
    return {
      rowstype: "cha",
      fromDate: fromDate || null,
      toDate: toDate || null,
      matchedAtFilter: matchedAtRange,
      ...dateFilterMeta,
      count: mergedRows.length,
      ...reportMeta,
      rows: mergedRows,
    };
  }

  if (rowstype === "pdf") {
    let rows = await fetchPdfCombinedRows(
      companyId,
      matchedAtRange,
      fetchFromDate,
      fetchToDate
    );
    rows = applyMappedDateFilterToRows(
      rows,
      fromDate,
      toDate,
      filterDateColumn,
      useMappedDateFilter
    );
    const salesStats = salesMatchStatsFromRows(rows);
    rows = await enrichReportRowsWithCha(companyId, rows, matchedAtRange, includeCha);
    const mergedRows = shapeReportRows(rows);
    return {
      rowstype: effectiveType,
      fromDate: fromDate || null,
      toDate: toDate || null,
      matchedAtFilter: matchedAtRange,
      salesCreatedAtFilter: salesCreatedAtFilter,
      ...dateFilterMeta,
      ...salesStats,
      count: mergedRows.length,
      ...reportMeta,
      rows: mergedRows,
    };
  }

  if (rowstype === "sb") {
    const { rows: sbRows, pdfRowIdsInDateRange } = await fetchSbLinkedRows(
      companyId,
      matchedAtRange,
      includeDgft,
      fetchFromDate,
      fetchToDate
    );
    let rows = applyMappedDateFilterToRows(
      sbRows,
      fromDate,
      toDate,
      filterDateColumn,
      useMappedDateFilter
    );
    const salesStats = salesMatchStatsFromRows(rows);
    let expanded = rows;
    expanded = await enrichReportRowsWithCha(companyId, expanded, matchedAtRange, includeCha);
    const mergedRows = shapeReportRows(expanded);
    return {
      rowstype: effectiveType,
      fromDate: fromDate || null,
      toDate: toDate || null,
      matchedAtFilter: matchedAtRange,
      salesCreatedAtFilter: salesCreatedAtFilter,
      ...dateFilterMeta,
      ...salesStats,
      pdfRowIdsFromProcessMatchInRange: pdfRowIdsInDateRange
        ? pdfRowIdsInDateRange.length
        : null,
      count: mergedRows.length,
      ...reportMeta,
      rows: mergedRows,
    };
  }

  if (rowstype === "pdf,sb") {
    let rows = await fetchPdfPlusSbCombinedRows(
      companyId,
      matchedAtRange,
      includeDgft,
      fetchFromDate,
      fetchToDate
    );
    rows = applyMappedDateFilterToRows(
      rows,
      fromDate,
      toDate,
      filterDateColumn,
      useMappedDateFilter
    );
    const salesStats = salesMatchStatsFromRows(rows);
    rows = await enrichReportRowsWithCha(companyId, rows, matchedAtRange, includeCha);
    const mergedRows = shapeReportRows(rows);
    return {
      rowstype: effectiveType,
      fromDate: fromDate || null,
      toDate: toDate || null,
      matchedAtFilter: matchedAtRange,
      salesCreatedAtFilter: salesCreatedAtFilter,
      ...dateFilterMeta,
      ...salesStats,
      count: mergedRows.length,
      ...reportMeta,
      rows: mergedRows,
    };
  }

  const err = new Error(
    'Invalid type. Use "cha", "pdf", "sb", "sb,dgft", "pdf,sb", "pdf,cha", "pdf,sb,cha", etc. (e.g. {"type":"pdf,sb,cha"}).'
  );
  err.statusCode = 400;
  throw err;
}

async function getReportData(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const { rowstype, fromDate, toDate, includeDgft, includeCha, columns, templateId } =
    readReportInput(req);
  if (!rowstype) {
    return res.status(400).json({
      success: false,
      message:
        'JSON body must include type (or rowstype): "cha", "pdf", "sb", "sb,dgft", "pdf,sb", "pdf,cha", "pdf,sb,cha", etc.',
    });
  }

  try {
    let templateDoc = null;
    if (templateId) {
      if (!mongoose.isValidObjectId(templateId)) {
        return res.status(400).json({
          success: false,
          message: "templateId must be a valid id.",
        });
      }
      templateDoc = await ReportTemplate.findOne({
        _id: new mongoose.Types.ObjectId(templateId),
        companyId: new mongoose.Types.ObjectId(String(companyId)),
      }).lean();
      if (!templateDoc) {
        return res.status(404).json({
          success: false,
          message: "Template not found.",
        });
      }
    }

    const payload = await buildReportPayload(
      companyId,
      rowstype,
      fromDate,
      toDate,
      includeDgft,
      includeCha,
      columns,
      templateDoc
    );
    const msgByType =
      rowstype === "cha"
        ? "CHA process match rows (chamatchprocess + sales + chadata) filtered by chamatchprocess.matchedAt when dates are set."
        : rowstype === "pdf"
          ? includeCha
            ? "All sales upload rows (matched and unmatched) with PDF/CHA where applicable; pm.matchStatus is matched or unmatched."
            : "All sales upload rows (matched and unmatched) with PDF when process-matched; pm.matchStatus is matched or unmatched."
          : rowstype === "sb"
            ? includeCha
              ? "All sales rows with process match, shipping bill, optional DGFT, and CHA; unmatched sales have sales columns only."
              : "All sales rows: matched lines include PDF + SB (+ optional DGFT); unmatched lines are sales-only (pm.matchStatus=unmatched)."
            : includeCha
              ? "All sales rows with PDF+SB (+ optional DGFT/CHA); unmatched sales included with pm.matchStatus=unmatched."
              : "All sales rows with PDF+SB merge when matched; unmatched sales included (pm.matchStatus=unmatched).";
    return res.status(200).json({
      success: true,
      message: msgByType,
      data: payload,
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) console.error("[getReportData]", err);
    return res.status(code).json({
      success: false,
      message: err.message || "Report failed.",
    });
  }
}

async function getReportExcel(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const { rowstype, fromDate, toDate, includeDgft, includeCha, columns, templateId } =
    readReportInput(req);
  if (!rowstype) {
    return res.status(400).json({
      success: false,
      message:
        'JSON body must include type (or rowstype): "cha", "pdf", "sb", "sb,dgft", "pdf,sb", "pdf,cha", "pdf,sb,cha", etc.',
    });
  }

  try {
    let templateDoc = null;
    if (templateId) {
      if (!mongoose.isValidObjectId(templateId)) {
        return res.status(400).json({
          success: false,
          message: "templateId must be a valid id.",
        });
      }
      templateDoc = await ReportTemplate.findOne({
        _id: new mongoose.Types.ObjectId(templateId),
        companyId: new mongoose.Types.ObjectId(String(companyId)),
      }).lean();
      if (!templateDoc) {
        return res.status(404).json({
          success: false,
          message: "Template not found.",
        });
      }
    }

    const payload = await buildReportPayload(
      companyId,
      rowstype,
      fromDate,
      toDate,
      includeDgft,
      includeCha,
      columns,
      templateDoc
    );
    const flat = Array.isArray(payload.rows) ? payload.rows : [];
    const sheetName =
      rowstype === "cha"
        ? "ChaSalesMatch"
        : rowstype === "pdf"
          ? includeCha
            ? "PdfChaMatch"
            : "PdfProcessMatch"
          : rowstype === "sb"
            ? includeCha
              ? "SbChaLinks"
              : "SbPdfLinks"
            : includeCha
              ? "PdfSbChaMerged"
              : "PdfSbMerged";
    const buffer = mergedRowsToXlsxBuffer(
      flat,
      sheetName,
      payload.columnOrder,
      buildColumnDataTypeMap(templateDoc?.mappingItems)
    );

    const safeId = String(companyId).replace(/[^a-zA-Z0-9-_]/g, "");
    const fileType = rowstype.replace(/,/g, "-");
    const filename = `report-${fileType}-${safeId}-${Date.now()}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) console.error("[getReportExcel]", err);
    return res.status(code).json({
      success: false,
      message: err.message || "Excel export failed.",
    });
  }
}

module.exports = {
  getColumns,
  createTemplates,
  listTemplates,
  getTemplateById,
  updateTemplateById,
  getReportData,
  getReportExcel,
  readReportInput,
  buildReportPayload,
  normalizeRowstype,
  normalizeTypeInput,
  normalizeMappingItemsInput,
  templateColumnOrder,
  orderReportRowsByColumns,
  REPORT_ROW_TYPES,
};
