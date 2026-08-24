const { parseValueToDate } = require("#utils/applySalesDataClean");

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

/**
 * Indian financial year (Apr–Mar): e.g. 15-Jul-2024 → "2024-25".
 * @param {Date} date
 * @returns {string}
 */
function financialYearLabelFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

  const calendarYear = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 4 ? calendarYear : calendarYear - 1;
  const endYear = startYear + 1;

  return `${startYear}-${String(endYear).slice(-2)}`;
}

/**
 * Read date from the configured source column and set `financialYear` on each row.
 *
 * @param {object[]} rows
 * @param {string} dateColumnName — Excel header, e.g. "Billing Date"
 * @returns {object[]}
 */
function applyFinancialYearToRows(rows, dateColumnName) {
  const column = String(dateColumnName || "").trim();
  const list = Array.isArray(rows) ? rows : [];
  if (!column) return list;

  return list.map((row) => {
    const source = row && typeof row === "object" && !Array.isArray(row) ? row : {};
    const rawDate = getRowValueByColumnName(source, column);
    const parsed = parseValueToDate(rawDate);
    const financialYear = parsed ? financialYearLabelFromDate(parsed) : "";

    return {
      ...source,
      financialYear,
    };
  });
}

module.exports = {
  applyFinancialYearToRows,
  financialYearLabelFromDate,
  getRowValueByColumnName,
};
