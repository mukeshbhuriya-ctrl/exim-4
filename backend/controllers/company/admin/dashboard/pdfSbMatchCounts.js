const mongoose = require("mongoose");
const { ProcessMatch } = require("#utils/processMatch");
const { normalizeSbNoForMatch } = require("#utils/shippingBillNo");
const { getRowValueByToken } = require("#controllers/company/admin/process/1_process_logic/createcombination");
const { buildMatchBucketSummary } = require("./matchBucketSummary");
const {
  loadProcessMatches,
  buildMatchedPdfUploadRowIdSet,
} = require("#utils/processMatchPdfResolve");

const PDF_SB_NO_KEYS = ["SB No", "sbNo", "SB NO", "Shipping Bill No"];

function getSbNoFromPdfRow(data) {
  if (!data || typeof data !== "object") return "";

  for (const key of PDF_SB_NO_KEYS) {
    const fromToken = getRowValueByToken(data, key);
    if (fromToken != null && String(fromToken).trim()) {
      return normalizeSbNoForMatch(fromToken);
    }
  }

  for (const k of Object.keys(data)) {
    if (/^sb\s*no$/i.test(String(k).trim()) && String(data[k]).trim()) {
      return normalizeSbNoForMatch(data[k]);
    }
  }

  return "";
}

/**
 * Group PDF rows by `data.SB No`; count each unique SB No once as matched / unmatched / partially_matched.
 *
 * A PDF row is matched when it is linked to a sales row in `processmatch` (not sbonline).
 * - matched: every PDF row with that SB No is linked in processmatch
 * - unmatched: no PDF row with that SB No is linked in processmatch
 * - partially_matched: same SB No on multiple PDF rows, some linked and some not
 *
 * @param {import('mongoose').Types.ObjectId|string} companyId
 */
async function computePdfSbMatchCounts(companyId) {
  const PdfUploadRow = mongoose.models.PdfUploadRow;
  if (!PdfUploadRow) {
    const err = new Error(
      "PdfUploadRow model is not registered. Load PDF routes once."
    );
    err.statusCode = 500;
    throw err;
  }

  const companyOid = new mongoose.Types.ObjectId(String(companyId));

  const [pdfDocs, matches] = await Promise.all([
    PdfUploadRow.find({ companyId: companyOid })
      .select({ pdfRowId: 1, rowId: 1, data: 1 })
      .lean(),
    loadProcessMatches(companyId, ProcessMatch),
  ]);

  const matchedPdfRowIdSet = buildMatchedPdfUploadRowIdSet(pdfDocs, matches);

  /** @type {Map<string, { rowIds: string[], matchedRowIds: string[] }>} */
  const bySbNo = new Map();

  for (const doc of pdfDocs) {
    const rowId = String(doc.pdfRowId || "").trim();
    if (!rowId) continue;

    const sbNo = getSbNoFromPdfRow(doc.data);
    if (!sbNo) continue;

    const isMatched = matchedPdfRowIdSet.has(rowId);

    const bucket = bySbNo.get(sbNo) || { rowIds: [], matchedRowIds: [] };
    bucket.rowIds.push(rowId);
    if (isMatched) bucket.matchedRowIds.push(rowId);
    bySbNo.set(sbNo, bucket);
  }

  return buildMatchBucketSummary(bySbNo, "sbNo");
}

module.exports = {
  computePdfSbMatchCounts,
  getSbNoFromPdfRow,
};
