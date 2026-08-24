const {
  GROUP_BY_COLUMN,
  getJvPdfDocInv,
  normalizePdfInv,
  pickJvMergeInvValue,
} = require("../process/pdf/jvpdfdata");

function toText(value) {
  return String(value ?? "").trim();
}

function normalizeJvInvKey(value) {
  return normalizePdfInv(value);
}

/** PDF amount / SB fields — must not be overwritten by sales row spread. */
const JV_PDF_PRESERVE_FIELDS = [
  GROUP_BY_COLUMN,
  "inv",
  "INV_2",
  "total_dbk_amt",
  "total_rdt_value",
  "SB No",
  "SB Date",
  "Port Code",
];

function addJvPdfDocToInvMap(pdfByInv, doc) {
  const data =
    doc?.data && typeof doc.data === "object" && !Array.isArray(doc.data) ? doc.data : {};

  const candidates = [
    getJvPdfDocInv(doc),
    doc?.inv,
    doc?.inv_2,
    data.inv,
    data[GROUP_BY_COLUMN],
    data.INV_2,
    pickJvMergeInvValue(data),
  ];

  for (const raw of candidates) {
    const k = normalizeJvInvKey(raw);
    if (!k || pdfByInv.has(k)) continue;
    pdfByInv.set(k, data);
  }
}

function buildPdfInvIndex(pdfDocs) {
  const pdfByInv = new Map();
  for (const doc of pdfDocs || []) {
    addJvPdfDocToInvMap(pdfByInv, doc);
  }
  return pdfByInv;
}

/**
 * Match sales root `inv` to PDF `inv` only.
 */
function iterSalesInvLookupKeys(salesInv, salesData) {
  const keys = [];
  const seen = new Set();
  const push = (raw) => {
    const k = normalizeJvInvKey(raw);
    if (!k || seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };

  push(salesInv);
  if (!toText(salesInv) && salesData && typeof salesData === "object" && !Array.isArray(salesData)) {
    push(salesData.inv);
    push(salesData.INV);
  }
  return keys;
}

function applyPdfPreserveFields(merged, pdfData) {
  if (!pdfData || typeof pdfData !== "object") return merged;
  for (const field of JV_PDF_PRESERVE_FIELDS) {
    if (pdfData[field] !== undefined && pdfData[field] !== null && String(pdfData[field]).trim() !== "") {
      merged[field] = pdfData[field];
    }
  }
  return merged;
}

function resolveInvForDb(salesInv, salesData, pdfData) {
  const fromSales = salesInv || toText(salesData.inv);
  if (fromSales) return fromSales;
  return toText(
    pdfData.inv ||
      pdfData.INV_2 ||
      pdfData[GROUP_BY_COLUMN] ||
      pickJvMergeInvValue(pdfData)
  );
}

function buildMergedRows(salesDocs, pdfDocs) {
  const pdfByInv = buildPdfInvIndex(pdfDocs);
  const out = [];

  for (const sales of salesDocs || []) {
    const salesInv = toText(sales?.inv);
    const salesData =
      sales?.data && typeof sales.data === "object" && !Array.isArray(sales.data)
        ? sales.data
        : {};

    let pdfData = null;
    let matchedKey = "";
    for (const k of iterSalesInvLookupKeys(salesInv, salesData)) {
      pdfData = pdfByInv.get(k);
      if (pdfData) {
        matchedKey = k;
        break;
      }
    }
    if (!pdfData) continue;

    const invForDb = resolveInvForDb(salesInv, salesData, pdfData);
    if (!invForDb) continue;

    const invPdfDisplay =
      toText(pdfData.inv) || toText(pdfData.INV_2) || toText(pdfData[GROUP_BY_COLUMN]) || invForDb;

    const merged = {
      ...salesData,
      ...pdfData,
      inv: invForDb,
      jvsalesdata: { data: salesData },
      jvpdfdata: { data: pdfData },
      _jvMatchKey: matchedKey,
    };
    applyPdfPreserveFields(merged, pdfData);
    out.push(merged);
  }

  return out;
}

function buildJvMergeSummary(salesDocs, pdfDocs, mergedRows, postingAccounts) {
  const pdfByInv = buildPdfInvIndex(pdfDocs);
  const postingAccountsCount = Array.isArray(postingAccounts) ? postingAccounts.length : 0;
  const mergedCount = Array.isArray(mergedRows) ? mergedRows.length : 0;

  return {
    salesCount: Array.isArray(salesDocs) ? salesDocs.length : 0,
    pdfDocCount: Array.isArray(pdfDocs) ? pdfDocs.length : 0,
    pdfInvKeyCount: pdfByInv.size,
    mergedCount,
    unmatchedSalesCount: Math.max(
      0,
      (Array.isArray(salesDocs) ? salesDocs.length : 0) - mergedCount
    ),
    postingAccountsCount,
    generatedRowsPerMerge: postingAccountsCount,
    expectedGeneratedRows: mergedCount * postingAccountsCount,
  };
}

module.exports = {
  toText,
  normalizeJvInvKey,
  buildPdfInvIndex,
  iterSalesInvLookupKeys,
  buildMergedRows,
  buildJvMergeSummary,
};
