const mongoose = require("mongoose");

/**
 * Deduplicated shipping bill identity per company (from PDF header: Port Code, SB No, SB Date).
 * Collection: shippingbillno
 */
const shippingBillNoSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    portCode: { type: String, default: "", trim: true },
    sbNo: { type: String, required: true, trim: true },
    sbDate: { type: String, default: "", trim: true },
    /** Where this SB was first registered: "pdf" | "cha" */
    source: { type: String, default: "", trim: true },
    /** PdfUploadRow.pdfRowId when source=pdf (empty for cha). */
    pdfRowId: { type: String, default: "", trim: true, index: true },
    billing: { type: String, default: "pending", trim: true },
    /** Ref to billing collection document when billing=completed. */
    billingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Billing",
      default: null,
      index: true,
    },
    dgft: { type: String, default: "pending", trim: true },
  },
  { collection: "shippingbillno", timestamps: true }
);

// Uniqueness is per company by SB No only.
shippingBillNoSchema.index({ companyId: 1, sbNo: 1 }, { unique: true });

const ShippingBillNo =
  mongoose.models.ShippingBillNo || mongoose.model("ShippingBillNo", shippingBillNoSchema);

/**
 * Inserts one row only if (companyId, sbNo) is not already present.
 * Uniqueness is by SB No only; portCode/sbDate/source/pdfRowId are stored for reference.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {object} headerLike - Port Code / SB No / SB Date (or camelCase) plus optional source
 * @param {{ source?: string, pdfRowId?: string }} [options]
 * @returns {{ inserted: boolean, skipped: boolean, reason?: string }}
 */
async function tryInsertUniqueShippingBill(companyId, headerLike, options = {}) {
  const portCode = String(headerLike?.["Port Code"] ?? headerLike?.portCode ?? "").trim();
  const sbNo = String(headerLike?.["SB No"] ?? headerLike?.sbNo ?? "").trim();
  const sbDate = String(headerLike?.["SB Date"] ?? headerLike?.sbDate ?? "").trim();
  const source = String(
    options?.source ?? headerLike?.source ?? ""
  )
    .trim()
    .toLowerCase();
  const pdfRowId = String(
    options?.pdfRowId ?? headerLike?.pdfRowId ?? ""
  ).trim();

  if (!sbNo) {
    return { inserted: false, skipped: true, reason: "missing_sb_no" };
  }

  const res = await ShippingBillNo.updateOne(
    { companyId, sbNo },
    {
      $setOnInsert: {
        companyId,
        portCode,
        sbNo,
        sbDate,
        source,
        pdfRowId,
        billing: "pending",
        dgft: "pending",
      },
    },
    { upsert: true }
  );

  if (res.upsertedCount > 0) {
    return { inserted: true, skipped: false };
  }
  return { inserted: false, skipped: true, reason: "already_exists" };
}

/**
 * Returns the `_id` of the matching `shippingbillno` row (by SB No), or `null`.
 */
async function findShippingBillNoId(companyId, { sbNo } = {}) {
  const sn = String(sbNo ?? "").trim();
  if (!sn) return null;
  const doc = await ShippingBillNo.findOne(
    { companyId, sbNo: sn },
    { _id: 1 }
  ).lean();
  return doc?._id || null;
}

function isDgftMarkedTrue(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function normalizeSbNoForMatch(sbNo) {
  const s = String(sbNo ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) {
    const stripped = s.replace(/^0+/, "");
    return stripped || "0";
  }
  return s.toUpperCase();
}

/**
 * For each SB number from eBRC Excel, find shippingbillno rows (by sbNo) and set dgft=true.
 */
async function markDgftTrueBySbNumbers(companyId, sbNumbers) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const rawTargets = (Array.isArray(sbNumbers) ? sbNumbers : [])
    .map((n) => String(n ?? "").trim())
    .filter(Boolean);

  const want = new Set(rawTargets.map(normalizeSbNoForMatch).filter(Boolean));
  if (!want.size) {
    return { matched: 0, updated: 0, notFound: 0, matchedSbNumbers: [] };
  }

  const all = await ShippingBillNo.find({ companyId: companyOid })
    .select({ _id: 1, sbNo: 1 })
    .lean();

  const idsToUpdate = [];
  const matchedSbNumbers = [];

  for (const doc of all) {
    const norm = normalizeSbNoForMatch(doc.sbNo);
    if (want.has(norm)) {
      idsToUpdate.push(doc._id);
      matchedSbNumbers.push(doc.sbNo);
    }
  }

  const matchedNorms = new Set(matchedSbNumbers.map(normalizeSbNoForMatch));
  const notFound = [...want].filter((n) => !matchedNorms.has(n)).length;

  if (!idsToUpdate.length) {
    return { matched: 0, updated: 0, notFound: want.size, matchedSbNumbers: [] };
  }

  const res = await ShippingBillNo.updateMany(
    { _id: { $in: idsToUpdate } },
    { $set: { dgft: "true" } }
  );

  return {
    matched: idsToUpdate.length,
    updated: res.modifiedCount,
    notFound,
    matchedSbNumbers: [...new Set(matchedSbNumbers)],
  };
}

/** Distinct registered SB rows for a company (same triple is unique in `shippingbillno`). */
async function listUniqueShippingBills(companyId) {
  const oid = new mongoose.Types.ObjectId(String(companyId));
  return ShippingBillNo.find({ companyId: oid })
    .select({
      _id: 1,
      portCode: 1,
      sbNo: 1,
      sbDate: 1,
      source: 1,
      pdfRowId: 1,
      billing: 1,
      billingId: 1,
      dgft: 1,
    })
    .lean();
}

module.exports = {
  ShippingBillNo,
  tryInsertUniqueShippingBill,
  findShippingBillNoId,
  isDgftMarkedTrue,
  normalizeSbNoForMatch,
  markDgftTrueBySbNumbers,
  listUniqueShippingBills,
};
