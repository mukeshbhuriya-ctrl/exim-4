const mongoose = require("mongoose");

const connectionItemSchema = new mongoose.Schema(
  {
    seq: {
      type: Number,
      required: true,
      min: 1,
    },
    salesCombination: {
      type: String,
      required: true,
      trim: true,
    },
    pdfCombination: {
      type: String,
      required: true,
      trim: true,
    },
    matchDuplicate: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const connectionSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
    },
    connections: {
      type: [connectionItemSchema],
      default: () => [],
    },
  },
  {
    collection: "connection",
    timestamps: true,
  }
);

const Connection =
  mongoose.models.Connection || mongoose.model("Connection", connectionSchema);

function normalizeConnectionItem(item = {}) {
  const seq = Number(item.seq);
  const salesCombination = String(item.salesCombination || "").trim();
  const pdfCombination = String(item.pdfCombination || "").trim();

  if (!Number.isFinite(seq) || seq < 1) {
    return null;
  }

  if (!salesCombination || !pdfCombination) {
    return null;
  }

  return {
    seq,
    salesCombination,
    pdfCombination,
    matchDuplicate: Boolean(item.matchDuplicate),
  };
}

function normalizeConnectionsBody(body = {}) {
  const rawConnections = Array.isArray(body.connections) ? body.connections : [];

  const connections = rawConnections
    .map((item) => normalizeConnectionItem(item))
    .filter(Boolean)
    .sort((a, b) => a.seq - b.seq);

  return { connections };
}

function sanitizeConnection(doc) {
  if (!doc) {
    return null;
  }

  return {
    id: doc._id.toString(),
    companyId: doc.companyId?.toString?.() || String(doc.companyId),
    connections: Array.isArray(doc.connections) ? doc.connections : [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  Connection,
  normalizeConnectionsBody,
  sanitizeConnection,
};
