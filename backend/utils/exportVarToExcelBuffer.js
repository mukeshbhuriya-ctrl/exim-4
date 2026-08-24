const xlsx = require("xlsx");

function cellValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function normalizeRowsForSheet(flatRows) {
  const keys = new Set();
  for (const r of flatRows) {
    if (r && typeof r === "object") {
      for (const k of Object.keys(r)) keys.add(k);
    }
  }
  const order = [...keys].sort();
  return flatRows.map((r) => {
    const o = {};
    const src = r && typeof r === "object" ? r : {};
    for (const k of order) o[k] = cellValue(src[k]);
    return o;
  });
}

/**
 * Build an .xlsx file buffer from an array of plain row objects (variable keys per row).
 * @param {object[]} rows
 * @param {string} sheetName — Excel max 31 chars; longer names are truncated
 */
function exportVarToExcelBuffer(rows, sheetName) {
  const normalized = normalizeRowsForSheet(Array.isArray(rows) ? rows : []);
  const ws = xlsx.utils.json_to_sheet(
    normalized.length ? normalized : [{ _empty: "" }]
  );
  const wb = xlsx.utils.book_new();
  const name = String(sheetName || "Sheet").slice(0, 31) || "Sheet";
  xlsx.utils.book_append_sheet(wb, ws, name);
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = { exportVarToExcelBuffer };
