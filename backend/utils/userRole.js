const mongoose = require("mongoose");

const userRoleSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  roleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role", required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  isActive: { type: Boolean, default: true }
}, { collection: "user_role", timestamps: true });

// A user can only have one active role per company at a time
userRoleSchema.index({ companyId: 1, userId: 1 }, { unique: true });

const UserRole = mongoose.models.UserRole || mongoose.model("UserRole", userRoleSchema);

module.exports = { UserRole };
