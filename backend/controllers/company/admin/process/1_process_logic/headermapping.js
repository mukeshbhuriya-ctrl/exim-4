function getRowValueForSourceColumn(row, sourceColumn) {
  if (!row || sourceColumn === undefined || sourceColumn === null) return null;
  if (Object.prototype.hasOwnProperty.call(row, sourceColumn)) {
    return row[sourceColumn];
  }
  const want = String(sourceColumn).trim().toLowerCase();
  if (!want) return null;
  for (const k of Object.keys(row)) {
    if (String(k).trim().toLowerCase() === want) return row[k];
  }
  return null;
}

function applyHeaderMappingToRows(
  salesRows,
  pdfItems,
  saledheadermapping,
  pdfheadermaping
) {
  const sales = Array.isArray(salesRows) ? salesRows : [];
  const pdf = Array.isArray(pdfItems) ? pdfItems : [];

  const salesMapped = sales.map((row) => {
    const out = { ...(row || {}) };
    const mapping = saledheadermapping || {};

    for (const [destKey, sourceColumn] of Object.entries(mapping)) {
      out[destKey] = getRowValueForSourceColumn(row, sourceColumn);
    }

    return out;
  });

  const pdfMapped = pdf.map((row) => {
    const out = { ...(row || {}) };
    const mapping = pdfheadermaping || {};

    for (const [destKey, sourceColumn] of Object.entries(mapping)) {
      out[destKey] = getRowValueForSourceColumn(row, sourceColumn);
    }

    return out;
  });

  return { salesRows: salesMapped, pdfItems: pdfMapped };
}

module.exports = {
  applyHeaderMappingToRows,
};

