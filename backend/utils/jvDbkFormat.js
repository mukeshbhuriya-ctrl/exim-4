const mongoose = require("mongoose");

const jvDbkFormatSchema = new mongoose.Schema(
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
    collection: "jvdbkformat",
    timestamps: true,
  }
);

const JvDbkFormat =
  mongoose.models.JvDbkFormat || mongoose.model("JvDbkFormat", jvDbkFormatSchema);

module.exports = { JvDbkFormat };
