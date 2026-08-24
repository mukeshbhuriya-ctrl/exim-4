const mongoose = require("mongoose");
const { MATCHED_PROCESS_MATCH_FILTER } = require("#utils/processMatch");

function toCompanyOid(companyId) {
  return new mongoose.Types.ObjectId(String(companyId));
}

function indexPdfUploadRows(pdfDocs) {
  const pdfByRowId = new Map();
  for (const doc of pdfDocs || []) {
    const pdfRowId = String(doc?.pdfRowId ?? "").trim();
    const rowId = String(doc?.rowId ?? "").trim();
    if (pdfRowId) pdfByRowId.set(pdfRowId, doc);
    if (rowId) pdfByRowId.set(rowId, doc);
  }
  return pdfByRowId;
}

function buildPdfFallbackByCombinationMap(pdfDocs, matches) {
  const needed = [];
  const seen = new Set();

  for (const m of matches || []) {
    const combo = String(m?.pdfCombination ?? "").trim();
    const value = String(m?.matchValue ?? "").trim();
    if (!combo || !value) continue;
    const key = `${combo}|||${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    needed.push({ combo, value, key });
  }

  const out = new Map();
  for (const doc of pdfDocs || []) {
    const data =
      doc?.data && typeof doc.data === "object" && !Array.isArray(doc.data)
        ? doc.data
        : {};
    for (const { combo, value, key } of needed) {
      if (String(data[combo] ?? "").trim() === value && !out.has(key)) {
        out.set(key, doc);
      }
    }
  }

  return out;
}

function resolvePdfUploadRowFromMatch(match, pdfByRowId, pdfByComboAndValue) {
  const pdfRowId = String(match?.pdfRowId ?? "").trim();
  if (pdfRowId && pdfByRowId.has(pdfRowId)) {
    return pdfByRowId.get(pdfRowId);
  }

  const combo = String(match?.pdfCombination ?? "").trim();
  const value = String(match?.matchValue ?? "").trim();
  if (combo && value) {
    return pdfByComboAndValue.get(`${combo}|||${value}`) || null;
  }

  return null;
}

function canonicalPdfUploadRowId(doc) {
  return String(doc?.pdfRowId ?? "").trim();
}

/**
 * Resolve current PdfUploadRow.pdfRowId values that are linked in processmatch.
 * Uses pdfRowId, legacy rowId, and pdfCombination + matchValue fallback (same as report).
 */
function buildMatchedPdfUploadRowIdSet(pdfDocs, matches) {
  const pdfByRowId = indexPdfUploadRows(pdfDocs);
  const pdfByComboAndValue = buildPdfFallbackByCombinationMap(pdfDocs, matches);
  const matchedIds = new Set();

  for (const match of matches || []) {
    const doc = resolvePdfUploadRowFromMatch(match, pdfByRowId, pdfByComboAndValue);
    const canonicalId = canonicalPdfUploadRowId(doc);
    if (canonicalId) matchedIds.add(canonicalId);
  }

  return matchedIds;
}

async function loadProcessMatches(companyId, ProcessMatch) {
  const companyOid = toCompanyOid(companyId);
  return ProcessMatch.find({
    companyId: companyOid,
    ...MATCHED_PROCESS_MATCH_FILTER,
  })
    .select({ salesRowId: 1, pdfRowId: 1, pdfCombination: 1, matchValue: 1, matchType: 1 })
    .lean();
}

async function distinctMatchedRowIds(companyId, field, ProcessMatch) {
  const companyOid = toCompanyOid(companyId);
  return ProcessMatch.distinct(field, {
    companyId: companyOid,
    ...MATCHED_PROCESS_MATCH_FILTER,
    [field]: { $nin: [null, ""] },
  });
}

module.exports = {
  buildMatchedPdfUploadRowIdSet,
  buildPdfFallbackByCombinationMap,
  resolvePdfUploadRowFromMatch,
  loadProcessMatches,
  distinctMatchedRowIds,
  canonicalPdfUploadRowId,
};
