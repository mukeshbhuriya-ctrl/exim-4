const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
  businessName: { type: String, required: true },
  identifier: { type: String, required: true, uppercase: true },
  description: { type: String },
  isSystemRole: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  policies: [{
    Effect: { type: String, enum: ["Allow", "Deny"], default: "Allow" },
    Action: [{ type: String }],
    Resource: [{ type: String }]
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { collection: "role", timestamps: true });

// Prevent duplicate identifiers per company
roleSchema.index({ companyId: 1, identifier: 1 }, { unique: true });

const Role = mongoose.models.Role || mongoose.model("Role", roleSchema);

module.exports = { Role };
