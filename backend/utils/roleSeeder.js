const { Company } = require("./company");
const { Role } = require("./role");
const { IAM_POLICIES } = require("./iamPolicies");

const SEED_ROLES = [
  {
    businessName: "Admin",
    identifier: "ADMIN",
    description: "Full system access for Company Administrators",
    isSystemRole: true,
    policies: IAM_POLICIES.ADMIN
  },
  {
    businessName: "Operator",
    identifier: "OPERATOR",
    description: "Standard data entry and process operator access",
    isSystemRole: true,
    policies: IAM_POLICIES.OPERATOR
  },
  {
    businessName: "Viewer",
    identifier: "VIEWER",
    description: "Read-only access across the system",
    isSystemRole: true,
    policies: IAM_POLICIES.VIEWER
  }
];

async function seedSystemRolesForCompany(companyId) {
  let seededCount = 0;
  for (const roleDef of SEED_ROLES) {
    const result = await Role.updateOne(
      { companyId, identifier: roleDef.identifier },
      { $setOnInsert: { ...roleDef, companyId } },
      { upsert: true }
    );
    if (result.upsertedCount > 0) seededCount++;
  }
  return seededCount;
}

async function seedSystemRoles() {
  try {
    const companies = await Company.find({}).lean();
    let seededCount = 0;
    
    for (const company of companies) {
      seededCount += await seedSystemRolesForCompany(company._id);
    }
    
    if (seededCount > 0) {
      console.log(`Seeded ${seededCount} missing system roles for existing companies.`);
    }
  } catch (error) {
    console.error("Error seeding roles:", error);
  }
}

module.exports = { seedSystemRoles, seedSystemRolesForCompany, SEED_ROLES };
