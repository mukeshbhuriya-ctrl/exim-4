const mongoose = require("mongoose");

const COLUMN_TYPES = new Set(["number", "date", "word"]);
const REMOVE_DIGIT_SIDES = new Set(["first", "last"]);

const salesDataCleanColumnSchema = new mongoose.Schema(
  {
    columnName: { type: String, required: true, trim: true },
    colIndex: { type: Number, default: 0 },
    type: { type: String, enum: ["number", "date", "word"], required: true },
    removeDigits: {
      enabled: { type: Boolean, default: false },
      side: { type: String, enum: ["first", "last"], default: "first" },
      count: { type: Number, default: null },
    },
    requireNotNull: { type: Boolean, default: false },
    /** When true, this column is treated as a summable numeric amount. */
    sum: { type: Boolean, default: false },
  },
  { _id: false }
);

const salesDataCleanSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
      index: true,
    },
    columns: {
      type: [salesDataCleanColumnSchema],
      default: [],
    },
  },
  {
    collection: "salesdataclean",
    timestamps: true,
  }
);

const SalesDataClean =
  mongoose.models.SalesDataClean ||
  mongoose.model("SalesDataClean", salesDataCleanSchema);

function toText(value) {
  return String(value ?? "").trim();
}

function normalizeRemoveDigits(raw = {}) {
  const enabled = Boolean(raw.enabled ?? raw.removeDigitsEnabled ?? false);
  const sideRaw = toText(raw.side ?? raw.removeDigitsSide ?? "first").toLowerCase();
  const side = REMOVE_DIGIT_SIDES.has(sideRaw) ? sideRaw : "first";
  const countRaw = raw.count ?? raw.removeDigitsCount;
  const countNum = Number(countRaw);
  const count =
    enabled && Number.isFinite(countNum) && countNum > 0 ? Math.floor(countNum) : null;

  return { enabled, side, count };
}

function normalizeColumnInput(item, index = 0) {
  if (!item || typeof item !== "object") return null;

  const columnName = toText(
    item.columnName ?? item.column_name ?? item.header ?? item.name ?? ""
  );
  if (!columnName) return null;

  const typeRaw = toText(item.type).toLowerCase();
  const type = COLUMN_TYPES.has(typeRaw) ? typeRaw : "word";

  const colIndexRaw = item.colIndex ?? item.col_index ?? index;
  const colIndex = Number.isFinite(Number(colIndexRaw)) ? Number(colIndexRaw) : index;

  const removeDigits = normalizeRemoveDigits(
    item.removeDigits && typeof item.removeDigits === "object"
      ? item.removeDigits
      : item
  );

  const requireNotNull = Boolean(
    item.requireNotNull ?? item.require_not_null ?? item.notNull ?? item.not_null ?? false
  );

  const sum = Boolean(item.sum ?? item.SUM ?? item.isSum ?? item.is_sum ?? false);

  return {
    columnName,
    colIndex,
    type,
    removeDigits,
    requireNotNull,
    sum,
  };
}

function normalizeColumnsInput(body) {
  const raw =
    body?.columns ??
    body?.columnRules ??
    body?.cleaningColumns ??
    body?.rows ??
    (Array.isArray(body) ? body : []);

  if (!Array.isArray(raw)) {
    return [];
  }

  const columns = [];
  for (let i = 0; i < raw.length; i += 1) {
    const normalized = normalizeColumnInput(raw[i], i);
    if (normalized) columns.push(normalized);
  }
  return columns;
}

function sanitizeSalesDataClean(doc) {
  if (!doc) {
    return { columns: [] };
  }

  const columns = Array.isArray(doc.columns)
    ? doc.columns.map((col) => ({
        columnName: toText(col.columnName),
        colIndex: Number(col.colIndex) || 0,
        type: COLUMN_TYPES.has(col.type) ? col.type : "word",
        removeDigits: normalizeRemoveDigits(col.removeDigits || {}),
        requireNotNull: Boolean(col.requireNotNull),
        sum: Boolean(col.sum),
      }))
    : [];

  return {
    id: doc._id ? String(doc._id) : undefined,
    companyId: doc.companyId ? String(doc.companyId) : undefined,
    columns,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  SalesDataClean,
  COLUMN_TYPES,
  normalizeColumnsInput,
  sanitizeSalesDataClean,
};
