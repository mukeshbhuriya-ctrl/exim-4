const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { Combination, sanitizeCombination } = require("#utils/combination");
const { HeaderMapping, sanitizeHeaderMapping } = require("#utils/headerMapping");
const { getRowValueByToken } = require("../process/1_process_logic/createcombination");
const {
  listChaDataForCompany,
  getCurrentSbMonthAndYear,
  normalizeSbMonthAndYear,
} = require("#utils/chaData");
const {
  ChaMatchProcess,
  ChaDropRows,
  ChaPendingRows,
  getAlreadyProcessedChaRowIds,
} = require("#utils/chaMatchCollections");

const SALES_INV_FALLBACK_KEYS = [
  "inv",
  "invNo",
  "inv_2",
  "INV",
  "Inv No",
  "Invoice No",
  "Invoice Number",
  "INVOICE NO",
];

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

/** Display / storage trim */
function normalizeInv(value) {
  return normalizeInvForMatch(value);
}

/**
 * Match key for CHA invNo ↔ sales.data.inv (handles Excel numbers, whitespace).
 */
function normalizeInvForMatch(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) || Math.abs(value) >= 1e6) {
      return String(Math.trunc(value));
    }
    return String(value).trim();
  }
  return String(value).trim();
}

function getSalesInvFromRow(data, salesInvSourceToken) {
  if (!data || typeof data !== "object") return "";

  // Never read combination columns ("INV | QTY | …") — values are pipe-joined composites.
  if (salesInvSourceToken && !String(salesInvSourceToken).includes("|")) {
    const fromToken = getRowValueByToken(data, salesInvSourceToken);
    if (fromToken != null && String(fromToken).trim()) {
      return normalizeInvForMatch(fromToken);
    }
  }

  for (const key of SALES_INV_FALLBACK_KEYS) {
    const fromToken = getRowValueByToken(data, key);
    if (fromToken != null && String(fromToken).trim()) {
      return normalizeInvForMatch(fromToken);
    }
  }

  for (const k of Object.keys(data)) {
    if (String(k).includes("|")) continue;
    if (/^inv/i.test(String(k).trim()) && String(data[k]).trim()) {
      return normalizeInvForMatch(data[k]);
    }
  }

  return "";
}

/** Header mapping dest key for invoice (e.g. `inv`). */
function resolveSalesInvFromHeaderMapping(headerMappingDoc) {
  const sales = sanitizeHeaderMapping(headerMappingDoc)?.sales;
  if (!sales || typeof sales !== "object") return null;
  for (const destKey of Object.keys(sales)) {
    if (/^inv/i.test(String(destKey).trim())) {
      return destKey;
    }
  }
  return null;
}

/** First INV token from sales combination config (not the joined column name). */
function resolveSalesInvSourceToken(combinationDoc) {
  const combo = sanitizeCombination(combinationDoc);
  const defs = Array.isArray(combo?.salesCombination) ? combo.salesCombination : [];
  for (const def of defs) {
    const tokens = String(def || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const invToken = tokens.find((t) => /^inv/i.test(t));
    if (invToken) return invToken;
  }
  return null;
}

function resolveSalesInvSource(headerMappingDoc, combinationDoc) {
  return (
    resolveSalesInvFromHeaderMapping(headerMappingDoc) ||
    resolveSalesInvSourceToken(combinationDoc) ||
    "inv"
  );
}

function buildSalesInvIndexDebug(salesDocs, salesInvSource, chaRows, limit = 5) {
  const salesInvSamples = [];
  const salesInvKeys = new Set();
  let salesRowsWithInv = 0;

  for (const doc of salesDocs) {
    const inv = getSalesInvFromRow(doc.data, salesInvSource);
    if (!inv) continue;
    salesRowsWithInv += 1;
    salesInvKeys.add(inv);
    if (salesInvSamples.length < limit) {
      salesInvSamples.push(inv);
    }
  }

  const chaInvSamples = [];
  const chaInvKeys = new Set();
  for (const row of chaRows) {
    const inv = normalizeInvForMatch(row.invNo);
    if (!inv) continue;
    chaInvKeys.add(inv);
    if (chaInvSamples.length < limit) {
      chaInvSamples.push(inv);
    }
  }

  const overlap = [...chaInvKeys].filter((k) => salesInvKeys.has(k)).slice(0, limit);

  return {
    salesInvSource,
    salesRowsWithInv,
    distinctSalesInvCount: salesInvKeys.size,
    distinctChaInvCount: chaInvKeys.size,
    overlappingInvCount: [...chaInvKeys].filter((k) => salesInvKeys.has(k)).length,
    sampleSalesInv: salesInvSamples,
    sampleChaInv: chaInvSamples,
    sampleOverlappingInv: overlap,
  };
}

function buildPdfSbNoSet(pdfDocs) {
  const set = new Set();
  for (const doc of pdfDocs) {
    const sb = normalizeKey(doc?.data?.["SB No"]);
    if (sb) set.add(sb);
  }
  return set;
}

function groupChaByInvNo(chaRows) {
  const map = new Map();
  for (const row of chaRows) {
    const inv = normalizeInvForMatch(row.invNo);
    if (!inv) continue;
    if (!map.has(inv)) map.set(inv, []);
    map.get(inv).push(row);
  }
  return map;
}

function buildSalesByInvMap(salesDocs, salesInvSource) {
  const map = new Map();
  for (const doc of salesDocs) {
    const inv = getSalesInvFromRow(doc.data, salesInvSource);
    if (!inv) continue;
    if (!map.has(inv)) map.set(inv, []);
    map.get(inv).push(doc);
  }
  return map;
}

/**
 * @param {object} opts
 * @returns {{ matches: object[], drops: object[], pending: object[] }}
 */
function runChaSalesMatchLogic(chaRows, salesDocs, pdfDocs, opts = {}) {
  const salesInvSource =
    opts.salesInvSource || opts.salesInvColumn || null;
  const pdfSbSet = buildPdfSbNoSet(pdfDocs);
  const salesByInv = buildSalesByInvMap(salesDocs, salesInvSource);
  const byInv = groupChaByInvNo(chaRows);

  const matches = [];
  const drops = [];
  const pending = [];
  const matchedChaIds = new Set();

  function chaSbMonth(chaRow) {
    return String(chaRow?.sbMonthAndYear || "").trim();
  }

  function addMatch(chaRow, salesDoc, matchType) {
    matches.push({
      chaRowId: chaRow._id,
      salesRowId: String(salesDoc.rowId),
      invNo: normalizeInv(chaRow.invNo),
      sbMonthAndYear: chaSbMonth(chaRow),
      matchType,
    });
    matchedChaIds.add(String(chaRow._id));
  }

  function addPending(chaRow, reason) {
    if (matchedChaIds.has(String(chaRow._id))) return;
    pending.push({
      chaRowId: chaRow._id,
      invNo: normalizeInv(chaRow.invNo),
      sbMonthAndYear: chaSbMonth(chaRow),
      reason,
    });
    matchedChaIds.add(String(chaRow._id));
  }

  function matchChaToSalesByInv(chaRow, matchType) {
    const inv = normalizeInv(chaRow.invNo);
    const salesList = salesByInv.get(inv) || [];
    if (!salesList.length) {
      addPending(chaRow, "no_sales_inv_match");
      return false;
    }
    for (const salesDoc of salesList) {
      addMatch(chaRow, salesDoc, matchType);
    }
    return true;
  }

  // Logic 1: unique invNo — match cha invNo to sales inv
  for (const [inv, group] of byInv.entries()) {
    if (group.length !== 1) continue;
    const chaRow = group[0];
    matchChaToSalesByInv(chaRow, "unique_inv");
  }

  // Logic 2: duplicate invNo groups — sbNo vs PDF, then sales by inv
  for (const [inv, group] of byInv.entries()) {
    if (group.length < 2) continue;

    const pdfMatchedRows = group.filter((row) => {
      const sb = normalizeKey(row.sbNo);
      return sb && pdfSbSet.has(sb);
    });

    if (pdfMatchedRows.length > 1) {
      drops.push({
        invNo: inv,
        chaRowIds: group.map((r) => r._id),
        sbMonthAndYear: chaSbMonth(group[0]),
        reason: "multiple_sb_match_in_group",
      });
      for (const row of group) {
        matchedChaIds.add(String(row._id));
      }
      continue;
    }

    if (pdfMatchedRows.length === 1) {
      const winner = pdfMatchedRows[0];
      matchChaToSalesByInv(winner, "duplicate_inv_sb");
      const otherRows = group.filter((row) => String(row._id) !== String(winner._id));
      if (otherRows.length) {
        drops.push({
          invNo: inv,
          chaRowIds: otherRows.map((r) => r._id),
          sbMonthAndYear: chaSbMonth(winner),
          reason: "single_sb_match_other_rows_in_group",
        });
        for (const row of otherRows) {
          matchedChaIds.add(String(row._id));
        }
      }
      continue;
    }

    for (const row of group) {
      addPending(row, "no_pdf_sb_match_in_duplicate_group");
    }
  }

  // Logic 3: unique rows still unmatched → pending
  for (const [inv, group] of byInv.entries()) {
    if (group.length !== 1) continue;
    const chaRow = group[0];
    if (!matchedChaIds.has(String(chaRow._id))) {
      addPending(chaRow, "no_sales_inv_match");
    }
  }

  return { matches, drops, pending };
}

async function persistMatchResults(companyId, batchId, result) {
  const { matches, drops, pending } = result;

  if (matches.length) {
    await ChaMatchProcess.insertMany(
      matches.map((m) => ({
        companyId,
        batchId,
        sbMonthAndYear: m.sbMonthAndYear || "",
        chaRowId: m.chaRowId,
        salesRowId: m.salesRowId,
        invNo: m.invNo,
        matchType: m.matchType,
        matchedAt: new Date(),
      })),
      { ordered: false }
    ).catch((err) => {
      if (err.code !== 11000) throw err;
    });
  }

  if (drops.length) {
    await ChaDropRows.insertMany(
      drops.map((d) => ({
        companyId,
        batchId,
        sbMonthAndYear: d.sbMonthAndYear || "",
        invNo: d.invNo,
        chaRowIds: d.chaRowIds,
        reason: d.reason,
      })),
      { ordered: true }
    );
  }

  if (pending.length) {
    await ChaPendingRows.insertMany(
      pending.map((p) => ({
        companyId,
        batchId,
        sbMonthAndYear: p.sbMonthAndYear || "",
        chaRowId: p.chaRowId,
        invNo: p.invNo,
        reason: p.reason,
      })),
      { ordered: false }
    ).catch((err) => {
      if (err.code !== 11000) throw err;
    });
  }
}

/**
 * Merge CHA rows to sales by invNo (+ duplicate groups via PDF SB No).
 */
async function mergeChaDataToSales(companyId, options = {}) {
  const SalesUploadRow = mongoose.models.SalesUploadRow;
  const PdfUploadRow = mongoose.models.PdfUploadRow;

  if (!SalesUploadRow || !PdfUploadRow) {
    throw new Error("SalesUploadRow and PdfUploadRow models must be loaded.");
  }

  const sbMonthAndYear = normalizeSbMonthAndYear(options.sbMonthAndYear) || null;
  const chaListFilters = options.gstin ? { gstin: options.gstin } : {};
  if (sbMonthAndYear) {
    chaListFilters.sbMonthAndYear = sbMonthAndYear;
  } else {
    chaListFilters.allMonths = true;
  }

  const [allChaRows, salesDocs, pdfDocs, combinationDoc, headerMappingDoc, processedChaIds] =
    await Promise.all([
      listChaDataForCompany(companyId, chaListFilters),
      SalesUploadRow.find({ companyId }).lean(),
      PdfUploadRow.find({ companyId }).lean(),
      Combination.findOne({ companyId }).lean(),
      HeaderMapping.findOne({ companyId }).lean(),
      getAlreadyProcessedChaRowIds(companyId, sbMonthAndYear || undefined),
    ]);

  const chaRows = allChaRows.filter((row) => !processedChaIds.has(String(row._id)));
  const alreadyProcessedCount = allChaRows.length - chaRows.length;

  if (!allChaRows.length) {
    return {
      batchId: null,
      sbMonthAndYear,
      chaScope: sbMonthAndYear || "all",
      message: sbMonthAndYear
        ? `No CHA data rows for ${sbMonthAndYear}.`
        : "No CHA data rows.",
      totalChaRowCount: 0,
      alreadyProcessedCount: 0,
      chaRowCount: 0,
      matched: 0,
      droppedGroups: 0,
      pending: 0,
    };
  }

  if (!chaRows.length) {
    return {
      batchId: null,
      sbMonthAndYear,
      chaScope: sbMonthAndYear || "all",
      message: sbMonthAndYear
        ? `All CHA rows for ${sbMonthAndYear} are already in chamatchprocess or chadroprows. Nothing to merge.`
        : "All CHA rows are already in chamatchprocess or chadroprows. Nothing to merge.",
      totalChaRowCount: allChaRows.length,
      alreadyProcessedCount,
      chaRowCount: 0,
      matched: 0,
      droppedGroups: 0,
      pending: 0,
    };
  }

  const salesInvSource = resolveSalesInvSource(headerMappingDoc, combinationDoc);
  const result = runChaSalesMatchLogic(chaRows, salesDocs, pdfDocs, { salesInvSource });
  const batchId = crypto.randomUUID();

  await persistMatchResults(companyId, batchId, result);

  const matchDebug =
    result.pending.length > 0
      ? buildSalesInvIndexDebug(salesDocs, salesInvSource, chaRows)
      : undefined;

  return {
    batchId,
    sbMonthAndYear,
    chaScope: sbMonthAndYear || "all",
    gstin: options.gstin || null,
    salesInvSource,
    /** @deprecated use salesInvSource */
    salesInvColumn: salesInvSource,
    matchDebug,
    totalChaRowCount: allChaRows.length,
    alreadyProcessedCount,
    chaRowCount: chaRows.length,
    salesRowCount: salesDocs.length,
    pdfRowCount: pdfDocs.length,
    matched: result.matches.length,
    droppedGroups: result.drops.length,
    pending: result.pending.length,
    matches: result.matches,
    drops: result.drops,
    pendingRows: result.pending,
  };
}

/**
 * Express handler: POST/GET merge CHA → sales.
 * Matches all CHA rows by default. Optional query: `month` / `sbMonthAndYear`, `gstin`.
 */
async function mergeChaDataToSalesHandler(req, res, next) {
  try {
    const monthRaw =
      typeof req.query.sbMonthAndYear === "string" && req.query.sbMonthAndYear.trim()
        ? req.query.sbMonthAndYear
        : typeof req.query.month === "string" && req.query.month.trim()
          ? req.query.month
          : "";

    const sbMonthAndYear = monthRaw ? normalizeSbMonthAndYear(monthRaw) : null;

    if (monthRaw && !sbMonthAndYear) {
      return res.status(400).json({
        success: false,
        message: "Invalid month. Use format MON-YYYY (e.g. MAY-2026).",
      });
    }

    const gstin =
      typeof req.query.gstin === "string" && req.query.gstin.trim()
        ? req.query.gstin.trim().toUpperCase()
        : undefined;

    const result = await mergeChaDataToSales(req.companyId, {
      sbMonthAndYear: sbMonthAndYear || undefined,
      gstin,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  mergeChaDataToSales,
  mergeChaDataToSalesHandler,
  runChaSalesMatchLogic,
  normalizeInv,
  normalizeInvForMatch,
  getSalesInvFromRow,
  resolveSalesInvSource,
  buildSalesInvIndexDebug,
};
