const mongoose = require("mongoose");

const billingSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, default: "", trim: true },
    startDate: { type: String, required: true, trim: true, index: true },
    endDate: { type: String, required: true, trim: true, index: true },
    filterDateColumn: { type: String, default: "", trim: true },
    salesRowsInRange: { type: Number, default: 0 },
    uniqueInvoicesInRange: { type: Number, default: 0 },
    fullyMatchedInvoiceCount: { type: Number, default: 0 },
    sbNoCount: { type: Number, default: 0 },
    fullyMatched: { type: mongoose.Schema.Types.Mixed, default: [] },
    sbNos: { type: [String], default: [] },
    shippingBillMatched: { type: Number, default: 0 },
    shippingBillUpdated: { type: Number, default: 0 },
    shippingBillNotFound: { type: Number, default: 0 },
    /** Legacy fields (older billing UI). */
    feeNoteNo: { type: String, default: "", trim: true },
    perRowAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    dayKey: { type: String, default: "", trim: true, index: true },
    source: {
      rowsCount: { type: Number, default: 0 },
    },
    rows: { type: mongoose.Schema.Types.Mixed, default: [] },
  },
  {
    collection: "billing",
    timestamps: true,
  }
);

billingSchema.index({ companyId: 1, name: 1, startDate: 1, endDate: 1 });
billingSchema.index({ companyId: 1, dayKey: 1 });

const Billing = mongoose.models.Billing || mongoose.model("Billing", billingSchema);

module.exports = { Billing };
