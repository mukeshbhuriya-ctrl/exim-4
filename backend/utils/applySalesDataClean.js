const xlsx = require("xlsx");
const {
  SalesDataClean,
  sanitizeSalesDataClean,
} = require("#utils/salesDataClean");

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateDdMmYyyy(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function isReasonableDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return false;
  const y = d.getFullYear();
  return y >= 1990 && y <= 2100;
}

function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const ms = EXCEL_EPOCH_MS + Math.round(n * 86400000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseValueToDate(value) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    return isReasonableDate(value) ? value : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = xlsx.SSF?.parse_date_code?.(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      const d = new Date(parsed.y, parsed.m - 1, parsed.d);
      if (isReasonableDate(d)) return d;
    }
    const asDate = excelSerialToDate(value);
    if (asDate && isReasonableDate(asDate) && value >= 20000 && value < 80000) {
      return asDate;
    }
    return null;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text)) {
    const parts = text.split(/[-/.]/);
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    const d = new Date(year, month - 1, day);
    if (
      isReasonableDate(d) &&
      d.getFullYear() === year &&
      d.getMonth() === month - 1 &&
      d.getDate() === day
    ) {
      return d;
    }
  }

  const dmy =
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s|T|$)/.exec(text) ||
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const d = new Date(year, month - 1, day);
    if (isReasonableDate(d) && d.getDate() === day && d.getMonth() === month - 1) {
      return d;
    }
  }

  const normalizedNumber = text.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(normalizedNumber)) {
    const n = Number(normalizedNumber);
    const parsed = xlsx.SSF?.parse_date_code?.(n);
    if (parsed?.y && parsed?.m && parsed?.d) {
      const d = new Date(parsed.y, parsed.m - 1, parsed.d);
      if (isReasonableDate(d)) return d;
    }
    const asDate = excelSerialToDate(n);
    if (asDate && isReasonableDate(asDate) && n >= 20000 && n < 80000) {
      return asDate;
    }
  }

  const parsedMs = Date.parse(text);
  if (!Number.isNaN(parsedMs)) {
    const d = new Date(parsedMs);
    return isReasonableDate(d) ? d : null;
  }

  return null;
}

function valueToCleanText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return String(value);
}

function applyRemoveDigits(value, side, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!n) return value;

  const text = valueToCleanText(value);
  if (!text) return value;

  const chars = text.split("");
  const digitIndexes = [];
  chars.forEach((ch, index) => {
    if (/\d/.test(ch)) digitIndexes.push(index);
  });
  if (!digitIndexes.length) return value;

  const indexesToRemove =
    side === "last" ? digitIndexes.slice(-n) : digitIndexes.slice(0, n);
  const removeSet = new Set(indexesToRemove);
  const cleaned = chars.map((ch, index) => (removeSet.has(index) ? "" : ch)).join("");
  return cleaned || value;
}

function normalizeNumberCellValue(value) {
  if (value === null || value === undefined || value === "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = String(value).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return value;

  const n = Number(text);
  return Number.isFinite(n) ? n : value;
}

/** Parse a cell to a number for summing; non-numeric → 0. */
function parseNumericForSum(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Merge two sales `data` objects.
 * - Columns with sales-data-clean `sum: true` → numeric sum
 * - All other columns → keep primary row value (no concat); fill from secondary only if primary empty
 */
function mergeSalesRowData(primaryData, secondaryData, cleanRules = []) {
  const primary =
    primaryData && typeof primaryData === "object" && !Array.isArray(primaryData)
      ? { ...primaryData }
      : {};
  const secondary =
    secondaryData && typeof secondaryData === "object" && !Array.isArray(secondaryData)
      ? secondaryData
      : {};

  const sumRules = (Array.isArray(cleanRules) ? cleanRules : []).filter((r) => r?.sum);
  const sumKeysHandled = new Set();

  for (const rule of sumRules) {
    const columnName = String(rule.columnName || "").trim();
    if (!columnName) continue;

    const keyA = findRowKey(primary, columnName);
    const keyB = findRowKey(secondary, columnName);
    if (!keyA && !keyB) continue;

    const key = keyA || keyB;
    const a = keyA ? primary[keyA] : 0;
    const b = keyB ? secondary[keyB] : 0;
    primary[key] = parseNumericForSum(a) + parseNumericForSum(b);
    sumKeysHandled.add(String(key).trim().toLowerCase());
    if (keyA) sumKeysHandled.add(String(keyA).trim().toLowerCase());
    if (keyB) sumKeysHandled.add(String(keyB).trim().toLowerCase());
  }

  // Non-sum keys: keep primary; only take secondary when primary is empty/missing.
  for (const [key, valueB] of Object.entries(secondary)) {
    const keyLower = String(key).trim().toLowerCase();
    if (sumKeysHandled.has(keyLower)) continue;

    if (!Object.prototype.hasOwnProperty.call(primary, key) || isNullOrEmptyValue(primary[key])) {
      primary[key] = valueB;
    }
  }

  return primary;
}

function findRowKey(row, columnName) {
  if (!row || typeof row !== "object" || !columnName) return null;
  if (Object.prototype.hasOwnProperty.call(row, columnName)) return columnName;

  const want = String(columnName).trim().toLowerCase();
  if (!want) return null;

  for (const key of Object.keys(row)) {
    if (String(key).trim().toLowerCase() === want) return key;
  }
  return null;
}

function applyCleanValue(value, rule) {
  if (!rule) return value;

  const type = rule.type || "word";
  const removeDigits = rule.removeDigits || {};

  if (type === "date") {
    const d = parseValueToDate(value);
    return d ? formatDateDdMmYyyy(d) : value;
  }

  if (removeDigits.enabled && removeDigits.count) {
    return applyRemoveDigits(value, removeDigits.side || "first", removeDigits.count);
  }

  // SUM columns are always normalized as numbers.
  if (type === "number" || rule.sum) {
    return normalizeNumberCellValue(value);
  }

  return value;
}

function buildRulesByColumnName(columns) {
  const map = new Map();
  for (const col of columns || []) {
    const name = String(col?.columnName ?? "").trim();
    if (!name) continue;
    map.set(name.toLowerCase(), col);
  }
  return map;
}

function isNullOrEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

function filterRowsByNotNullRules(rows, rules) {
  const notNullRules = (Array.isArray(rules) ? rules : []).filter((rule) => rule.requireNotNull);
  if (!notNullRules.length) {
    return { rows: Array.isArray(rows) ? rows : [], skippedCount: 0 };
  }

  const list = Array.isArray(rows) ? rows : [];
  const kept = [];
  let skippedCount = 0;

  for (const row of list) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      skippedCount += 1;
      continue;
    }

    let reject = false;
    for (const rule of notNullRules) {
      const columnName = String(rule.columnName || "").trim();
      if (!columnName) continue;

      const key = findRowKey(row, columnName);
      if (!key || isNullOrEmptyValue(row[key])) {
        reject = true;
        break;
      }
    }

    if (reject) {
      skippedCount += 1;
    } else {
      kept.push(row);
    }
  }

  return { rows: kept, skippedCount };
}

/**
 * @param {import('mongoose').Types.ObjectId|string} companyId
 */
async function loadSalesDataCleanRules(companyId) {
  if (!companyId) return [];
  const doc = await SalesDataClean.findOne({ companyId }).lean();
  return sanitizeSalesDataClean(doc).columns || [];
}

/**
 * Apply configured sales clean rules to raw Excel/SAP rows (original column headers).
 * @param {object[]} rows
 * @param {object[]} rules
 */
function applySalesDataCleanToRows(rows, rules) {
  const list = Array.isArray(rows) ? rows : [];
  const columns = Array.isArray(rules) ? rules : [];
  if (!list.length || !columns.length) return list;

  const rulesByName = buildRulesByColumnName(columns);

  return list.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;

    const out = { ...row };
    for (const rule of columns) {
      const columnName = String(rule.columnName || "").trim();
      if (!columnName) continue;

      const key = findRowKey(out, columnName);
      if (!key) continue;

      const ruleKey = columnName.toLowerCase();
      const effectiveRule = rulesByName.get(ruleKey);
      out[key] = applyCleanValue(out[key], effectiveRule);
    }
    return out;
  });
}

/**
 * Load rules and clean rows in one step.
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @param {object[]} rows
 */
async function cleanSalesRowsForCompany(companyId, rows) {
  const rules = await loadSalesDataCleanRules(companyId);
  const cleanedRows = applySalesDataCleanToRows(rows, rules);
  const { rows: filteredRows, skippedCount } = filterRowsByNotNullRules(cleanedRows, rules);
  return {
    rules,
    cleanedRows: filteredRows,
    skipped_null_rows: skippedCount,
  };
}

module.exports = {
  loadSalesDataCleanRules,
  applySalesDataCleanToRows,
  cleanSalesRowsForCompany,
  filterRowsByNotNullRules,
  isNullOrEmptyValue,
  parseValueToDate,
  formatDateDdMmYyyy,
  applyRemoveDigits,
  parseNumericForSum,
  mergeSalesRowData,
  findRowKey,
};
