const crypto = require("node:crypto");

const mongoose = require("mongoose");

const { normalizeEmail } = require("#utils/siteadmin");
const { hashCompanyUserPassword } = require("#utils/companyUserPassword");

function normalizeName(value) {
  const normalizedValue = String(value || "").trim();

  return normalizedValue || null;
}

function generateTemporaryPassword() {
  const token = crypto.randomBytes(9).toString("base64url");

  return `Adm@${token}1`;
}

const userSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
      default: "admin",
      enum: ["admin", "user"],
    },
    defaultPassword: {
      type: Boolean,
      default: true,
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
  },
  {
    collection: "user",
    timestamps: true,
  }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

function buildUserPayload(payload = {}) {
  const email = normalizeEmail(payload.email || payload.emailId);

  return {
    name: normalizeName(payload.name || payload.contactName),
    email,
  };
}

function createUserPayload({
  companyId,
  createdBy,
  name,
  email,
  temporaryPassword,
}) {
  return {
    companyId,
    createdBy,
    name: normalizeName(name),
    email: normalizeEmail(email),
    passwordHash: hashCompanyUserPassword(temporaryPassword),
    role: "admin",
    defaultPassword: true,
  };
}

function sanitizeUser(user) {
  return {
    id: user._id.toString(),
    companyId:
      user.companyId && typeof user.companyId === "object"
        ? user.companyId._id?.toString?.() || null
        : user.companyId?.toString?.() || user.companyId || null,
    name: user.name,
    email: user.email,
    role: user.role,
    defaultPassword: user.defaultPassword,
    isActive: user.isActive,
    createdBy:
      user.createdBy && typeof user.createdBy === "object"
        ? user.createdBy._id?.toString?.() || null
        : user.createdBy?.toString?.() || user.createdBy || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

module.exports = {
  User,
  buildUserPayload,
  createUserPayload,
  generateTemporaryPassword,
  normalizeName,
  sanitizeUser,
};
