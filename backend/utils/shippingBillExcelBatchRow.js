const mongoose = require("mongoose");

/**
 * One document per Excel row / scrape result for batch uploads.
 * Not the same as sbonline (PDF-driven flow).
 * Collection: sbonlinebatch
 */
const shippingBillExcelBatchRowSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    /** UUID for this Excel upload; new upload = new id */
    uploadBatchId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    /** Same Date for every row from the same file upload */
    batchStartedAt: {
      type: Date,
      required: true,
      index: true,
    },
    /** 0-based index among parsed data rows (after header) */
    excelRowIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    /** 1-based row number in the spreadsheet (optional, for support) */
    sheetRowNumber: { type: Number, default: null },
    sbNo: { type: String, required: true, trim: true },
    sbDate: { type: String, required: true, trim: true },
    sbLocation: { type: String, required: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: ["success", "error", "skipped"],
      index: true,
    },
    errorMessage: { type: String, default: "" },
    scrapedData: { type: mongoose.Schema.Types.Mixed, default: null },
    sourceFileName: { type: String, default: "", trim: true },
  },
  {
    collection: "sbonlinebatch",
    timestamps: true,
  }
);

shippingBillExcelBatchRowSchema.index(
  { companyId: 1, uploadBatchId: 1, excelRowIndex: 1 },
  { unique: true }
);
shippingBillExcelBatchRowSchema.index({ companyId: 1, batchStartedAt: -1 });

const ShippingBillExcelBatchRow =
  mongoose.models.ShippingBillExcelBatchRow ||
  mongoose.model("ShippingBillExcelBatchRow", shippingBillExcelBatchRowSchema);

module.exports = { ShippingBillExcelBatchRow };
