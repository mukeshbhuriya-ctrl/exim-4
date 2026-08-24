const { applyHeaderMappingToRows } = require("./headermapping");
const { roundSalesAndPdfRows } = require("./round");
const { createSalesAndPdfCombinations } = require("./createcombination");
const { Connection: connectRowsBySeq } = require("./seq");


const {
  HeaderMapping,
  sanitizeHeaderMapping,
} = require("#utils/headerMapping");
const {
  Combination,
  sanitizeCombination,
} = require("#utils/combination");
const {
  Connection,
  sanitizeConnection,
} = require("#utils/connection");

/**
 * @param {object} [options]
 * @param {boolean} [options.preprocessed] If true, salesRows/pdfItems already include
 *   header mapping + combination columns from upload; skip those steps (still apply rounding + matching).
 */
async function start(salesRows, pdfItems, companyId, options = {}) {
  const preprocessed = options.preprocessed === true;

  const headerMappingDoc = await HeaderMapping.findOne({ companyId });
  const combinationDoc = await Combination.findOne({ companyId });
  const connectionDoc = await Connection.findOne({ companyId });

  const headerMapping = sanitizeHeaderMapping(headerMappingDoc);
  const combination = sanitizeCombination(combinationDoc);
  const connection = sanitizeConnection(connectionDoc);

  // 4 vars for header mapping / rounding
  const salesround =
    headerMapping?.rounding?.sales !== undefined
      ? headerMapping.rounding.sales
      : headerMapping?.rounding || {};
  const pdfround =
    headerMapping?.rounding?.pdf !== undefined
      ? headerMapping.rounding.pdf
      : headerMapping?.rounding || {};
  const saledheadermapping = headerMapping?.sales || {};
  const pdfheadermaping = headerMapping?.pdf || {};

  // 2 vars for combinations
  const salesCombination = combination?.salesCombination || [];
  const pdfCombination = combination?.pdfCombination || [];

  // 1 var for connections
  const connections = connection?.connections || [];


  console.log("salesround", salesround);
  console.log("--------------------------------");
  console.log("pdfround", pdfround);
  console.log("--------------------------------");
  console.log("saledheadermapping", saledheadermapping);
  console.log("--------------------------------");
  console.log("pdfheadermaping", pdfheadermaping);
  console.log("--------------------------------");
  console.log("salesCombination", salesCombination);
  console.log("--------------------------------");
  console.log("pdfCombination", pdfCombination);
  console.log("--------------------------------");
  console.log("connections", connections);

//   console.log("--------------------------------");
//   console.log("salesRows", salesRows);
//   console.log("--------------------------------");
//   console.log("pdfItems", pdfItems);
//   console.log("--------------------------------");


  const { salesRows: salesRowsMapped, pdfItems: pdfItemsMapped } = preprocessed
    ? {
        salesRows: Array.isArray(salesRows) ? salesRows : [],
        pdfItems: Array.isArray(pdfItems) ? pdfItems : [],
      }
    : applyHeaderMappingToRows(
        salesRows,
        pdfItems,
        saledheadermapping,
        pdfheadermaping
      );

//   console.log("--------------------------------");
//   console.log("salesRowsMapped", salesRowsMapped);
//   console.log("--------------------------------");
//   console.log("pdfItemsMapped", pdfItemsMapped);
//   console.log("--------------------------------");

  const { salesRowsRounded, pdfItemsRounded } = roundSalesAndPdfRows(
    salesRowsMapped,
    pdfItemsMapped,
    salesround,
    pdfround
  );

//   console.log("--------------------------------");
//   console.log("salesRowsRounded", salesRowsRounded);
//   console.log("--------------------------------");
//   console.log("pdfItemsRounded", pdfItemsRounded);
//   console.log("--------------------------------");

  const { salesRows: salesRowsWithCombos, pdfItems: pdfItemsWithCombos } =
    createSalesAndPdfCombinations(
      salesRowsRounded,
      pdfItemsRounded,
      salesCombination,
      pdfCombination
    );

  const {
    matched,
    salesRemaining,
    pdfRemaining,
    salesRowsWithRepet,
    pdfRowsWithRepet,
    matchDuplicateRuleCount,
  } = connectRowsBySeq(
    connections,
    salesRowsWithCombos,
    pdfItemsWithCombos,
    salesCombination,
    pdfCombination
  );

  const isInternalMatchKey = (k) => String(k).startsWith("__navi");

  const matchedFlat = matched.map((item) => ({
    seq: item.seq,
    matchValue: item.matchValue,
    matchDuplicate: Boolean(item.matchDuplicate),
    salesCombination: item.salesCombination,
    pdfCombination: item.pdfCombination,
    ...Object.fromEntries(
      Object.entries(item.salesRow || {})
        .filter(([k]) => !isInternalMatchKey(k))
        .map(([k, v]) => [`sales.${k}`, v])
    ),
    ...Object.fromEntries(
      Object.entries(item.pdfRow || {})
        .filter(([k]) => !isInternalMatchKey(k))
        .map(([k, v]) => [`pdf.${k}`, v])
    ),
  }));


  return {
    salesround,
    pdfround,
    saledheadermapping,
    pdfheadermaping,
    salesCombination,
    pdfCombination,
    connections,
    matchDuplicateRuleCount: matchDuplicateRuleCount || 0,
    salesRows: salesRowsMapped,
    pdfItems: pdfItemsMapped,
    salesRowsWithRepet,
    pdfRowsWithRepet,
    matchingRows: matchedFlat,
    matched,
    remainingSalesRows: salesRemaining,
    remainingPdfsRows: pdfRemaining,
  };
}

module.exports = {
  start,
};
