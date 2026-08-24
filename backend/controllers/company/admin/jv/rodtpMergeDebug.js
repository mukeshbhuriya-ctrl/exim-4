/**
 * Read-only JV RODTP sales↔PDF merge diagnostics. Logic mirrors `jvMerge.js`.
 */
const { JvSalesData } = require("../process/sales/jvsalesdata");
const { JvPdfData } = require("../process/pdf/jvpdfdata");
const {
  buildMergedRows,
  buildPdfInvIndex,
  iterSalesInvLookupKeys,
  toText,
} = require("./jvMerge");

const DEFAULT_RODTEP_SALES_FILTER = {
  $or: [{ "data.jv_rodtep": { $exists: false } }, { "data.jv_rodtep": { $ne: "complete" } }],
};

/**
 * @param {import("mongoose").Types.ObjectId|string} companyId
 * @param {{ salesFilter?: object; limitUnmatched?: number; samplePdfKeys?: number }} [options]
 */
async function debugJvRodtpMerge(companyId, options = {}) {
  const limitUnmatched = Math.max(0, Number(options.limitUnmatched) || 50);
  const samplePdfKeysN = Math.max(0, Number(options.samplePdfKeys) || 30);
  const salesFilter = {
    companyId,
    ...(options.salesFilter && typeof options.salesFilter === "object"
      ? options.salesFilter
      : DEFAULT_RODTEP_SALES_FILTER),
  };

  const [salesDocs, pdfDocs] = await Promise.all([
    JvSalesData.find(salesFilter).sort({ createdAt: 1 }).lean(),
    JvPdfData.find({ companyId }).sort({ createdAt: 1 }).lean(),
  ]);

  const pdfByInv = buildPdfInvIndex(pdfDocs);
  const mergedRows = buildMergedRows(salesDocs, pdfDocs);
  const mergedInvSet = new Set(mergedRows.map((r) => toText(r.inv)).filter(Boolean));

  const unmatchedSales = [];
  for (const sales of salesDocs || []) {
    const salesInv = toText(sales?.inv);
    const salesData =
      sales?.data && typeof sales.data === "object" && !Array.isArray(sales.data)
        ? sales.data
        : {};
    const invForDb = salesInv || toText(salesData.inv);
    if (!invForDb) continue;
    if (mergedInvSet.has(invForDb)) continue;

    const lookupKeys = iterSalesInvLookupKeys(salesInv, salesData).map((k) => String(k));
    if (unmatchedSales.length < limitUnmatched) {
      unmatchedSales.push({ invForDb, lookupKeys });
    }
  }

  const samplePdfKeys = [...pdfByInv.keys()].slice(0, samplePdfKeysN);

  return {
    salesCount: salesDocs.length,
    pdfDocCount: pdfDocs.length,
    pdfInvKeyCount: pdfByInv.size,
    mergedCount: mergedRows.length,
    unmatchedCount: salesDocs.filter((sales) => {
      const salesInv = toText(sales?.inv);
      const salesData =
        sales?.data && typeof sales.data === "object" && !Array.isArray(sales.data)
          ? sales.data
          : {};
      const invForDb = salesInv || toText(salesData.inv);
      if (!invForDb) return false;
      return !mergedInvSet.has(invForDb);
    }).length,
    unmatchedSales,
    samplePdfKeys,
  };
}

module.exports = {
  debugJvRodtpMerge,
  DEFAULT_RODTEP_SALES_FILTER,
};
