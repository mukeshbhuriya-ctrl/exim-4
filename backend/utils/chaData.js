const mongoose = require("mongoose");
const { tryInsertUniqueShippingBill } = require("#utils/shippingBillNo");
const { reconcileStoredPendingEbrcRows } = require("#utils/ebrcBulkDownloadData");

const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * @param {Date} [refDate]
 * @returns {string} e.g. "MAY-2026"
 */
function getCurrentSbMonthAndYear(refDate = new Date()) {
  const d = refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? refDate : new Date();
  return `${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * @param {string} [raw] - e.g. "MAY-2026", "may-2026"
 * @returns {string|null}
 */
function normalizeSbMonthAndYear(raw) {
  const text = String(raw || "").trim().toUpperCase();
  if (!text) return null;
  const m = /^([A-Z]{3})-(\d{4})$/.exec(text);
  if (!m || !MONTH_ABBR.includes(m[1])) {
    return null;
  }
  return `${m[1]}-${m[2]}`;
}

const chaDataRowSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    fetchdate: {
      type: Date,
      required: true,
      index: true,
    },
    sectionIndex: { type: Number, default: 0 },
    icegateId: { type: String, default: "", trim: true },
    gstin: { type: String, default: "", trim: true, index: true },
    sbMonthAndYear: { type: String, default: "", trim: true },
    roleId: { type: Number, default: null },
    gstnId: { type: String, default: "", trim: true },
    docType: { type: String, default: "", trim: true },
    siteId: { type: String, default: "", trim: true },
    sbNo: { type: String, default: "", trim: true, index: true },
    sbDt: { type: String, default: "", trim: true },
    chaNo: { type: String, default: "", trim: true },
    iec: { type: String, default: "", trim: true },
    expName: { type: String, default: "", trim: true },
    invNo: { type: String, default: "", trim: true },
    invDt: { type: String, default: "", trim: true },
    taxValue: { type: String, default: "", trim: true },
    igstAmtPaid: { type: String, default: "", trim: true },
    egmNo: { type: String, default: "", trim: true },
    egmDt: { type: String, default: "", trim: true },
  },
  {
    collection: "chadata",
    timestamps: true,
  }
);

chaDataRowSchema.index({ companyId: 1, fetchdate: -1 });
chaDataRowSchema.index({ companyId: 1, gstin: 1, sbNo: 1, sbDt: 1 });
chaDataRowSchema.index({ companyId: 1, invNo: 1, sbNo: 1 });

const ChaData =
  mongoose.models.ChaData || mongoose.model("ChaData", chaDataRowSchema);

function chaInvSbDedupeKey(invNo, sbNo) {
  const inv = String(invNo ?? "").trim();
  const sb = String(sbNo ?? "").trim();
  if (!inv || !sb) return "";
  return `${inv}||${sb}`;
}

async function loadExistingChaInvSbKeys(companyId, docs) {
  const oid = new mongoose.Types.ObjectId(String(companyId));
  const want = new Set();
  for (const doc of docs) {
    const key = chaInvSbDedupeKey(doc.invNo, doc.sbNo);
    if (key) want.add(key);
  }
  if (!want.size) return new Set();

  const invNos = [
    ...new Set(
      docs
        .map((d) => String(d.invNo ?? "").trim())
        .filter(Boolean)
    ),
  ];
  if (!invNos.length) return new Set();

  const existing = await ChaData.find(
    { companyId: oid, invNo: { $in: invNos } },
    { invNo: 1, sbNo: 1 }
  ).lean();

  const found = new Set();
  for (const row of existing) {
    const key = chaInvSbDedupeKey(row.invNo, row.sbNo);
    if (key && want.has(key)) found.add(key);
  }
  return found;
}

function filterUniqueChaDocsForInsert(docs, existingKeys) {
  const seenInBatch = new Set();
  const toInsert = [];
  let skipped = 0;

  for (const doc of docs) {
    const key = chaInvSbDedupeKey(doc.invNo, doc.sbNo);
    if (!key) {
      toInsert.push(doc);
      continue;
    }
    if (existingKeys.has(key) || seenInBatch.has(key)) {
      skipped += 1;
      continue;
    }
    seenInBatch.add(key);
    toInsert.push(doc);
  }

  return { toInsert, skipped };
}

/**
 * Flatten gstEnquiry.results[].response[] into chadata documents.
 *
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @param {object} gstEnquiry - output of fetchGstinEnquiryForAllGstins
 * @param {object} [options]
 * @param {Date} [options.fetchdate]
 * @param {number} [options.sectionIndex]
 * @returns {Promise<{ saved: number, fetchdate: Date }>}
 */
async function saveGstEnquiryResultsToChaData(companyId, gstEnquiry, options = {}) {
  const fetchdate =
    options.fetchdate instanceof Date && !Number.isNaN(options.fetchdate.getTime())
      ? options.fetchdate
      : new Date();

  const sectionIndex = Number.isFinite(Number(options.sectionIndex))
    ? Number(options.sectionIndex)
    : 0;

  const docs = [];
  const results = Array.isArray(gstEnquiry?.results) ? gstEnquiry.results : [];

  for (const result of results) {
    if (!result?.success || !Array.isArray(result.response)) {
      continue;
    }

    const gstin = String(result.gstin || "").trim();
    for (const row of result.response) {
      if (!row || typeof row !== "object") {
        continue;
      }

      docs.push({
        companyId,
        fetchdate,
        sectionIndex,
        icegateId: String(gstEnquiry.icegateId || row.iec || "").trim(),
        gstin: String(row.gstnId || gstin || "").trim(),
        sbMonthAndYear: String(gstEnquiry.sbMonthAndYear || "").trim(),
        roleId: gstEnquiry.roleId ?? null,
        gstnId: String(row.gstnId || "").trim(),
        docType: String(row.docType || "").trim(),
        siteId: String(row.siteId || "").trim(),
        sbNo: String(row.sbNo || "").trim(),
        sbDt: String(row.sbDt || "").trim(),
        chaNo: String(row.chaNo || "").trim(),
        iec: String(row.iec || "").trim(),
        expName: String(row.expName || "").trim(),
        invNo: String(row.invNo || "").trim(),
        invDt: String(row.invDt || "").trim(),
        taxValue: String(row.taxValue ?? "").trim(),
        igstAmtPaid: String(row.igstAmtPaid ?? "").trim(),
        egmNo: String(row.egmNo ?? "").trim(),
        egmDt: String(row.egmDt ?? "").trim(),
      });
    }
  }

  if (!docs.length) {
    return { saved: 0, skipped: 0, fetchdate };
  }

  const existingKeys = await loadExistingChaInvSbKeys(companyId, docs);
  const { toInsert, skipped } = filterUniqueChaDocsForInsert(docs, existingKeys);

  if (!toInsert.length) {
    return { saved: 0, skipped, fetchdate };
  }

  const inserted = await ChaData.insertMany(toInsert, { ordered: true });

  // Also register unique Shipping Bill identities (Port Code + SB No + SB Date)
  // derived from CHA enquiry results: { siteId -> portCode, sbNo, sbDt -> sbDate }.
  const uniqueShippingBills = new Map();
  for (const d of toInsert) {
    const portCode = String(d.siteId ?? "").trim();
    const sbNo = String(d.sbNo ?? "").trim();
    const sbDate = String(d.sbDt ?? "").trim();
    if (!portCode || !sbNo || !sbDate) continue;
    const k = `${portCode}||${sbNo}||${sbDate}`;
    if (!uniqueShippingBills.has(k)) {
      uniqueShippingBills.set(k, { portCode, sbNo, sbDate });
    }
  }

  const shippingBillsToProcess = [...uniqueShippingBills.values()];
  const shippingInsertResults = await Promise.allSettled(
    shippingBillsToProcess.map((b) =>
      tryInsertUniqueShippingBill(companyId, b, { source: "cha" })
    )
  );

  const shippingBillNoInserted = shippingInsertResults.reduce((acc, r) => {
    if (r.status !== "fulfilled") return acc;
    if (r.value?.inserted) acc.inserted += 1;
    if (r.value?.skipped) acc.skipped += 1;
    return acc;
  }, { inserted: 0, skipped: 0 });

  const shippingBillNoErrors = shippingInsertResults
    .filter((r) => r.status === "rejected")
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

  await reconcileStoredPendingEbrcRows(companyId, shippingBillsToProcess);

  return {
    saved: inserted.length,
    skipped,
    fetchdate,
    shippingBillNo: {
      uniqueShippingBills: shippingBillsToProcess.length,
      inserted: shippingBillNoInserted.inserted,
      skipped: shippingBillNoInserted.skipped,
      errors: shippingBillNoErrors,
    },
  };
}

/**
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @param {object} [filters]
 * @param {boolean} [filters.allMonths] - when true, ignore month (optional `sbMonthAndYear` still narrows)
 * @param {string} [filters.sbMonthAndYear] - defaults to current month unless `allMonths` is true
 * @param {string} [filters.gstin]
 * @returns {Promise<object[]>}
 */
async function listChaDataForCompany(companyId, filters = {}) {
  const query = { companyId };

  const monthFilter = normalizeSbMonthAndYear(filters.sbMonthAndYear);
  if (monthFilter) {
    query.sbMonthAndYear = monthFilter;
  } else if (filters.allMonths !== true) {
    query.sbMonthAndYear = getCurrentSbMonthAndYear();
  }

  const gstin = String(filters.gstin || "").trim();
  if (gstin) {
    query.gstin = gstin;
  }

  return ChaData.find(query).sort({ fetchdate: -1, sbNo: 1, invNo: 1 }).lean();
}

module.exports = {
  ChaData,
  getCurrentSbMonthAndYear,
  normalizeSbMonthAndYear,
  saveGstEnquiryResultsToChaData,
  listChaDataForCompany,
};
