const mongoose = require("mongoose");

const headerMappingSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
    },
    rounding: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    sales: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    pdf: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    jvProcess: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    /** Report filter date column mapping, e.g. { date: "Invoice Date" }. */
    filterDate: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    /** Sales row uniqueness columns, e.g. { columns: ["Invoice No", "Date"] }. */
    salesUniqeColumn: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ columns: [] }),
    },
    /** Sales financial year column, e.g. { column: "Financial Year" }. */
    financialYear: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    /** Manual process match — sales description column, e.g. { column: "Item Description" }. */
    manualMatchDescription: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    /** Shared Excel column headers for all mapping dropdowns, e.g. { columns: ["Invoice No", ...] }. */
    columnMapping: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ columns: [] }),
    },
  },
  {
    collection: "headermapping",
    timestamps: true,
  }
);

const HeaderMapping =
  mongoose.models.HeaderMapping ||
  mongoose.model("HeaderMapping", headerMappingSchema);

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function normalizeMappingBody(body = {}) {
  const rounding = isPlainObject(body.rounding) ? body.rounding : {};
  const sales = isPlainObject(body.sales) ? body.sales : {};
  const pdf = isPlainObject(body.pdf) ? body.pdf : {};

  return { rounding, sales, pdf };
}

function normalizeJvProcessBody(body = {}) {
  if (isPlainObject(body?.jvProcess)) return body.jvProcess;
  if (isPlainObject(body?.headers)) return body.headers;
  if (isPlainObject(body?.mapping)) return body.mapping;
  if (isPlainObject(body)) return body;
  return {};
}

const FILTER_DATE_RESERVED_KEYS = new Set([
  "rounding",
  "sales",
  "pdf",
  "jvProcess",
  "filterDate",
  "salesUniqeColumn",
  "financialYear",
  "manualMatchDescription",
  "columnMapping",
  "companyId",
]);

/** Body like `{ "date": "Invoice Date" }` or `{ filterDate: { date: "Invoice Date" } }`. */
function normalizeFilterDateBody(body = {}) {
  const source = isPlainObject(body?.filterDate) ? body.filterDate : body;
  if (!isPlainObject(source)) return {};

  const out = {};
  for (const [key, value] of Object.entries(source)) {
    const k = String(key).trim();
    if (!k || FILTER_DATE_RESERVED_KEYS.has(k)) continue;
    const v = String(value ?? "").trim();
    if (!v) continue;
    out[k] = v;
  }
  return out;
}

/** Body: `{ columns: ["Invoice No"] }` or `{ salesUniqeColumn: { columns: [...] } }`. */
function normalizeSalesUniqeColumnBody(body = {}) {
  const source = isPlainObject(body?.salesUniqeColumn)
    ? body.salesUniqeColumn
  : isPlainObject(body?.salesUniqueColumn)
    ? body.salesUniqueColumn
    : body;

  let rawColumns = source?.columns ?? source?.columnNames ?? source?.headers;
  if (rawColumns == null && Array.isArray(body)) {
    rawColumns = body;
  }
  if (!Array.isArray(rawColumns)) return { columns: [] };

  const columns = rawColumns
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return { columns: [...new Set(columns)] };
}

/**
 * Body: `{ column: "Financial Year" }` or `{ financialYear: { column: "..." } }` or `{ financialYear: "..." }`.
 */
function normalizeFinancialYearBody(body = {}) {
  if (typeof body === "string") {
    const column = body.trim();
    return column ? { column } : {};
  }

  if (isPlainObject(body?.financialYear) && !Array.isArray(body.financialYear)) {
    const column = String(body.financialYear.column ?? "").trim();
    return column ? { column } : {};
  }

  if (typeof body?.financialYear === "string") {
    const column = body.financialYear.trim();
    return column ? { column } : {};
  }

  const column = String(body?.column ?? "").trim();
  if (!column) return {};
  return { column };
}

/** Body: `{ columns: ["Invoice No"] }` or `{ columnMapping: { columns: [...] } }` or `{ headers: [...] }`. */
function normalizeColumnMappingBody(body = {}) {
  const source = isPlainObject(body?.columnMapping) ? body.columnMapping : body;

  let rawColumns =
    source?.columns ?? source?.columnNames ?? source?.headers ?? body?.headers;
  if (rawColumns == null && Array.isArray(body)) {
    rawColumns = body;
  }
  if (!Array.isArray(rawColumns)) return { columns: [] };

  const columns = rawColumns
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return { columns: [...new Set(columns)] };
}

/** Body: `{ column: "Description" }` or `{ manualMatchDescription: { column: "..." } }`. */
function normalizeManualMatchDescriptionBody(body = {}) {
  if (typeof body === "string") {
    const column = body.trim();
    return column ? { column } : {};
  }

  if (
    isPlainObject(body?.manualMatchDescription) &&
    !Array.isArray(body.manualMatchDescription)
  ) {
    const column = String(body.manualMatchDescription.column ?? "").trim();
    return column ? { column } : {};
  }

  if (typeof body?.manualMatchDescription === "string") {
    const column = body.manualMatchDescription.trim();
    return column ? { column } : {};
  }

  const column = String(body?.column ?? "").trim();
  if (!column) return {};
  return { column };
}

function sanitizeHeaderMapping(doc) {
  if (!doc) {
    return null;
  }

  return {
    id: doc._id.toString(),
    companyId: doc.companyId?.toString?.() || String(doc.companyId),
    rounding: doc.rounding && typeof doc.rounding === "object" ? doc.rounding : {},
    sales: doc.sales && typeof doc.sales === "object" ? doc.sales : {},
    pdf: doc.pdf && typeof doc.pdf === "object" ? doc.pdf : {},
    jvProcess:
      doc.jvProcess && typeof doc.jvProcess === "object" ? doc.jvProcess : {},
    filterDate:
      doc.filterDate && typeof doc.filterDate === "object" ? doc.filterDate : {},
    salesUniqeColumn:
      doc.salesUniqeColumn && typeof doc.salesUniqeColumn === "object"
        ? doc.salesUniqeColumn
        : { columns: [] },
    financialYear:
      doc.financialYear && typeof doc.financialYear === "object" ? doc.financialYear : {},
    manualMatchDescription:
      doc.manualMatchDescription && typeof doc.manualMatchDescription === "object"
        ? doc.manualMatchDescription
        : {},
    columnMapping:
      doc.columnMapping && typeof doc.columnMapping === "object"
        ? doc.columnMapping
        : { columns: [] },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  HeaderMapping,
  normalizeMappingBody,
  normalizeJvProcessBody,
  normalizeFilterDateBody,
  normalizeFinancialYearBody,
  normalizeManualMatchDescriptionBody,
  normalizeSalesUniqeColumnBody,
  normalizeColumnMappingBody,
  sanitizeHeaderMapping,
};
