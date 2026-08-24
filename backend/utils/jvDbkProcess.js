const mongoose = require("mongoose");

const jvDbkProcessSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    dayKey: { type: String, required: true, index: true, trim: true },
    /** All generated JV rows for this run/day in a single document. */
    rows: { type: mongoose.Schema.Types.Mixed, default: [] },
    /** Helpful trace for what source sales invoices were consumed. */
    matchedInvs: { type: mongoose.Schema.Types.Mixed, default: [] },
    summary: {
      mergedCount: { type: Number, default: 0 },
      generatedRowsCount: { type: Number, default: 0 },
      postingAccountsCount: { type: Number, default: 0 },
    },
    source: {
      postingAccounts: { type: mongoose.Schema.Types.Mixed, default: [] },
      headerRules: { type: mongoose.Schema.Types.Mixed, default: [] },
    },
    /** SAP document / reference number returned after SAP upload. */
    sapNo: { type: String, default: "", trim: true },
  },
  {
    collection: "jvdbkprocess",
    timestamps: true,
  }
);

jvDbkProcessSchema.index({ companyId: 1, dayKey: 1 });
jvDbkProcessSchema.index({ companyId: 1, dayKey: 1 }, { unique: true });

const JvDbkProcess =
  mongoose.models.JvDbkProcess || mongoose.model("JvDbkProcess", jvDbkProcessSchema);

module.exports = { JvDbkProcess };
