
function normalizeCombinationDef(def) {
  // "INV | QTY1 | AMOUNT" => "INV|QTY1|AMOUNT"
  return String(def || "")
    .split("|")
    .map((s) => String(s).trim())
    .filter(Boolean)
    .join("|");
}

function normalizeCombinationColumnName(def) {
  // Keep the same display style as config: "INV | QTY1 | AMOUNT"
  const tokens = String(def || "")
    .split("|")
    .map((s) => String(s).trim())
    .filter(Boolean);

  return tokens.join(" | ");
}

function getRowValueByToken(row, token) {
  const want_lc = String(token || "").trim().toLowerCase();
  if (!row || typeof row !== "object" || !want_lc) return undefined;

  if (Object.prototype.hasOwnProperty.call(row, token)) return row[token];
  if (Object.prototype.hasOwnProperty.call(row, want_lc)) return row[want_lc];

  for (const k of Object.keys(row)) {
    if (String(k).trim().toLowerCase() === want_lc) return row[k];
  }
  return undefined;
}

function buildCombinationColumnsForRow(row, combinationDefs) {
  const defs = Array.isArray(combinationDefs) ? combinationDefs : [];
  const columns = {};

  for (const def of defs) {
    const defKey = normalizeCombinationDef(def);
    const colName = normalizeCombinationColumnName(def);
    const tokens = defKey.split("|").filter(Boolean);

    const values = tokens.map((t) => getRowValueByToken(row, t));
    const hasMissing = values.some(
      (v) => v === undefined || v === null || String(v).trim() === ""
    );

    columns[colName] = hasMissing
      ? null
      : values.map((v) => String(v).trim()).join("|");
  }

  return columns;
}

function createSalesAndPdfCombinations(salesRows, pdfItems, salesCombination, pdfCombination) {
  const sales = Array.isArray(salesRows) ? salesRows : [];
  const pdf = Array.isArray(pdfItems) ? pdfItems : [];

  const salesDefs = Array.isArray(salesCombination) ? salesCombination : [];
  const pdfDefs = Array.isArray(pdfCombination) ? pdfCombination : [];

  const salesWithCombos = sales.map((row) => ({
    ...(row || {}),
    ...buildCombinationColumnsForRow(row, salesDefs),
  }));

  const pdfWithCombos = pdf.map((row) => ({
    ...(row || {}),
    ...buildCombinationColumnsForRow(row, pdfDefs),
  }));

  return {
    salesRows: salesWithCombos,
    pdfItems: pdfWithCombos,
  };
}

module.exports = {
  createSalesAndPdfCombinations,
  getRowValueByToken,
};

