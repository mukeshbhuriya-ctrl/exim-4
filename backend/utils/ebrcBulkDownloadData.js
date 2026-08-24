const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { ShippingBillNo } = require("#utils/shippingBillNo");

const pendingRowSchema = new mongoose.Schema(
  {
    portCode: { type: String, default: "", trim: true },
    sbNo: { type: String, default: "", trim: true },
    sbDate: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const ebrcBulkDownloadDataSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    attachId: { type: String, required: true, trim: true, index: true },
    fromDate: { type: String, default: "", trim: true },
    toDate: { type: String, default: "", trim: true },
    pendingRows: { type: [pendingRowSchema], default: [] },
    totalRows: { type: Number, default: 0 },
    matchedRows: { type: Number, default: 0 },
    pendingCount: { type: Number, default: 0 },
  },
  { collection: "ebrcbulkdownloaddata", timestamps: true }
);

ebrcBulkDownloadDataSchema.index({ companyId: 1, attachId: 1 }, { unique: true });

const EbrcBulkDownloadData =
  mongoose.models.EbrcBulkDownloadData ||
  mongoose.model("EbrcBulkDownloadData", ebrcBulkDownloadDataSchema);

const SB_NUMBER_HEADER_PATTERNS = [
  /^SB\s*NUMBER$/i,
  /^SB\s*NO\.?$/i,
  /^SBNUMBER$/i,
  /^S\.?B\.?\s*NO\.?$/i,
  /^SHIPPING\s*BILL\s*NO(?:\.|NUMBER)?$/i,
];
const SB_DATE_HEADER_PATTERNS = [
  /^SB\s*DATE$/i,
  /^S\.?B\.?\s*DATE$/i,
  /^SHIPPING\s*BILL\s*DATE$/i,
];
const PORT_CODE_HEADER_PATTERNS = [
  /^PORT\s*CODE$/i,
  /^PORTCODE$/i,
  /^PORT\s*LOCATION$/i,
];

function normalizeHeaderKey(key) {
  return String(key ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function findColumnKey(sampleRow, patterns) {
  if (!sampleRow || typeof sampleRow !== "object") return null;
  for (const key of Object.keys(sampleRow)) {
    const norm = normalizeHeaderKey(key);
    if (patterns.some((re) => re.test(norm))) {
      return key;
    }
  }
  return null;
}

function normalizeCellText(value) {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = String(value.getDate()).padStart(2, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${value.getFullYear()}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return String(value).trim();
}

function normalizePendingRow(row) {
  return {
    portCode: normalizeCellText(row?.portCode).toUpperCase(),
    sbNo: normalizeCellText(row?.sbNo),
    sbDate: normalizeCellText(row?.sbDate),
  };
}

function buildPendingRowKey(row) {
  const normalized = normalizePendingRow(row);
  return `${normalized.portCode}||${normalized.sbNo}||${normalized.sbDate}`;
}

function extractPendingRowsFromEbrcRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const sampleRow = rows.find((row) => row && typeof row === "object") || null;
  const sbNoKey = findColumnKey(sampleRow, SB_NUMBER_HEADER_PATTERNS);
  const sbDateKey = findColumnKey(sampleRow, SB_DATE_HEADER_PATTERNS);
  const portCodeKey = findColumnKey(sampleRow, PORT_CODE_HEADER_PATTERNS);

  if (!sbNoKey || !sbDateKey || !portCodeKey) return [];

  const seen = new Set();
  const extracted = [];
  for (const row of rows) {
    const pendingRow = normalizePendingRow({
      portCode: row?.[portCodeKey],
      sbNo: row?.[sbNoKey],
      sbDate: row?.[sbDateKey],
    });
    if (!pendingRow.portCode || !pendingRow.sbNo || !pendingRow.sbDate) continue;
    const key = buildPendingRowKey(pendingRow);
    if (seen.has(key)) continue;
    seen.add(key);
    extracted.push(pendingRow);
  }

  return extracted;
}

function parseEbrcXlsBuffer(buffer) {
  const wb = xlsx.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames?.[0] || "";
  if (!sheetName) {
    return { rows: [], pendingRows: [] };
  }

  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const pendingRows = extractPendingRowsFromEbrcRows(rows);

  return { rows, pendingRows };
}

async function loadShippingBillMap(companyId) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const shippingBills = await ShippingBillNo.find({ companyId: companyOid })
    .select({ _id: 1, portCode: 1, sbNo: 1, sbDate: 1 })
    .lean();

  const byKey = new Map();
  for (const doc of shippingBills) {
    byKey.set(buildPendingRowKey(doc), doc);
  }
  return byKey;
}

async function reconcilePendingRowsWithShippingBills(companyId, candidateRows) {
  const shippingBillMap = await loadShippingBillMap(companyId);
  const matchedIds = [];
  const pendingRows = [];

  for (const row of Array.isArray(candidateRows) ? candidateRows : []) {
    const key = buildPendingRowKey(row);
    const match = shippingBillMap.get(key);
    if (match?._id) {
      matchedIds.push(match._id);
    } else {
      pendingRows.push(normalizePendingRow(row));
    }
  }

  if (matchedIds.length) {
    await ShippingBillNo.updateMany(
      { _id: { $in: matchedIds } },
      { $set: { dgft: "true" } }
    );
  }

  return {
    matched: matchedIds.length,
    updated: matchedIds.length,
    notFound: pendingRows.length,
    pendingRows,
  };
}

function resolveEbrcDateRange(body = {}, query = {}) {
  const fromDate = String(
    body.fromDate ??
      body.irmFromDate ??
      body.from ??
      query.fromDate ??
      query.irmFromDate ??
      ""
  ).trim();
  const toDate = String(
    body.toDate ?? body.irmToDate ?? body.to ?? query.toDate ?? query.irmToDate ?? ""
  ).trim();
  return { fromDate, toDate };
}

/**
 * Parse XLS, set dgft=true for rows already present in shippingbillno,
 * and store only unmatched (portCode, sbNo, sbDate) rows as pending.
 */
async function persistEbrcBulkDownloadAndMatchSb(companyId, attachId, buffer, options = {}) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const attachIdStr = String(attachId ?? "").trim();
  const fromDate = String(options.fromDate ?? "").trim();
  const toDate = String(options.toDate ?? "").trim();

  const { pendingRows: extractedRows } = parseEbrcXlsBuffer(buffer);
  const matchSummary = await reconcilePendingRowsWithShippingBills(companyId, extractedRows);

  const doc = await EbrcBulkDownloadData.findOneAndUpdate(
    { companyId: companyOid, attachId: attachIdStr },
    {
      $set: {
        companyId: companyOid,
        attachId: attachIdStr,
        fromDate,
        toDate,
        pendingRows: matchSummary.pendingRows,
        totalRows: extractedRows.length,
        matchedRows: matchSummary.matched,
        pendingCount: matchSummary.pendingRows.length,
      },
      $unset: {
        fileName: "",
        rows: "",
        sbNumbers: "",
        excelData: "",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return {
    documentId: doc?._id,
    attachId: attachIdStr,
    fromDate,
    toDate,
    rowCount: extractedRows.length,
    pendingCount: matchSummary.pendingRows.length,
    matchSummary,
  };
}

async function reconcileStoredPendingEbrcRows(companyId, shippingBills = null) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const docs = await EbrcBulkDownloadData.find({
    companyId: companyOid,
    pendingRows: { $exists: true, $ne: [] },
  }).lean();

  if (!docs.length) {
    return { matched: 0, updated: 0, removed: 0, documentsCleared: 0 };
  }

  let shippingBillMap;
  if (Array.isArray(shippingBills) && shippingBills.length) {
    shippingBillMap = new Map();
    for (const bill of shippingBills) {
      const normalized = normalizePendingRow(bill);
      if (!normalized.portCode || !normalized.sbNo || !normalized.sbDate) continue;
      const doc = await ShippingBillNo.findOne({
        companyId: companyOid,
        portCode: normalized.portCode,
        sbNo: normalized.sbNo,
        sbDate: normalized.sbDate,
      })
        .select({ _id: 1, portCode: 1, sbNo: 1, sbDate: 1 })
        .lean();
      if (doc?._id) shippingBillMap.set(buildPendingRowKey(doc), doc);
    }
  } else {
    shippingBillMap = await loadShippingBillMap(companyId);
  }

  const matchedIds = [];
  let removed = 0;
  let documentsCleared = 0;

  for (const doc of docs) {
    const remainingRows = [];
    for (const row of doc.pendingRows || []) {
      const match = shippingBillMap.get(buildPendingRowKey(row));
      if (match?._id) {
        matchedIds.push(match._id);
        removed += 1;
      } else {
        remainingRows.push(normalizePendingRow(row));
      }
    }

    if (remainingRows.length) {
      await EbrcBulkDownloadData.updateOne(
        { _id: doc._id },
        {
          $set: {
            pendingRows: remainingRows,
            pendingCount: remainingRows.length,
          },
        }
      );
    } else {
      await EbrcBulkDownloadData.deleteOne({ _id: doc._id });
      documentsCleared += 1;
    }
  }

  const uniqueMatchedIds = [...new Set(matchedIds.map(String))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  if (uniqueMatchedIds.length) {
    await ShippingBillNo.updateMany(
      { _id: { $in: uniqueMatchedIds } },
      { $set: { dgft: "true" } }
    );
  }

  return {
    matched: uniqueMatchedIds.length,
    updated: uniqueMatchedIds.length,
    removed,
    documentsCleared,
  };
}

async function getEbrcBulkDownloadData(companyId, attachId) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  return EbrcBulkDownloadData.findOne({
    companyId: companyOid,
    attachId: String(attachId ?? "").trim(),
  }).lean();
}

module.exports = {
  EbrcBulkDownloadData,
  parseEbrcXlsBuffer,
  resolveEbrcDateRange,
  persistEbrcBulkDownloadAndMatchSb,
  reconcileStoredPendingEbrcRows,
  getEbrcBulkDownloadData,
};
