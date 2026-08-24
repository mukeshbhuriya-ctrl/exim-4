const mongoose = require("mongoose");

/**
 * POST /process DGFT run history (sibling to `dgftprocess` used by /process-random-ten).
 * Collection: dgftbatch
 */
const dgftBatchSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    dayKey: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    batchId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    inputIndex: { type: Number, required: true },
    shippingBillNo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShippingBillNo",
      default: null,
      index: true,
    },
    input: {
      port: { type: String, default: "" },
      sbNumber: { type: String, default: "" },
      sbDate: { type: String, default: "" },
      shippingBillNoId: { type: String, default: "" },
    },
    status: {
      type: String,
      required: true,
      enum: ["success", "no_data", "error"],
      index: true,
    },
    errorMessage: { type: String, default: "" },
    scrapedData: { type: mongoose.Schema.Types.Mixed, default: null },
    output: {
      s3Bucket: { type: String, default: "" },
      s3PdfKeyPrefix: { type: String, default: "" },
      outputDir: { type: String, default: "" },
      pdfDir: { type: String, default: "" },
      resultJsonPath: { type: String, default: "" },
    },
  },
  {
    collection: "dgftbatch",
    timestamps: true,
  }
);

dgftBatchSchema.index({ companyId: 1, dayKey: 1 });
dgftBatchSchema.index({ companyId: 1, batchId: 1, inputIndex: 1 }, { unique: true });

const DgftBatch = mongoose.models.DgftBatch || mongoose.model("DgftBatch", dgftBatchSchema);

module.exports = { DgftBatch };
