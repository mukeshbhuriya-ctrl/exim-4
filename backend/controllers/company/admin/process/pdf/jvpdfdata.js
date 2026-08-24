const mongoose = require("mongoose");

// Keep these as top-level constants so future column changes are easy.
const GROUP_BY_COLUMN = "INV_2";
const SUM_DBK_COLUMN = "DBK_7.DBK AMT";
const SUM_DBK_COLUMN_ALT = "dbk.7.DBK AMT";
const SUM_RDT_COLUMN = "RDT_6. VALUE";
const SUM_RDT_COLUMN_ALT = "rodtep.6. VALUE";
const FALLBACK_GROUP_COLUMNS = [
  "INV_2.INVOICENO",
  "inv.2.INVOICENO",
  "Invoice Number",
  "invoiceNumber",
  "ODN",
  "INV_1.SNO",
];

/** Invoice-only fields for JV sales↔PDF merge (excludes ODN / line SNO). */
const JV_MERGE_INV_FIELDS = [
  "inv",
  "INV_2",
  "inv_2",
  "INV",
  GROUP_BY_COLUMN,
  "INV_2.INVOICENO",
  "inv.2.INVOICENO",
  "Invoice Number",
  "invoiceNumber",
];

const jvPdfDataSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    inv: { type: String, required: true },
    inv_2: { type: String },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    source: {
      pdfOriginalName: { type: String, default: "" },
    },
  },
  {
    collection: "jvpdfdata",
    timestamps: true,
  }
);

jvPdfDataSchema.index({ companyId: 1, inv: 1 }, { unique: true });

const JvPdfData =
  mongoose.models.JvPdfData || mongoose.model("JvPdfData", jvPdfDataSchema);

let jvPdfIndexSyncPromise = null;

function isDuplicateKeyError(err) {
  return Number(err?.code) === 11000 || err?.name === "MongoServerError" && /duplicate key/i.test(String(err?.message || ""));
}

/**
 * Drop legacy `inv_2` unique index and backfill `inv` from `inv_2` on old rows.
 */
async function ensureJvPdfDataIndexes() {
  if (!jvPdfIndexSyncPromise) {
    jvPdfIndexSyncPromise = (async () => {
      const collection = JvPdfData.collection;

      const legacyDocs = await JvPdfData.find({
        $or: [{ inv: { $exists: false } }, { inv: null }, { inv: "" }],
      })
        .select({ _id: 1, inv_2: 1, data: 1 })
        .lean();

      for (const doc of legacyDocs) {
        const inv = normalizePdfInv(
          getJvPdfDocInv(doc) || pickJvMergeInvValue(doc?.data) || pickGroupValue(doc?.data)
        );
        if (!inv) continue;
        await JvPdfData.updateOne({ _id: doc._id }, { $set: { inv } });
      }

      const indexes = await collection.indexes();
      for (const idx of indexes) {
        const keys = idx?.key && typeof idx.key === "object" ? idx.key : {};
        if (Object.prototype.hasOwnProperty.call(keys, "inv_2") && idx.name !== "_id_") {
          try {
            await collection.dropIndex(idx.name);
          } catch (err) {
            if (!/not found|ns not found/i.test(String(err?.message || ""))) {
              throw err;
            }
          }
        }
      }

      await JvPdfData.syncIndexes();
    })().catch((err) => {
      jvPdfIndexSyncPromise = null;
      throw err;
    });
  }

  return jvPdfIndexSyncPromise;
}

async function insertJvPdfDocs(docs) {
  if (!docs.length) return [];

  try {
    return await JvPdfData.insertMany(docs, { ordered: false });
  } catch (err) {
    if (err?.name === "MongoBulkWriteError" || (isDuplicateKeyError(err) && Array.isArray(err?.writeErrors))) {
      const inserted = Array.isArray(err?.insertedDocs) ? err.insertedDocs : [];
      const duplicateCount = err?.writeErrors?.filter((e) => isDuplicateKeyError(e))?.length ?? 0;
      if (inserted.length || duplicateCount) {
        return inserted;
      }
    }
    if (isDuplicateKeyError(err)) {
      return [];
    }
    throw err;
  }
}

function safeText(value) {
  return String(value ?? "").trim();
}

/** Canonical invoice key for dedupe / matching (aligns with JV merge). */
function normalizePdfInv(value) {
  let s = safeText(value);
  if (/^\d+$/.test(s)) {
    s = s.replace(/^0+/, "") || "0";
  }
  return s;
}

function getJvPdfDocInv(doc) {
  return safeText(doc?.inv || doc?.inv_2 || pickJvMergeInvValue(doc?.data));
}

function pickGroupValue(src) {
  const row = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  const direct = safeText(row[GROUP_BY_COLUMN] ?? row.inv ?? row.INV_2);
  if (direct) return direct;
  for (const key of FALLBACK_GROUP_COLUMNS) {
    const value = safeText(row[key]);
    if (value) return value;
  }
  return "";
}

/** Invoice fields only — used for JV merge indexing (not ODN / INV_1.SNO). */
function pickJvMergeInvValue(src) {
  const row = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  for (const key of JV_MERGE_INV_FIELDS) {
    const value = safeText(row[key]);
    if (value) return value;
  }
  return "";
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function amountFromRow(src, keys) {
  const row = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  for (const k of keys) {
    if (!k || !Object.prototype.hasOwnProperty.call(row, k)) continue;
    return toNumber(row[k]);
  }
  return 0;
}

/**
 * Groups raw PDF rows by invoice and builds one aggregated row per inv.
 *
 * Output row shape:
 * - inv / INV_2
 * - total_dbk_amt
 * - total_rdt_value
 * - SB No, SB Date, Port Code
 */
function buildJvPdfGroupedRows(pdfRows = []) {
  const rows = Array.isArray(pdfRows) ? pdfRows : [];
  const grouped = new Map();
  let missingGroupKeyRows = 0;

  for (const row of rows) {
    const src = row && typeof row === "object" && !Array.isArray(row) ? row : {};
    const invRaw = pickGroupValue(src);
    if (!invRaw) {
      missingGroupKeyRows += 1;
      continue;
    }
    const invKey = normalizePdfInv(invRaw) || invRaw;

    const prev = grouped.get(invKey) || {
      inv: invRaw,
      INV_2: invRaw,
      total_dbk_amt: 0,
      total_rdt_value: 0,
      "SB No": safeText(src["SB No"]),
      "SB Date": safeText(src["SB Date"]),
      "Port Code": safeText(src["Port Code"]),
    };

    prev.total_dbk_amt += amountFromRow(src, [SUM_DBK_COLUMN, SUM_DBK_COLUMN_ALT]);
    prev.total_rdt_value += amountFromRow(src, [SUM_RDT_COLUMN, SUM_RDT_COLUMN_ALT]);

    if (!prev["SB No"]) prev["SB No"] = safeText(src["SB No"]);
    if (!prev["SB Date"]) prev["SB Date"] = safeText(src["SB Date"]);
    if (!prev["Port Code"]) prev["Port Code"] = safeText(src["Port Code"]);

    grouped.set(invKey, prev);
  }

  return {
    groupedRows: [...grouped.values()],
    missingGroupKeyRows,
  };
}

async function loadExistingJvPdfInvSet(companyId, invList) {
  const normalizedWanted = new Set(
    invList.map((inv) => normalizePdfInv(inv)).filter(Boolean)
  );
  if (!normalizedWanted.size) {
    return new Set();
  }

  const existingDocs = await JvPdfData.find({ companyId }, { inv: 1, inv_2: 1 }).lean();
  const existingSet = new Set();
  for (const doc of existingDocs) {
    const key = normalizePdfInv(getJvPdfDocInv(doc));
    if (key) existingSet.add(key);
  }
  return existingSet;
}

function rowInvKey(row) {
  return normalizePdfInv(safeText(row?.inv || row?.INV_2 || pickGroupValue(row)));
}

/**
 * Save grouped JV PDF rows to `jvpdfdata` (unique per company + inv).
 * Returns only rows that were newly inserted.
 */
async function processAndSaveJvPdfRows({
  companyId,
  pdfRows,
  sourceFileName = "",
}) {
  const { groupedRows, missingGroupKeyRows } = buildJvPdfGroupedRows(pdfRows);

  const seenInv = new Set();
  const uniqueRows = [];
  let skippedDuplicateInInput = 0;
  for (const row of groupedRows) {
    const inv = safeText(row?.inv || row?.INV_2);
    if (!inv) continue;
    const key = normalizePdfInv(inv);
    if (!key || seenInv.has(key)) {
      skippedDuplicateInInput += 1;
      continue;
    }
    seenInv.add(key);
    uniqueRows.push({ ...row, inv, INV_2: inv });
  }

  const existingSet = await loadExistingJvPdfInvSet(
    companyId,
    uniqueRows.map((r) => r.inv)
  );

  const finalRows = uniqueRows.filter((row) => !existingSet.has(rowInvKey(row)));
  const skippedExistingInCollection = uniqueRows.length - finalRows.length;

  const docs = finalRows.map((row) => ({
    companyId,
    inv: normalizePdfInv(safeText(row.inv)) || safeText(row.inv),
    data: row,
    source: {
      pdfOriginalName: String(sourceFileName || ""),
    },
  }));

  await ensureJvPdfDataIndexes();

  const inserted = await insertJvPdfDocs(docs);
  const insertedKeys = new Set(
    inserted.map((doc) => normalizePdfInv(getJvPdfDocInv(doc))).filter(Boolean)
  );
  const savedRows = finalRows.filter((row) => insertedKeys.has(rowInvKey(row)));
  const newInvKeys = savedRows.map((row) => rowInvKey(row));

  return {
    grouped_rows: groupedRows.length,
    skipped_missing_group_key: missingGroupKeyRows,
    skipped_duplicate_in_input: skippedDuplicateInInput,
    skipped_existing_in_collection:
      skippedExistingInCollection + (finalRows.length - savedRows.length),
    saved_rows: inserted.length,
    rows: savedRows,
    newInvKeys,
  };
}

/** Filter raw PDF line items to invoices that were newly saved in jvpdfdata. */
function filterPdfRowsForNewInvoices(pdfRows, newInvKeys) {
  const allowed = new Set((newInvKeys || []).map((k) => normalizePdfInv(k)).filter(Boolean));
  if (!allowed.size) return [];

  return (pdfRows || []).filter((row) => allowed.has(rowInvKey(row)));
}

module.exports = {
  JvPdfData,
  GROUP_BY_COLUMN,
  FALLBACK_GROUP_COLUMNS,
  JV_MERGE_INV_FIELDS,
  SUM_DBK_COLUMN,
  SUM_RDT_COLUMN,
  buildJvPdfGroupedRows,
  processAndSaveJvPdfRows,
  pickGroupValue,
  pickJvMergeInvValue,
  normalizePdfInv,
  getJvPdfDocInv,
  rowInvKey,
  filterPdfRowsForNewInvoices,
  ensureJvPdfDataIndexes,
};
