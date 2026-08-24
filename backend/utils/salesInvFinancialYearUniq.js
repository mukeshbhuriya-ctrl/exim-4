const mongoose = require("mongoose");
const { normalizePdfInv } = require("#controllers/company/admin/process/pdf/jvpdfdata");

function normalizeFinancialYearLabel(value) {
  return String(value ?? "").trim();
}

function extractInvFromSalesRow(row) {
  const data = row && typeof row === "object" && !Array.isArray(row) ? row : {};
  const raw = data.inv ?? data.INV_2 ?? data.invoice ?? data["Invoice No"] ?? "";
  const normalized = normalizePdfInv(String(raw).trim());
  return normalized || String(raw).trim();
}

/**
 * Composite key for uniqueness: inv + financialYear (case-normalized FY label).
 * Returns empty string when either part is missing (row is not deduped).
 */
function buildInvFinancialYearKey(row) {
  const inv = extractInvFromSalesRow(row);
  const financialYear = normalizeFinancialYearLabel(row?.financialYear);
  if (!inv || !financialYear) return "";
  return `${inv}|${financialYear.toLowerCase()}`;
}

/**
 * Load existing inv+financialYear pairs for a company from SalesUploadRow.
 *
 * @param {import('mongoose').Model} SalesUploadRow
 * @param {import('mongoose').Types.ObjectId|string} companyId
 */
async function loadExistingInvFinancialYearKeys(SalesUploadRow, companyId) {
  const oid = new mongoose.Types.ObjectId(String(companyId));
  const docs = await SalesUploadRow.find(
    { companyId: oid },
    { "data.inv": 1, "data.financialYear": 1, "data.INV_2": 1 }
  ).lean();

  const keys = new Set();
  for (const doc of docs) {
    const key = buildInvFinancialYearKey(doc?.data || {});
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Keep rows whose inv+financialYear is not already stored in the DB.
 * Same inv+FY may appear multiple times in one upload/batch (line items) — all are kept.
 * A later batch is blocked once that inv+FY already exists in SalesUploadRow.
 *
 * @param {import('mongoose').Model} SalesUploadRow
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @param {object[]} rows
 */
async function filterSalesRowsByInvFinancialYear(SalesUploadRow, companyId, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return { rowsToInsert: [], skipped: [] };
  }

  const existingKeys = await loadExistingInvFinancialYearKeys(SalesUploadRow, companyId);
  const rowsToInsert = [];
  const skipped = [];

  for (const row of list) {
    const key = buildInvFinancialYearKey(row);
    if (!key) {
      rowsToInsert.push(row);
      continue;
    }

    // Only block when this inv+financialYear already exists from a previous batch.
    if (existingKeys.has(key)) {
      skipped.push({
        reason: "duplicate_inv_financial_year",
        inv: extractInvFromSalesRow(row),
        financialYear: normalizeFinancialYearLabel(row?.financialYear),
      });
      continue;
    }

    rowsToInsert.push(row);
  }

  return { rowsToInsert, skipped };
}

module.exports = {
  buildInvFinancialYearKey,
  extractInvFromSalesRow,
  filterSalesRowsByInvFinancialYear,
  loadExistingInvFinancialYearKeys,
  normalizeFinancialYearLabel,
};
