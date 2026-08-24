"use strict";

const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { parseEbrcXlsBuffer } = require("#utils/ebrcBulkDownloadData");

const ebrcStoredAttachmentSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    attachId: { type: String, required: true, trim: true, index: true },
    fromDate: { type: String, default: "", trim: true, index: true },
    toDate: { type: String, default: "", trim: true, index: true },
    fileName: { type: String, default: "", trim: true },
    rowCount: { type: Number, default: 0, min: 0 },
    rows: { type: mongoose.Schema.Types.Mixed, default: [] },
    sessionFromCache: { type: Boolean, default: false },
    sessionRefreshed: { type: Boolean, default: false },
  },
  {
    collection: "ebrcstoredattachment",
    timestamps: true,
  }
);

ebrcStoredAttachmentSchema.index({ companyId: 1, attachId: 1, fromDate: 1, toDate: 1 });

const EbrcStoredAttachment =
  mongoose.models.EbrcStoredAttachment ||
  mongoose.model("EbrcStoredAttachment", ebrcStoredAttachmentSchema);

function serializeStoredAttachment(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    attachId: doc.attachId || "",
    fromDate: doc.fromDate || "",
    toDate: doc.toDate || "",
    fileName: doc.fileName || "",
    rowCount: typeof doc.rowCount === "number" ? doc.rowCount : 0,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

async function listStoredAttachments(companyId, options = {}) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = { companyId: companyOid };
  const [docs, total] = await Promise.all([
    EbrcStoredAttachment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select({
        attachId: 1,
        fromDate: 1,
        toDate: 1,
        fileName: 1,
        rowCount: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .lean(),
    EbrcStoredAttachment.countDocuments(filter),
  ]);

  return {
    page,
    limit,
    total,
    count: docs.length,
    rows: docs.map(serializeStoredAttachment),
  };
}

async function getStoredAttachmentById(companyId, id) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  let oid;
  try {
    oid = new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
  return EbrcStoredAttachment.findOne({ _id: oid, companyId: companyOid }).lean();
}

async function saveStoredAttachment(companyId, payload = {}) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const attachId = String(payload.attachId ?? "").trim();
  if (!attachId) {
    throw new Error("attachId is required.");
  }

  const fromDate = String(payload.fromDate ?? "").trim();
  const toDate = String(payload.toDate ?? "").trim();
  const fileName = String(payload.fileName ?? "").trim() || "EBRC BULK DOWNLOAD.xls";
  const buffer = payload.buffer;
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("Attachment buffer is required.");
  }

  const { rows } = parseEbrcXlsBuffer(buffer);
  const rowList = Array.isArray(rows) ? rows : [];

  const doc = await EbrcStoredAttachment.create({
    companyId: companyOid,
    attachId,
    fromDate,
    toDate,
    fileName,
    rowCount: rowList.length,
    rows: rowList,
    sessionFromCache: payload.sessionFromCache === true,
    sessionRefreshed: payload.sessionRefreshed === true,
  });

  return {
    ...serializeStoredAttachment(doc.toObject()),
    sessionFromCache: doc.sessionFromCache === true,
    sessionRefreshed: doc.sessionRefreshed === true,
  };
}

function buildStoredAttachmentExcelBuffer(doc) {
  const rows = Array.isArray(doc?.rows) ? doc.rows : [];
  const ws = rows.length
    ? xlsx.utils.json_to_sheet(rows, { origin: "A1" })
    : xlsx.utils.aoa_to_sheet([[]]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "eBRC");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}

function buildStoredAttachmentFileName(doc) {
  const base = String(doc?.fileName || "ebrc-stored")
    .replace(/\.xls$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim();
  const attachId = String(doc?.attachId || "").trim();
  const stamp = doc?.createdAt
    ? new Date(doc.createdAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return `${base || "ebrc"}-${attachId || "attachment"}-${stamp}.xlsx`;
}

module.exports = {
  EbrcStoredAttachment,
  listStoredAttachments,
  getStoredAttachmentById,
  saveStoredAttachment,
  buildStoredAttachmentExcelBuffer,
  buildStoredAttachmentFileName,
  serializeStoredAttachment,
};
