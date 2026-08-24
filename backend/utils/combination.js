const mongoose = require("mongoose");

const combinationSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
    },
    salesCombination: {
      type: [String],
      default: () => [],
    },
    pdfCombination: {
      type: [String],
      default: () => [],
    },
  },
  {
    collection: "combination",
    timestamps: true,
  }
);

const Combination =
  mongoose.models.Combination ||
  mongoose.model("Combination", combinationSchema);

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeCombinationBody(body = {}) {
  return {
    salesCombination: normalizeStringArray(body.salesCombination),
    pdfCombination: normalizeStringArray(body.pdfCombination),
  };
}

function sanitizeCombination(doc) {
  if (!doc) {
    return null;
  }

  return {
    id: doc._id.toString(),
    companyId: doc.companyId?.toString?.() || String(doc.companyId),
    salesCombination: Array.isArray(doc.salesCombination)
      ? doc.salesCombination
      : [],
    pdfCombination: Array.isArray(doc.pdfCombination) ? doc.pdfCombination : [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  Combination,
  normalizeCombinationBody,
  sanitizeCombination,
};
