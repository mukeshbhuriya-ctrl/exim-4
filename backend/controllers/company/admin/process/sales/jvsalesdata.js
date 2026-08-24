const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { normalizePdfInv } = require("../pdf/jvpdfdata");

const jvProcessSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    inv: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    source: {
      salesOriginalName: { type: String, default: "" },
    },
  },
  {
    collection: "jvsalesdata",
    timestamps: true,
  }
);

jvProcessSchema.index({ companyId: 1, inv: 1 }, { unique: true });

const JvSalesData =
  mongoose.models.JvSalesData || mongoose.model("JvSalesData", jvProcessSchema);

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

function formatJvProcessDateParts(year, month, day) {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${d}.${m}.${y}`;
}

/** Excel serial / common strings → DD.MM.YYYY for jvsalesdata `date`. */
function normalizeJvProcessDateValue(value) {
  if (value === null || value === undefined || value === "") return value;

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = xlsx.SSF?.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return formatJvProcessDateParts(parsed.y, parsed.m, parsed.d);
    }
  }

  const text = String(value).trim();
  if (!text) return value;

  if (/^\d{4,6}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (Number.isFinite(serial)) {
      const parsed = xlsx.SSF?.parse_date_code(serial);
      if (parsed && parsed.y && parsed.m && parsed.d) {
        return formatJvProcessDateParts(parsed.y, parsed.m, parsed.d);
      }
    }
  }

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(text)) return text;

  const dmyDash = text.match(/^(\d{2})-(\d{2})-(\d{2,4})$/);
  if (dmyDash) {
    const y = dmyDash[3].length === 2 ? `20${dmyDash[3]}` : dmyDash[3];
    return `${dmyDash[1]}.${dmyDash[2]}.${y}`;
  }

  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return `${ymd[3]}.${ymd[2]}.${ymd[1]}`;

  const slash = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[1]}.${slash[2]}.${slash[3]}`;

  return value;
}

function isJvProcessDateDestKey(destKey) {
  return String(destKey ?? "").trim().toLowerCase() === "date";
}

function isEmptyJvDateValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && !String(value).trim()) return true;
  return false;
}

function buildMappedJvRow(rawRow, jvProcessMapping) {
  const out = {};
  for (const [destKey, sourceColumn] of Object.entries(jvProcessMapping || {})) {
    let val = getRowValueForSourceColumn(rawRow, sourceColumn);
    if (isJvProcessDateDestKey(destKey)) {
      val = normalizeJvProcessDateValue(val);
    }
    out[destKey] = val;
  }
  out.jv_droback = "pending";
  out.jv_rodtep = "pending";
  return out;
}

function normalizeInv(value) {
  return normalizePdfInv(value);
}

function getJvDateSourceColumn(jvProcessMapping) {
  const mapping =
    jvProcessMapping && typeof jvProcessMapping === "object" ? jvProcessMapping : {};
  const dateCol = mapping.date ?? mapping.Date ?? mapping.DATE ?? "";
  return String(dateCol || "").trim();
}

/**
 * Map sales rows → jvsalesdata and insert unique new invoices.
 * When `requireDate` is true, rows with empty mapped `date` are skipped.
 */
async function processAndSaveJvSalesRows({
  companyId,
  rawRows,
  jvProcessMapping,
  sourceFileName = "",
  requireDate = false,
}) {
  const sourceRows = Array.isArray(rawRows) ? rawRows : [];
  const mapping =
    jvProcessMapping && typeof jvProcessMapping === "object" ? jvProcessMapping : {};

  if (!Object.keys(mapping).length) {
    return {
      configured: false,
      message: "JV process header mapping is empty.",
      input_rows: sourceRows.length,
      mapped_rows: 0,
      skipped_duplicate_in_file: 0,
      skipped_existing_in_collection: 0,
      skipped_null_date: 0,
      saved_rows: 0,
      rows: [],
      /** Invs that have (or now have) a jvsalesdata document. */
      jvDataInvSet: new Set(),
    };
  }

  let skippedNullDate = 0;
  const mappedRows = [];
  for (const row of sourceRows) {
    const mapped = buildMappedJvRow(row, mapping);
    if (!normalizeInv(mapped.inv)) continue;
    if (requireDate && isEmptyJvDateValue(mapped.date)) {
      skippedNullDate += 1;
      continue;
    }
    mappedRows.push(mapped);
  }

  const seen = new Set();
  const uniqueRows = [];
  let skippedDuplicateInFile = 0;
  for (const row of mappedRows) {
    const inv = normalizeInv(row.inv);
    if (seen.has(inv)) {
      skippedDuplicateInFile += 1;
      continue;
    }
    seen.add(inv);
    uniqueRows.push({ ...row, inv });
  }

  const invList = uniqueRows.map((r) => r.inv);
  const existingDocs = invList.length
    ? await JvSalesData.find(
        {
          companyId,
          inv: { $in: invList },
        },
        { inv: 1 }
      ).lean()
    : [];
  const existingInvSet = new Set(existingDocs.map((d) => normalizeInv(d.inv)));

  const finalRows = uniqueRows.filter((r) => !existingInvSet.has(normalizeInv(r.inv)));
  const skippedExistingInCollection = uniqueRows.length - finalRows.length;

  const docs = finalRows.map((row) => ({
    companyId,
    inv: normalizeInv(row.inv),
    data: row,
    source: {
      salesOriginalName: String(sourceFileName || ""),
    },
  }));

  let inserted = [];
  if (docs.length) {
    inserted = await JvSalesData.insertMany(docs, { ordered: false });
  }

  const jvDataInvSet = new Set([
    ...existingInvSet,
    ...finalRows.map((r) => normalizeInv(r.inv)),
  ]);

  return {
    configured: true,
    message: "JV process rows handled.",
    input_rows: sourceRows.length,
    mapped_rows: mappedRows.length,
    skipped_duplicate_in_file: skippedDuplicateInFile,
    skipped_existing_in_collection: skippedExistingInCollection,
    skipped_null_date: skippedNullDate,
    saved_rows: inserted.length,
    rows: finalRows,
    jvDataInvSet,
  };
}

module.exports = {
  JvSalesData,
  processAndSaveJvSalesRows,
  getRowValueForSourceColumn,
  getJvDateSourceColumn,
  isEmptyJvDateValue,
  normalizeInv,
};

