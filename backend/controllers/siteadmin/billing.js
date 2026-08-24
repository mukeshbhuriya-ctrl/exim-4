"use strict";

const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { HeaderMapping } = require("#utils/headerMapping");
const { ProcessMatch } = require("#utils/processMatch");
const {
  buildMatchedPdfUploadRowIdSet,
  loadProcessMatches,
  distinctMatchedRowIds,
} = require("#utils/processMatchPdfResolve");
const { extractInvFromSalesRow } = require("#utils/salesInvFinancialYearUniq");
const { normalizePdfInv } = require("#controllers/company/admin/process/pdf/jvpdfdata");
const {
  ShippingBillNo,
  normalizeSbNoForMatch,
} = require("#utils/shippingBillNo");
const { Billing } = require("#utils/billing");

const ROW_STATUS = {
  AVAILABLE: "available",
  EXCEPTION: "exception",
  IGNORED: "ignored",
};

const FILTER_DATE_MAPPING_KEYS = ["date", "fromDate", "filterDate"];

function normalizeRowStatus(value) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === ROW_STATUS.EXCEPTION || raw === ROW_STATUS.IGNORED) return raw;
  return ROW_STATUS.AVAILABLE;
}

function extractInvFromRowData(data) {
  return extractInvFromSalesRow(data);
}

function normalizeInvoiceKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return normalizePdfInv(raw) || raw;
}

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

function parseCompanyAndDateRange(input = {}) {
  const companyIdRaw = String(
    input.companyId ?? input.company_id ?? ""
  ).trim();
  const startDate = String(
    input.startDate ?? input.fromDate ?? input.start ?? ""
  ).trim();
  const endDate = String(
    input.endDate ?? input.toDate ?? input.end ?? ""
  ).trim();

  if (!companyIdRaw) {
    return { error: "Query/body parameter `companyId` is required." };
  }
  if (!mongoose.Types.ObjectId.isValid(companyIdRaw)) {
    return { error: "Invalid `companyId`." };
  }
  if (!startDate || !endDate) {
    return { error: "`startDate` and `endDate` are required (YYYY-MM-DD)." };
  }
  if (!parseBoundaryDate(startDate, "start") || !parseBoundaryDate(endDate, "end")) {
    return { error: "Invalid `startDate` or `endDate`. Use YYYY-MM-DD." };
  }

  return { companyId: companyIdRaw, startDate, endDate };
}

async function loadCompanyUploadRows(companyId) {
  require("#controllers/company/admin/process/sales/salesdata");
  require("#controllers/company/admin/process/pdf/pdfdata");

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
    distinctMatchedRowIds(companyId, "salesRowId", ProcessMatch),
    loadProcessMatches(companyId, ProcessMatch),
  ]);

  const matchedSalesSet = new Set(matchedSalesRowIds.map((id) => String(id)));
  const matchedPdfUploadRowIdSet = buildMatchedPdfUploadRowIdSet(pdfDocs, processMatches);

  return {
    salesDocs,
    pdfDocs,
    matchedSalesSet,
    matchedPdfUploadRowIdSet,
  };
}

async function computeFullyMatchedSbByDate(companyId, startDate, endDate) {
  const headerDoc = await HeaderMapping.findOne({ companyId })
    .select({ filterDate: 1 })
    .lean();
  const filterDateColumn = getFilterDateColumnName(headerDoc?.filterDate);
  if (!filterDateColumn) {
    return {
      error:
        'filterDate header mapping is required (e.g. { "date": "Billing Date" }).',
    };
  }

  const loaded = await loadCompanyUploadRows(companyId);
  if (loaded.error) return { error: loaded.error };

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

  return {
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
  };
}

async function markShippingBillsBillingCompleted(companyId, sbNumbers, billingId) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const billingOid = new mongoose.Types.ObjectId(String(billingId));
  const want = new Set(
    (Array.isArray(sbNumbers) ? sbNumbers : [])
      .map((n) => normalizeSbNoForMatch(n))
      .filter(Boolean)
  );

  if (!want.size) {
    return { matched: 0, updated: 0, notFound: 0, matchedSbNumbers: [] };
  }

  const all = await ShippingBillNo.find({ companyId: companyOid })
    .select({ _id: 1, sbNo: 1 })
    .lean();

  const idsToUpdate = [];
  const matchedSbNumbers = [];

  for (const doc of all) {
    const norm = normalizeSbNoForMatch(doc.sbNo);
    if (want.has(norm)) {
      idsToUpdate.push(doc._id);
      matchedSbNumbers.push(doc.sbNo);
    }
  }

  const matchedNorms = new Set(matchedSbNumbers.map(normalizeSbNoForMatch));
  const notFound = [...want].filter((n) => !matchedNorms.has(n)).length;

  if (!idsToUpdate.length) {
    return { matched: 0, updated: 0, notFound: want.size, matchedSbNumbers: [] };
  }

  const res = await ShippingBillNo.updateMany(
    { _id: { $in: idsToUpdate } },
    {
      $set: {
        billing: "completed",
        billingId: billingOid,
      },
    }
  );

  return {
    matched: idsToUpdate.length,
    updated: res.modifiedCount,
    notFound,
    matchedSbNumbers: [...new Set(matchedSbNumbers)],
  };
}

/**
 * GET /fully-matched-sb-by-date?companyId=&startDate=&endDate=
 */
async function getFullyMatchedSbByDate(req, res) {
  const parsed = parseCompanyAndDateRange({
    companyId: req.query.companyId ?? req.body?.companyId,
    startDate: req.query.startDate ?? req.query.fromDate ?? req.body?.startDate,
    endDate: req.query.endDate ?? req.query.toDate ?? req.body?.endDate,
  });
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }

  const result = await computeFullyMatchedSbByDate(
    parsed.companyId,
    parsed.startDate,
    parsed.endDate
  );
  if (result.error) {
    const status = /header mapping/i.test(result.error) ? 400 : 500;
    return res.status(status).json({ success: false, message: result.error });
  }

  return res.status(200).json({ success: true, ...result });
}

/**
 * POST /create-billing
 * Body: { companyId, startDate, endDate, name, description }
 * Same fully-matched SB discovery, then create billing doc and mark shippingbillno.
 */
async function createBilling(req, res) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const parsed = parseCompanyAndDateRange(body);
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }

  const name = String(body.name ?? body.billingName ?? "").trim();
  const description = String(
    body.description ?? body.billingDescription ?? body.desc ?? ""
  ).trim();

  if (!name) {
    return res.status(400).json({
      success: false,
      message: "`name` (billing name) is required.",
    });
  }

  const computed = await computeFullyMatchedSbByDate(
    parsed.companyId,
    parsed.startDate,
    parsed.endDate
  );
  if (computed.error) {
    const status = /header mapping/i.test(computed.error) ? 400 : 500;
    return res.status(status).json({ success: false, message: computed.error });
  }

  if (!computed.sbNos.length) {
    return res.status(400).json({
      success: false,
      message: "No unique SB Nos found for fully matched invoices in this date range.",
      ...computed,
    });
  }

  const billingDoc = await Billing.create({
    companyId: parsed.companyId,
    name,
    description,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    filterDateColumn: computed.filterDateColumn,
    salesRowsInRange: computed.salesRowsInRange,
    uniqueInvoicesInRange: computed.uniqueInvoicesInRange,
    fullyMatchedInvoiceCount: computed.fullyMatchedInvoiceCount,
    sbNoCount: computed.sbNoCount,
    fullyMatched: computed.fullyMatched,
    sbNos: computed.sbNos,
    dayKey: parsed.endDate,
    source: { rowsCount: computed.sbNoCount },
    rows: computed.fullyMatched,
  });

  const markResult = await markShippingBillsBillingCompleted(
    parsed.companyId,
    computed.sbNos,
    billingDoc._id
  );

  billingDoc.shippingBillMatched = markResult.matched;
  billingDoc.shippingBillUpdated = markResult.updated;
  billingDoc.shippingBillNotFound = markResult.notFound;
  await billingDoc.save();

  return res.status(201).json({
    success: true,
    message: "Billing created and shipping bills marked completed.",
    billingId: String(billingDoc._id),
    billing: {
      id: String(billingDoc._id),
      companyId: parsed.companyId,
      name: billingDoc.name,
      description: billingDoc.description,
      startDate: billingDoc.startDate,
      endDate: billingDoc.endDate,
      filterDateColumn: billingDoc.filterDateColumn,
      salesRowsInRange: billingDoc.salesRowsInRange,
      uniqueInvoicesInRange: billingDoc.uniqueInvoicesInRange,
      fullyMatchedInvoiceCount: billingDoc.fullyMatchedInvoiceCount,
      sbNoCount: billingDoc.sbNoCount,
      sbNos: billingDoc.sbNos,
      fullyMatched: billingDoc.fullyMatched,
      shippingBillMatched: billingDoc.shippingBillMatched,
      shippingBillUpdated: billingDoc.shippingBillUpdated,
      shippingBillNotFound: billingDoc.shippingBillNotFound,
      createdAt: billingDoc.createdAt,
    },
  });
}

module.exports = {
  getFullyMatchedSbByDate,
  createBilling,
};
