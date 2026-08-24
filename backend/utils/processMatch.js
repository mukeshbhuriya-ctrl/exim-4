const mongoose = require("mongoose");

const PROCESS_MATCH_RECORD_TYPES = {
  MATCHED: "matched",
};

/** Paired sales+pdf rows only — excludes legacy snapshot rows in old data. */
const MATCHED_PROCESS_MATCH_FILTER = {
  salesRowId: { $nin: [null, ""] },
  pdfRowId: { $nin: [null, ""] },
  $or: [
    { recordType: PROCESS_MATCH_RECORD_TYPES.MATCHED },
    { recordType: { $exists: false } },
    { recordType: null },
  ],
};

const processMatchSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    batchId: {
      type: String,
      required: true,
      index: true,
    },
    matchedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
      index: true,
    },
    recordType: {
      type: String,
      default: PROCESS_MATCH_RECORD_TYPES.MATCHED,
      index: true,
    },
    /** Whether this match was created by automation or manual pairing. */
    matchType: {
      type: String,
      default: "auto",
      trim: true,
      index: true,
    },
    seq: {
      type: Number,
      default: 0,
    },
    salesCombination: {
      type: String,
      default: "",
      trim: true,
    },
    pdfCombination: {
      type: String,
      default: "",
      trim: true,
    },
    matchValue: {
      type: String,
      default: "",
      trim: true,
    },
    matchDuplicate: {
      type: Boolean,
      default: false,
      index: true,
    },
    salesRowId: {
      type: String,
      default: null,
      index: true,
    },
    pdfRowId: {
      type: String,
      default: null,
      index: true,
    },
    totalSalesRowCount: {
      type: Number,
      default: null,
      min: 0,
    },
    totalPdfRowCount: {
      type: Number,
      default: null,
      min: 0,
    },
    alreadyMatchedSalesCount: {
      type: Number,
      default: null,
      min: 0,
    },
    alreadyMatchedPdfCount: {
      type: Number,
      default: null,
      min: 0,
    },
    unmatchedSalesBeforeCount: {
      type: Number,
      default: null,
      min: 0,
    },
    unmatchedPdfBeforeCount: {
      type: Number,
      default: null,
      min: 0,
    },
    salesRemainingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    pdfRemainingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    unmatchedInvoicesFoundInPdfCount: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  {
    collection: "processmatch",
    timestamps: true,
  }
);

const ProcessMatch =
  mongoose.models.ProcessMatch ||
  mongoose.model("ProcessMatch", processMatchSchema);

module.exports = {
  ProcessMatch,
  PROCESS_MATCH_RECORD_TYPES,
  MATCHED_PROCESS_MATCH_FILTER,
};
