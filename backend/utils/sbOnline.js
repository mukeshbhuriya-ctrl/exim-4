const mongoose = require("mongoose");

/**
 * Online shipping-bill scrape result per run (replaces `shippingbillprocess` → collection `sbonline`).
 * Links to canonical `shippingbillno` row when the SB triple was registered from PDF upload.
 */
const sbOnlineSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    /** Calendar day (UTC) when this batch was run — YYYY-MM-DD; use as `id` for detail API */
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
    /** Ref to `shippingbillno` document (Port Code + SB No + SB Date) */
    shippingBillNo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShippingBillNo",
      default: null,
      index: true,
    },
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
    inputIndex: { type: Number, default: null },
  },
  {
    collection: "sbonline",
    timestamps: true,
  }
);

sbOnlineSchema.index({ companyId: 1, dayKey: 1 });
sbOnlineSchema.index({ companyId: 1, status: 1 });
sbOnlineSchema.index({ companyId: 1, shippingBillNo: 1 });

const SbOnline = mongoose.models.SbOnline || mongoose.model("SbOnline", sbOnlineSchema);

function makeShippingBillKey(sbNo, sbDate, sbLocation) {
  return [
    String(sbNo ?? "").trim(),
    String(sbDate ?? "").trim(),
    String(sbLocation ?? "").trim(),
  ].join("|");
}

module.exports = {
  SbOnline,
  makeShippingBillKey,
};
