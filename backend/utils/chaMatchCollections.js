const mongoose = require("mongoose");

const chaMatchProcessSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    batchId: { type: String, required: true, index: true },
    sbMonthAndYear: { type: String, default: "", trim: true, index: true },
    chaRowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChaData",
      required: true,
      index: true,
    },
    salesRowId: { type: String, required: true, index: true },
    invNo: { type: String, default: "", trim: true, index: true },
    matchType: {
      type: String,
      enum: ["unique_inv", "duplicate_inv_sb"],
      required: true,
    },
    matchedAt: { type: Date, default: () => new Date() },
  },
  { collection: "chamatchprocess", timestamps: true }
);

chaMatchProcessSchema.index({ companyId: 1, chaRowId: 1, salesRowId: 1 }, { unique: true });

const chaDropRowsSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    batchId: { type: String, required: true, index: true },
    sbMonthAndYear: { type: String, default: "", trim: true },
    invNo: { type: String, default: "", trim: true, index: true },
    chaRowIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "ChaData" }],
    reason: { type: String, default: "multiple_sb_match_in_group" },
  },
  { collection: "chadroprows", timestamps: true }
);

const chaPendingRowsSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    batchId: { type: String, required: true, index: true },
    sbMonthAndYear: { type: String, default: "", trim: true },
    chaRowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChaData",
      required: true,
      index: true,
    },
    invNo: { type: String, default: "", trim: true },
    reason: {
      type: String,
      enum: ["no_sales_inv_match", "no_pdf_sb_match_in_duplicate_group", "unresolved_duplicate_group"],
      required: true,
    },
  },
  { collection: "chapendingrows", timestamps: true }
);

chaPendingRowsSchema.index({ companyId: 1, batchId: 1, chaRowId: 1 }, { unique: true });

const ChaMatchProcess =
  mongoose.models.ChaMatchProcess ||
  mongoose.model("ChaMatchProcess", chaMatchProcessSchema);

const ChaDropRows =
  mongoose.models.ChaDropRows || mongoose.model("ChaDropRows", chaDropRowsSchema);

const ChaPendingRows =
  mongoose.models.ChaPendingRows ||
  mongoose.model("ChaPendingRows", chaPendingRowsSchema);

/**
 * CHA row ids already in chamatchprocess or chadroprows (skip on next merge run).
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @param {string} [sbMonthAndYear] - when set, only ids from that month; omit for company-wide
 * @returns {Promise<Set<string>>}
 */
async function getAlreadyProcessedChaRowIds(companyId, sbMonthAndYear) {
  const matchFilter = { companyId };
  const dropFilter = { companyId };
  if (sbMonthAndYear) {
    matchFilter.sbMonthAndYear = sbMonthAndYear;
    dropFilter.sbMonthAndYear = sbMonthAndYear;
  }

  const [matchedIds, dropDocs] = await Promise.all([
    ChaMatchProcess.distinct("chaRowId", matchFilter),
    ChaDropRows.find(dropFilter, { chaRowIds: 1 }).lean(),
  ]);

  const set = new Set(matchedIds.map((id) => String(id)));
  for (const doc of dropDocs) {
    for (const id of doc.chaRowIds || []) {
      set.add(String(id));
    }
  }
  return set;
}

module.exports = {
  ChaMatchProcess,
  ChaDropRows,
  ChaPendingRows,
  getAlreadyProcessedChaRowIds,
};
