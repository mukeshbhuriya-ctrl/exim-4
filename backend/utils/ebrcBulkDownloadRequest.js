const mongoose = require("mongoose");

const REQUEST_STATUS = Object.freeze({
  PENDING: "pending",
  SUCCESSFUL: "successful",
  FAILED: "failed",
});

const ebrcBulkDownloadRequestSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    fromDate: {
      type: String,
      required: true,
      trim: true,
    },
    toDate: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(REQUEST_STATUS),
      default: REQUEST_STATUS.PENDING,
    },
    searchType: { type: String, default: "1" },
    attachId: { type: String, default: null },
    errorMessage: { type: String, default: null },
    persistSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    submittedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  {
    collection: "ebrcBulkDownloadRequest",
    timestamps: true,
  }
);

ebrcBulkDownloadRequestSchema.index(
  { companyId: 1, fromDate: 1, toDate: 1 },
  { unique: true }
);

const EbrcBulkDownloadRequest =
  mongoose.models.EbrcBulkDownloadRequest ||
  mongoose.model("EbrcBulkDownloadRequest", ebrcBulkDownloadRequestSchema);

function normalizeDgftDisplayDate(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function getLastWeekMondayToSunday(referenceDate = new Date()) {
  const d = new Date(referenceDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;

  const thisWeekMonday = new Date(d);
  thisWeekMonday.setDate(d.getDate() - daysSinceMonday);

  const lastWeekMonday = new Date(thisWeekMonday);
  lastWeekMonday.setDate(thisWeekMonday.getDate() - 7);

  const lastWeekSunday = new Date(lastWeekMonday);
  lastWeekSunday.setDate(lastWeekMonday.getDate() + 6);

  return { fromDate: lastWeekMonday, toDate: lastWeekSunday };
}

function getYesterdayDateRange(referenceDate = new Date()) {
  const yesterday = new Date(referenceDate);
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  return { fromDate: yesterday, toDate: yesterday };
}

function formatDdMmYyyy(date) {
  const d = date instanceof Date ? date : new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function isMonday(referenceDate = new Date()) {
  return new Date(referenceDate).getDay() === 1;
}

async function listPendingRequests(companyId) {
  const oid = new mongoose.Types.ObjectId(String(companyId));
  return EbrcBulkDownloadRequest.find({
    companyId: oid,
    status: REQUEST_STATUS.PENDING,
  })
    .sort({ submittedAt: 1 })
    .lean();
}

async function createPendingRequest(companyId, { fromDate, toDate, searchType = "1" }) {
  const oid = new mongoose.Types.ObjectId(String(companyId));
  const from = normalizeDgftDisplayDate(fromDate);
  const to = normalizeDgftDisplayDate(toDate);

  const doc = await EbrcBulkDownloadRequest.findOneAndUpdate(
    { companyId: oid, fromDate: from, toDate: to },
    {
      $setOnInsert: {
        companyId: oid,
        fromDate: from,
        toDate: to,
        searchType: String(searchType || "1"),
        submittedAt: new Date(),
      },
      $set: {
        status: REQUEST_STATUS.PENDING,
        attachId: null,
        errorMessage: null,
        persistSummary: null,
        completedAt: null,
      },
    },
    { upsert: true, new: true }
  );

  return doc;
}

async function markRequestSuccessful(requestId, attachId, persistSummary = null) {
  await EbrcBulkDownloadRequest.updateOne(
    { _id: requestId },
    {
      $set: {
        status: REQUEST_STATUS.SUCCESSFUL,
        attachId: String(attachId || "").trim() || null,
        persistSummary,
        errorMessage: null,
        completedAt: new Date(),
      },
    }
  );
}

async function markRequestFailed(requestId, attachId, errorMessage) {
  await EbrcBulkDownloadRequest.updateOne(
    { _id: requestId },
    {
      $set: {
        status: REQUEST_STATUS.FAILED,
        attachId: String(attachId || "").trim() || null,
        errorMessage: String(errorMessage || "Download failed."),
        completedAt: new Date(),
      },
    }
  );
}

function findDgftRowForRequest(pendingDoc, dgftRows = []) {
  const from = normalizeDgftDisplayDate(pendingDoc.fromDate);
  const to = normalizeDgftDisplayDate(pendingDoc.toDate);

  return (
    dgftRows.find(
      (row) =>
        normalizeDgftDisplayDate(row.fromDate) === from &&
        normalizeDgftDisplayDate(row.toDate) === to
    ) || null
  );
}

/**
 * For each pending request: match DGFT table row by date range; if attachId exists,
 * download attachment (caller), persist data, mark successful.
 */
async function processPendingEbrcDownloadRequests(companyId, dgftRows, downloadAttachmentFn) {
  const pendingDocs = await listPendingRequests(companyId);
  const details = [];
  let successful = 0;
  let failed = 0;
  let stillPending = 0;

  for (const doc of pendingDocs) {
    const row = findDgftRowForRequest(doc, dgftRows);

    if (!row) {
      stillPending += 1;
      details.push({
        requestId: String(doc._id),
        fromDate: doc.fromDate,
        toDate: doc.toDate,
        status: REQUEST_STATUS.PENDING,
        reason: "no_matching_dgft_row",
      });
      continue;
    }

    const attachId = row.attachId ? String(row.attachId).trim() : "";
    if (!attachId) {
      stillPending += 1;
      details.push({
        requestId: String(doc._id),
        fromDate: doc.fromDate,
        toDate: doc.toDate,
        status: REQUEST_STATUS.PENDING,
        reason: "no_attach_id_yet",
        dgftStatus: row.status || null,
      });
      continue;
    }

    const downloadResult = await downloadAttachmentFn(companyId, {
      attachId,
      fromDate: doc.fromDate,
      toDate: doc.toDate,
    });

    if (downloadResult.success) {
      await markRequestSuccessful(doc._id, attachId, downloadResult.summary ?? null);
      successful += 1;
      details.push({
        requestId: String(doc._id),
        fromDate: doc.fromDate,
        toDate: doc.toDate,
        status: REQUEST_STATUS.SUCCESSFUL,
        attachId,
        summary: downloadResult.summary ?? null,
      });
    } else {
      await markRequestFailed(doc._id, attachId, downloadResult.message);
      failed += 1;
      details.push({
        requestId: String(doc._id),
        fromDate: doc.fromDate,
        toDate: doc.toDate,
        status: REQUEST_STATUS.FAILED,
        attachId,
        error: downloadResult.message,
      });
    }
  }

  return {
    pendingCount: pendingDocs.length,
    successful,
    failed,
    stillPending,
    details,
  };
}

module.exports = {
  REQUEST_STATUS,
  EbrcBulkDownloadRequest,
  normalizeDgftDisplayDate,
  getLastWeekMondayToSunday,
  getYesterdayDateRange,
  formatDdMmYyyy,
  isMonday,
  listPendingRequests,
  createPendingRequest,
  markRequestSuccessful,
  markRequestFailed,
  processPendingEbrcDownloadRequests,
};
