const mongoose = require("mongoose");
const {
  ProcessMatch,
  MATCHED_PROCESS_MATCH_FILTER,
} = require("#utils/processMatch");
const { ShippingBillNo, normalizeSbNoForMatch } = require("#utils/shippingBillNo");
const { SbOnline } = require("#utils/sbOnline");
const { DgftProcess } = require("#utils/dgftProcess");
const { DgftBatch } = require("#utils/dgftBatch");
const { extractInvFromSalesRow } = require("#utils/salesInvFinancialYearUniq");
const { normalizePdfInv } = require("#controllers/company/admin/process/pdf/jvpdfdata");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const rawLimit = parseInt(query.limit, 10) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function normalizeInvoiceKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return normalizePdfInv(raw) || raw;
}

function extractSbNoFromPdfData(data) {
  if (!data || typeof data !== "object") return "";
  return String(data["SB No"] ?? data.sbNo ?? data.SBNo ?? "").trim();
}

function extractSbDateFromPdfData(data) {
  if (!data || typeof data !== "object") return "";
  return String(data["SB Date"] ?? data.sbDate ?? "").trim();
}

function extractPortCodeFromPdfData(data) {
  if (!data || typeof data !== "object") return "";
  return String(data["Port Code"] ?? data.portCode ?? "").trim();
}

function ensureUploadModels() {
  const SalesUploadRow = mongoose.models.SalesUploadRow;
  const PdfUploadRow = mongoose.models.PdfUploadRow;
  if (!SalesUploadRow || !PdfUploadRow) {
    return {
      error:
        "Upload row models are not registered. Ensure sales/PDF routes are loaded.",
    };
  }
  return { SalesUploadRow, PdfUploadRow };
}

function serializeSbOnlineDoc(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    dayKey: doc.dayKey || "",
    batchId: doc.batchId || "",
    sbNo: doc.sbNo || "",
    sbDate: doc.sbDate || "",
    sbLocation: doc.sbLocation || "",
    status: doc.status || "",
    errorMessage: doc.errorMessage || "",
    shippingBillNo: doc.shippingBillNo ? String(doc.shippingBillNo) : null,
    scrapedData: doc.scrapedData ?? null,
    inputIndex: doc.inputIndex ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function serializeDgftDoc(doc, source) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    source,
    dayKey: doc.dayKey || "",
    batchId: doc.batchId || "",
    status: doc.status || "",
    errorMessage: doc.errorMessage || "",
    shippingBillNo: doc.shippingBillNo ? String(doc.shippingBillNo) : null,
    input: {
      port: doc.input?.port || "",
      sbNumber: doc.input?.sbNumber || doc.input?.sbNo || "",
      sbDate: doc.input?.sbDate || "",
    },
    scrapedData: doc.scrapedData ?? null,
    output: doc.output ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function serializeShippingBill(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    portCode: doc.portCode || "",
    sbNo: doc.sbNo || "",
    sbDate: doc.sbDate || "",
    billing: doc.billing || "",
    dgft: doc.dgft || "",
  };
}

function buildSbNoOrClauses(sbNos, fieldPath = "sbNo") {
  const ors = [];
  const seen = new Set();
  for (const raw of sbNos) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const norm = normalizeSbNoForMatch(s);
    const key = norm || s.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (norm && /^\d+$/.test(norm)) {
      ors.push({ [fieldPath]: new RegExp(`^0*${escapeRegex(norm)}$`) });
    } else {
      ors.push({ [fieldPath]: new RegExp(`^${escapeRegex(s)}$`, "i") });
    }
  }
  return ors;
}

function matchesInvoiceSearch(row, searchRaw) {
  const search = String(searchRaw ?? "").trim();
  if (!search) return true;

  const tokens = search
    .split(/[\s,;|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return true;

  const invKey = String(row.invoiceKey || "").toLowerCase();
  const invDisplay = String(row.invoice || "").toLowerCase();

  return tokens.some((token) => {
    const t = token.toLowerCase();
    return invKey.includes(t) || invDisplay.includes(t);
  });
}

function matchesSbNoSearch(row, searchRaw) {
  const search = String(searchRaw ?? "").trim();
  if (!search) return true;

  const tokens = search
    .split(/[\s,;|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return true;

  const sbNorm = normalizeSbNoForMatch(row.sbNo).toLowerCase();
  const sbRaw = String(row.sbNo || "").toLowerCase();

  return tokens.some((token) => {
    const t = token.toLowerCase();
    const tNorm = normalizeSbNoForMatch(token).toLowerCase();
    if (sbRaw.includes(t) || (tNorm && sbNorm.includes(tNorm))) return true;
    if (tNorm && sbNorm === tNorm) return true;
    return false;
  });
}

function matchesSearch(row, searchRaw) {
  const search = String(searchRaw ?? "").trim();
  if (!search) return true;
  return matchesInvoiceSearch(row, search) || matchesSbNoSearch(row, search);
}

/**
 * Build matched sales+pdf rows that have an SB No present in shippingbillno.
 */
async function buildMatchedInvRows(companyId) {
  const models = ensureUploadModels();
  if (models.error) return { error: models.error };

  const { SalesUploadRow, PdfUploadRow } = models;
  const companyOid = new mongoose.Types.ObjectId(String(companyId));

  const matches = await ProcessMatch.find({
    companyId: companyOid,
    ...MATCHED_PROCESS_MATCH_FILTER,
  })
    .select({
      salesRowId: 1,
      pdfRowId: 1,
      matchValue: 1,
      matchType: 1,
      batchId: 1,
      matchedAt: 1,
      salesCombination: 1,
      pdfCombination: 1,
    })
    .sort({ matchedAt: -1 })
    .lean();

  if (!matches.length) return { rows: [] };

  const salesIds = [...new Set(matches.map((m) => String(m.salesRowId)).filter(Boolean))];
  const pdfIds = [...new Set(matches.map((m) => String(m.pdfRowId)).filter(Boolean))];

  const [salesDocs, pdfDocs, shippingBills] = await Promise.all([
    SalesUploadRow.find({ companyId: companyOid, rowId: { $in: salesIds } }).lean(),
    PdfUploadRow.find({ companyId: companyOid, pdfRowId: { $in: pdfIds } }).lean(),
    ShippingBillNo.find({ companyId: companyOid })
      .select({ _id: 1, portCode: 1, sbNo: 1, sbDate: 1, billing: 1, dgft: 1 })
      .lean(),
  ]);

  const salesById = new Map(salesDocs.map((d) => [String(d.rowId), d]));
  const pdfById = new Map(pdfDocs.map((d) => [String(d.pdfRowId), d]));

  const shippingByNormSb = new Map();
  for (const bill of shippingBills) {
    const norm = normalizeSbNoForMatch(bill.sbNo);
    if (!norm) continue;
    if (!shippingByNormSb.has(norm)) shippingByNormSb.set(norm, bill);
  }

  const rows = [];
  for (const match of matches) {
    const salesDoc = salesById.get(String(match.salesRowId));
    const pdfDoc = pdfById.get(String(match.pdfRowId));
    if (!salesDoc || !pdfDoc) continue;

    const salesData =
      salesDoc.data && typeof salesDoc.data === "object" ? salesDoc.data : {};
    const pdfData = pdfDoc.data && typeof pdfDoc.data === "object" ? pdfDoc.data : {};

    const sbNo = extractSbNoFromPdfData(pdfData);
    if (!sbNo) continue;

    const sbNorm = normalizeSbNoForMatch(sbNo);
    const shippingBill = sbNorm ? shippingByNormSb.get(sbNorm) : null;
    // Only include matches whose PDF SB No exists in shippingbillno.
    if (!shippingBill) continue;

    const invoice =
      extractInvFromSalesRow(salesData) ||
      extractInvFromSalesRow(pdfData) ||
      String(match.matchValue || "").trim();

    rows.push({
      matchId: String(match._id),
      batchId: match.batchId || "",
      matchedAt: match.matchedAt || null,
      matchType: match.matchType || "auto",
      matchValue: match.matchValue || "",
      salesCombination: match.salesCombination || "",
      pdfCombination: match.pdfCombination || "",
      invoice: invoice || "",
      invoiceKey: normalizeInvoiceKey(invoice).toLowerCase(),
      sbNo,
      sbDate: extractSbDateFromPdfData(pdfData) || shippingBill.sbDate || "",
      portCode: extractPortCodeFromPdfData(pdfData) || shippingBill.portCode || "",
      salesRowId: String(salesDoc.rowId),
      pdfRowId: String(pdfDoc.pdfRowId),
      salesData,
      pdfData,
      shippingBill: serializeShippingBill(shippingBill),
    });
  }

  return { rows };
}

async function loadSbAndDgftBySbNos(companyId, sbNos) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const uniqueSbNos = [...new Set((sbNos || []).map((s) => String(s).trim()).filter(Boolean))];
  if (!uniqueSbNos.length) {
    return { sbOnlineByNorm: new Map(), dgftByNorm: new Map() };
  }

  const sbOrs = buildSbNoOrClauses(uniqueSbNos, "sbNo");
  const dgftOrs = [
    ...buildSbNoOrClauses(uniqueSbNos, "input.sbNumber"),
    ...buildSbNoOrClauses(uniqueSbNos, "input.sbNo"),
  ];

  const [sbOnlineDocs, dgftProcessDocs, dgftBatchDocs] = await Promise.all([
    sbOrs.length
      ? SbOnline.find({ companyId: companyOid, $or: sbOrs })
          .sort({ updatedAt: -1 })
          .lean()
      : Promise.resolve([]),
    dgftOrs.length
      ? DgftProcess.find({ companyId: companyOid, $or: dgftOrs })
          .sort({ updatedAt: -1 })
          .lean()
      : Promise.resolve([]),
    dgftOrs.length
      ? DgftBatch.find({ companyId: companyOid, $or: dgftOrs })
          .sort({ updatedAt: -1 })
          .lean()
      : Promise.resolve([]),
  ]);

  const sbOnlineByNorm = new Map();
  for (const doc of sbOnlineDocs) {
    const norm = normalizeSbNoForMatch(doc.sbNo);
    if (!norm) continue;
    if (!sbOnlineByNorm.has(norm)) sbOnlineByNorm.set(norm, []);
    sbOnlineByNorm.get(norm).push(serializeSbOnlineDoc(doc));
  }

  const dgftByNorm = new Map();
  const pushDgft = (doc, source) => {
    const sb =
      doc?.input?.sbNumber || doc?.input?.sbNo || "";
    const norm = normalizeSbNoForMatch(sb);
    if (!norm) return;
    if (!dgftByNorm.has(norm)) dgftByNorm.set(norm, []);
    dgftByNorm.get(norm).push(serializeDgftDoc(doc, source));
  };
  for (const doc of dgftProcessDocs) pushDgft(doc, "dgftprocess");
  for (const doc of dgftBatchDocs) pushDgft(doc, "dgftbatch");

  return { sbOnlineByNorm, dgftByNorm };
}

/**
 * Unique invoices from matched rows (keeps latest match metadata + related SB Nos).
 */
function buildUniqueInvoiceRows(rows = []) {
  const byInv = new Map();

  for (const row of rows) {
    const key = String(row.invoiceKey || normalizeInvoiceKey(row.invoice) || "")
      .trim()
      .toLowerCase();
    if (!key) continue;

    let entry = byInv.get(key);
    if (!entry) {
      entry = {
        invoice: row.invoice || "",
        invoiceKey: key,
        matchId: row.matchId,
        batchId: row.batchId || "",
        matchedAt: row.matchedAt || null,
        matchType: row.matchType || "auto",
        matchValue: row.matchValue || "",
        salesRowId: row.salesRowId,
        pdfRowId: row.pdfRowId,
        salesData: row.salesData,
        pdfData: row.pdfData,
        shippingBill: row.shippingBill,
        sbNos: [],
        _sbNorms: new Set(),
        matchCount: 0,
      };
      byInv.set(key, entry);
    }

    entry.matchCount += 1;

    const matchedAtMs = row.matchedAt ? new Date(row.matchedAt).getTime() : 0;
    const currentMs = entry.matchedAt ? new Date(entry.matchedAt).getTime() : 0;
    if (matchedAtMs >= currentMs) {
      entry.invoice = row.invoice || entry.invoice;
      entry.matchId = row.matchId;
      entry.batchId = row.batchId || "";
      entry.matchedAt = row.matchedAt || null;
      entry.matchType = row.matchType || "auto";
      entry.matchValue = row.matchValue || "";
      entry.salesRowId = row.salesRowId;
      entry.pdfRowId = row.pdfRowId;
      entry.salesData = row.salesData;
      entry.pdfData = row.pdfData;
      entry.shippingBill = row.shippingBill;
      entry.sbNo = row.sbNo || "";
      entry.sbDate = row.sbDate || "";
      entry.portCode = row.portCode || "";
    }

    const sbNo = String(row.sbNo || "").trim();
    const sbNorm = normalizeSbNoForMatch(sbNo);
    if (sbNo && sbNorm && !entry._sbNorms.has(sbNorm)) {
      entry._sbNorms.add(sbNorm);
      entry.sbNos.push({
        sbNo,
        sbDate: row.sbDate || "",
        portCode: row.portCode || "",
        shippingBill: row.shippingBill,
      });
    }
  }

  return [...byInv.values()]
    .map((entry) => {
      const { _sbNorms, ...rest } = entry;
      const firstSb = rest.sbNos[0] || null;
      return {
        ...rest,
        sbNo: rest.sbNo || firstSb?.sbNo || "",
        sbDate: rest.sbDate || firstSb?.sbDate || "",
        portCode: rest.portCode || firstSb?.portCode || "",
        shippingBill: rest.shippingBill || firstSb?.shippingBill || null,
        sbNoCount: rest.sbNos.length,
      };
    })
    .sort((a, b) =>
      String(a.invoice).localeCompare(String(b.invoice), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
}

/**
 * Unique SB Nos from matched rows (keeps invoice list for dropdown when multiple).
 */
function buildUniqueSbRows(rows = []) {
  const bySb = new Map();

  for (const row of rows) {
    const sbNo = String(row.sbNo || "").trim();
    const sbNorm = normalizeSbNoForMatch(sbNo);
    if (!sbNo || !sbNorm) continue;

    let entry = bySb.get(sbNorm);
    if (!entry) {
      entry = {
        sbNo,
        sbNorm,
        sbDate: row.sbDate || "",
        portCode: row.portCode || "",
        shippingBill: row.shippingBill,
        matchId: row.matchId,
        batchId: row.batchId || "",
        matchedAt: row.matchedAt || null,
        matchType: row.matchType || "auto",
        matchValue: row.matchValue || "",
        salesRowId: row.salesRowId,
        pdfRowId: row.pdfRowId,
        salesData: row.salesData,
        pdfData: row.pdfData,
        invoices: [],
        _invKeys: new Set(),
        matchCount: 0,
      };
      bySb.set(sbNorm, entry);
    }

    entry.matchCount += 1;

    const matchedAtMs = row.matchedAt ? new Date(row.matchedAt).getTime() : 0;
    const currentMs = entry.matchedAt ? new Date(entry.matchedAt).getTime() : 0;
    if (matchedAtMs >= currentMs) {
      entry.sbNo = sbNo;
      entry.sbDate = row.sbDate || entry.sbDate;
      entry.portCode = row.portCode || entry.portCode;
      entry.shippingBill = row.shippingBill || entry.shippingBill;
      entry.matchId = row.matchId;
      entry.batchId = row.batchId || "";
      entry.matchedAt = row.matchedAt || null;
      entry.matchType = row.matchType || "auto";
      entry.matchValue = row.matchValue || "";
      entry.salesRowId = row.salesRowId;
      entry.pdfRowId = row.pdfRowId;
      entry.salesData = row.salesData;
      entry.pdfData = row.pdfData;
      entry.invoice = row.invoice || entry.invoice || "";
    }

    const inv = String(row.invoice || "").trim();
    const invKey = String(row.invoiceKey || normalizeInvoiceKey(inv) || "")
      .trim()
      .toLowerCase();
    if (inv && invKey && !entry._invKeys.has(invKey)) {
      entry._invKeys.add(invKey);
      entry.invoices.push({
        invoice: inv,
        matchId: row.matchId,
        matchType: row.matchType || "auto",
        matchedAt: row.matchedAt || null,
        salesRowId: row.salesRowId,
        pdfRowId: row.pdfRowId,
      });
    }
  }

  return [...bySb.values()]
    .map((entry) => {
      const { _invKeys, ...rest } = entry;
      rest.invoices.sort((a, b) =>
        String(a.invoice).localeCompare(String(b.invoice), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
      return {
        ...rest,
        invoice: rest.invoice || rest.invoices[0]?.invoice || "",
        invoiceCount: rest.invoices.length,
      };
    })
    .sort((a, b) =>
      String(a.sbNo).localeCompare(String(b.sbNo), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
}

/**
 * Shared matched-inv listing with a search mode.
 * @param {"all"|"invoice"|"sbNo"} searchMode
 */
async function respondMatchedInvData(req, res, searchMode = "all") {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const { page, limit, skip } = parsePagination(req.query);
  const search = String(
    req.query.search ??
      req.query.q ??
      req.query.invoice ??
      req.query.inv ??
      req.query.sbNo ??
      req.query.sbNumber ??
      ""
  ).trim();

  try {
    const built = await buildMatchedInvRows(companyId);
    if (built.error) {
      return res.status(500).json({ success: false, message: built.error });
    }

    const matcher =
      searchMode === "invoice"
        ? matchesInvoiceSearch
        : searchMode === "sbNo"
          ? matchesSbNoSearch
          : matchesSearch;

    const filtered = built.rows.filter((row) => matcher(row, search));

    let uniqueRows;
    if (searchMode === "invoice") {
      uniqueRows = buildUniqueInvoiceRows(filtered);
    } else if (searchMode === "sbNo") {
      uniqueRows = buildUniqueSbRows(filtered);
    } else {
      uniqueRows = filtered;
    }

    const total = uniqueRows.length;
    const totalPages = total ? Math.ceil(total / limit) : 0;
    const pageRows = uniqueRows.slice(skip, skip + limit);

    const { sbOnlineByNorm, dgftByNorm } = await loadSbAndDgftBySbNos(
      companyId,
      pageRows.map((r) => r.sbNo)
    );

    const rows = pageRows.map((row) => {
      const norm = normalizeSbNoForMatch(row.sbNo);
      const base = {
        matchId: row.matchId,
        batchId: row.batchId,
        matchedAt: row.matchedAt,
        matchType: row.matchType,
        matchValue: row.matchValue,
        invoice: row.invoice,
        sbNo: row.sbNo,
        sbDate: row.sbDate,
        portCode: row.portCode,
        salesRowId: row.salesRowId,
        pdfRowId: row.pdfRowId,
        salesData: row.salesData,
        pdfData: row.pdfData,
        shippingBill: row.shippingBill,
        sbOnline: sbOnlineByNorm.get(norm) || [],
        dgft: dgftByNorm.get(norm) || [],
        matchCount: row.matchCount || 1,
      };

      if (searchMode === "invoice") {
        return {
          ...base,
          sbNos: Array.isArray(row.sbNos) ? row.sbNos : [],
          sbNoCount: row.sbNoCount || 0,
        };
      }

      if (searchMode === "sbNo") {
        return {
          ...base,
          invoices: Array.isArray(row.invoices) ? row.invoices : [],
          invoiceCount: row.invoiceCount || 0,
        };
      }

      return base;
    });

    return res.status(200).json({
      success: true,
      searchMode,
      page,
      limit,
      total,
      totalPages,
      search,
      count: rows.length,
      rows,
    });
  } catch (err) {
    console.error(`[matchedInvData:${searchMode}]`, err);
    return res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : "Failed to load matched invoice data.",
    });
  }
}

/**
 * GET /matched
 * Query: page, limit, search (inv and/or sbNo)
 */
async function getMatchedInvData(req, res) {
  return respondMatchedInvData(req, res, "all");
}

/**
 * GET /matched-by-invoice
 * Query: page, limit, search|invoice|inv
 */
async function getMatchedInvDataByInvoice(req, res) {
  return respondMatchedInvData(req, res, "invoice");
}

/**
 * GET /matched-by-sb
 * Query: page, limit, search|sbNo|sbNumber
 */
async function getMatchedInvDataBySbNo(req, res) {
  return respondMatchedInvData(req, res, "sbNo");
}

module.exports = {
  getMatchedInvData,
  getMatchedInvDataByInvoice,
  getMatchedInvDataBySbNo,
};
