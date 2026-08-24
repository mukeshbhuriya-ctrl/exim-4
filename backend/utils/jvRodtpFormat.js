const mongoose = require("mongoose");

const jvRodtpFormatSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
      index: true,
    },
    postingAccounts: { type: mongoose.Schema.Types.Mixed, default: [] },
    headerMappings: { type: mongoose.Schema.Types.Mixed, default: [] },
    defaultFirstRow: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    collection: "jvrodtpformat",
    timestamps: true,
  }
);

const JvRodtpFormat =
  mongoose.models.JvRodtpFormat || mongoose.model("JvRodtpFormat", jvRodtpFormatSchema);

module.exports = { JvRodtpFormat };
