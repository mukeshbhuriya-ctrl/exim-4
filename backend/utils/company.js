const mongoose = require("mongoose");

function normalizeText(value) {
  const normalizedValue = String(value || "").trim();

  return normalizedValue || null;
}

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SiteAdmin",
      required: true,
    },
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    collection: "company",
    timestamps: true,
  }
);

const Company = mongoose.models.Company || mongoose.model("Company", companySchema);

function normalizeCompanyPayload(payload = {}) {
  const name = normalizeText(payload.companyName || payload.name);

  return {
    name,
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
  };
}

function sanitizeCompany(company) {
  return {
    id: company._id.toString(),
    name: company.name,
    isActive: company.isActive,
    adminUserId:
      company.adminUserId && typeof company.adminUserId === "object"
        ? company.adminUserId._id?.toString?.() || null
        : company.adminUserId?.toString?.() || company.adminUserId || null,
    createdBy: company.createdBy?.toString?.() || company.createdBy || null,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
}

module.exports = {
  Company,
  normalizeCompanyPayload,
  sanitizeCompany,
};
