const mongoose = require("mongoose");

const dgftProcessSchema = new mongoose.Schema(
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
    /** Ref to canonical `shippingbillno` row (Port + SB No + SB Date from PDF upload). */
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
      outputDir: { type: String, default: "" },
      pdfDir: { type: String, default: "" },
      resultJsonPath: { type: String, default: "" },
    },
  },
  {
    collection: "dgftprocess",
    timestamps: true,
  }
);

dgftProcessSchema.index({ companyId: 1, dayKey: 1 });
dgftProcessSchema.index({ companyId: 1, batchId: 1, inputIndex: 1 }, { unique: true });

const DgftProcess =
  mongoose.models.DgftProcess || mongoose.model("DgftProcess", dgftProcessSchema);

module.exports = {
  DgftProcess,
};
