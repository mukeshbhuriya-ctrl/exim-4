const mongoose = require("mongoose");

const jvRodtpProcessSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    dayKey: { type: String, required: true, index: true, trim: true },
    rows: { type: mongoose.Schema.Types.Mixed, default: [] },
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
    collection: "jvrodtprocess",
    timestamps: true,
  }
);

jvRodtpProcessSchema.index({ companyId: 1, dayKey: 1 });
jvRodtpProcessSchema.index({ companyId: 1, dayKey: 1 }, { unique: true });

const JvRodtpProcess =
  mongoose.models.JvRodtpProcess || mongoose.model("JvRodtpProcess", jvRodtpProcessSchema);

module.exports = { JvRodtpProcess };
