
const { applyHeaderMappingToRows } = require("./headermapping");
const { createSalesAndPdfCombinations } = require("./createcombination");

function parseNumber(value) {
  if (typeof value === "number") return value;
  const str = String(value ?? "")
    .trim()
    .replace(/,/g, ""); // e.g. "1,234.56"

  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

function normalizeRoundMode(roundType) {
  const text = String(roundType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (["roundup", "up", "ceil"].includes(text)) return "round_up";
  if (["rounddown", "down", "floor"].includes(text)) return "round_down";
  if (text === "round") return "round";
  return "";
}

function isKnownRoundMode(value) {
  return Boolean(normalizeRoundMode(value));
}

function getRowValueByColumnName(row, columnName) {
  if (!row || columnName === undefined || columnName === null) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, columnName)) return row[columnName];

  const want = String(columnName).trim().toLowerCase();
  if (!want) return undefined;

  for (const key of Object.keys(row)) {
    if (String(key).trim().toLowerCase() === want) return row[key];
  }

  return undefined;
}

function resolveRoundType(row, roundTypeRef) {
  const ref = String(roundTypeRef ?? "").trim();
  if (!ref) return "";

  const fromRow = getRowValueByColumnName(row, ref);
  if (fromRow !== undefined && fromRow !== null && String(fromRow).trim() !== "") {
    return fromRow;
  }

  if (isKnownRoundMode(ref)) return ref;

  return ref;
}

function applyRoundType(value, roundType) {
  if (!Number.isFinite(value)) return value;

  switch (normalizeRoundMode(roundType)) {
    case "round_up":
      return Math.ceil(value);
    case "round_down":
      return Math.floor(value);
    case "round":
      return Math.round(value);
    default:
      return value;
  }
}

/**
 * roundMapping example:
 * { qty1: "round", qty2: "round", amount: "round" }
 *
 * Meaning:
 * - read rounding type from row[ roundMapping[destKey] ] (or use mapping value if it is a round mode)
 * - apply it to row[destKey] numeric value
 */
function applyRoundMapping(rows, roundMapping) {
  const list = Array.isArray(rows) ? rows : [];
  const mapping = roundMapping && typeof roundMapping === "object" ? roundMapping : {};

  return list.map((row) => {
    const out = { ...(row || {}) };

    for (const [destKey, roundTypeCol] of Object.entries(mapping)) {
      const rawVal = out[destKey];
      const num = parseNumber(rawVal);
      if (num === null) continue;

      const roundType = resolveRoundType(out, roundTypeCol);
      out[destKey] = applyRoundType(num, roundType);
    }

    return out;
  });
}

function getSalesAndPdfRoundMappings(headerMapping) {
  const salesround =
    headerMapping?.rounding?.sales !== undefined
      ? headerMapping.rounding.sales
      : headerMapping?.rounding || {};
  const pdfround =
    headerMapping?.rounding?.pdf !== undefined
      ? headerMapping.rounding.pdf
      : headerMapping?.rounding || {};

  return { salesround, pdfround };
}

function roundSalesAndPdfRows(salesRows, pdfItems, salesround, pdfround) {
  const salesRowsRounded = applyRoundMapping(salesRows, salesround);
  const pdfItemsRounded = applyRoundMapping(pdfItems, pdfround);

  return { salesRowsRounded, pdfItemsRounded };
}

/**
 * Sales: header mapping → combinations → round (rounding.sales) → rebuild combinations.
 */
function buildSalesRowsWithMappingRoundAndCombinations(
  rawRows,
  salesHeaderMapping,
  salesround,
  salesCombinationDefs
) {
  const { salesRows: afterHeaderMapping } = applyHeaderMappingToRows(
    rawRows,
    [],
    salesHeaderMapping,
    {}
  );

  const { salesRows: afterCombinations } = createSalesAndPdfCombinations(
    afterHeaderMapping,
    [],
    salesCombinationDefs,
    []
  );

  const { salesRowsRounded } = roundSalesAndPdfRows(
    afterCombinations,
    [],
    salesround,
    {}
  );

  const { salesRows: rowsWithCombinations } = createSalesAndPdfCombinations(
    salesRowsRounded,
    [],
    salesCombinationDefs,
    []
  );

  return rowsWithCombinations;
}

/**
 * PDF: header mapping → combinations → round (rounding.pdf) → rebuild combinations.
 * Used by upload-pdf and mailbox fetch (processUploadedPdfFiles).
 */
function buildPdfRowsWithMappingRoundAndCombinations(
  rawPdfItems,
  pdfHeaderMapping,
  pdfround,
  pdfCombinationDefs
) {
  const { pdfItems: afterHeaderMapping } = applyHeaderMappingToRows(
    [],
    rawPdfItems,
    {},
    pdfHeaderMapping
  );

  const { pdfItems: afterCombinations } = createSalesAndPdfCombinations(
    [],
    afterHeaderMapping,
    [],
    pdfCombinationDefs
  );

  const { pdfItemsRounded } = roundSalesAndPdfRows(
    [],
    afterCombinations,
    {},
    pdfround
  );

  const { pdfItems: rowsWithCombinations } = createSalesAndPdfCombinations(
    [],
    pdfItemsRounded,
    [],
    pdfCombinationDefs
  );

  return rowsWithCombinations;
}

module.exports = {
  applyRoundMapping,
  applyRoundType,
  buildPdfRowsWithMappingRoundAndCombinations,
  buildSalesRowsWithMappingRoundAndCombinations,
  getSalesAndPdfRoundMappings,
  normalizeRoundMode,
  roundSalesAndPdfRows,
};
