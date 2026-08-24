const mongoose = require("mongoose");
const { Combination } = require("#utils/combination");
const { HeaderMapping } = require("#utils/headerMapping");
const {
  ProcessMatch,
  MATCHED_PROCESS_MATCH_FILTER,
} = require("#utils/processMatch");
const {
  getSalesInvFromRow,
  resolveSalesInvSource,
} = require("#controllers/company/admin/cha/match_process");
const { buildMatchBucketSummary } = require("./matchBucketSummary");

/**
 * Group sales rows by invoice value; count each unique inv once as matched / unmatched / partially_matched.
 *
 * - matched: every sales row with that inv is linked in processmatch to a PDF row
 * - unmatched: no sales row with that inv is linked in processmatch
 * - partially_matched: same inv on multiple sales rows, some matched and some not
 *
 * @param {import('mongoose').Types.ObjectId|string} companyId
 */
async function computeSalesInvPdfMatchCounts(companyId) {
  const SalesUploadRow = mongoose.models.SalesUploadRow;
  if (!SalesUploadRow) {
    const err = new Error(
      "SalesUploadRow model is not registered. Load sales routes once."
    );
    err.statusCode = 500;
    throw err;
  }

  const companyOid = new mongoose.Types.ObjectId(String(companyId));

  const [salesDocs, matchedSalesRowIds, headerMappingDoc, combinationDoc] =
    await Promise.all([
      SalesUploadRow.find({ companyId: companyOid })
        .select({ rowId: 1, data: 1 })
        .lean(),
      ProcessMatch.distinct("salesRowId", {
        companyId: companyOid,
        ...MATCHED_PROCESS_MATCH_FILTER,
        salesRowId: { $nin: [null, ""] },
      }),
      HeaderMapping.findOne({ companyId: companyOid }).lean(),
      Combination.findOne({ companyId: companyOid }).lean(),
    ]);

  const matchedSalesRowIdSet = new Set(
    matchedSalesRowIds.map((id) => String(id).trim()).filter(Boolean)
  );
  const salesInvColumn = resolveSalesInvSource(headerMappingDoc, combinationDoc);

  /** @type {Map<string, { rowIds: string[], matchedRowIds: string[] }>} */
  const byInv = new Map();

  for (const doc of salesDocs) {
    const rowId = String(doc.rowId || "").trim();
    if (!rowId) continue;

    const inv = getSalesInvFromRow(doc.data, salesInvColumn);
    if (!inv) continue;

    const isMatched = matchedSalesRowIdSet.has(rowId);

    const bucket = byInv.get(inv) || { rowIds: [], matchedRowIds: [] };
    bucket.rowIds.push(rowId);
    if (isMatched) bucket.matchedRowIds.push(rowId);
    byInv.set(inv, bucket);
  }

  return buildMatchBucketSummary(byInv, "inv");
}

const SALES_INV_STATUS_LABELS = {
  matched: "Matched",
  unmatched: "Unmatched",
  partially_matched: "Partially matched",
};

/**
 * Map normalized sales invoice → Matched | Unmatched | Partially matched
 * (same grouping rules as computeSalesInvPdfMatchCounts / GET /get-sap-inv).
 *
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @returns {Promise<Map<string, string>>}
 */
async function buildSalesInvStatusLabelByInv(companyId) {
  const summary = await computeSalesInvPdfMatchCounts(companyId);
  const map = new Map();

  for (const item of summary.matchedList || []) {
    if (item?.inv) map.set(String(item.inv), SALES_INV_STATUS_LABELS.matched);
  }
  for (const item of summary.unmatchedList || []) {
    if (item?.inv) map.set(String(item.inv), SALES_INV_STATUS_LABELS.unmatched);
  }
  for (const item of summary.partially_matchedList || []) {
    if (item?.inv) {
      map.set(String(item.inv), SALES_INV_STATUS_LABELS.partially_matched);
    }
  }

  return map;
}

module.exports = {
  computeSalesInvPdfMatchCounts,
  buildSalesInvStatusLabelByInv,
  SALES_INV_STATUS_LABELS,
};
