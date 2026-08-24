/**
 * Reset JV sales process flags on jvsalesdata so DBK / RODTP can run again.
 *
 * Sets:
 *   data.jv_droback = "pending"
 *   data.jv_rodtep  = "pending"
 *
 * Usage:
 *   node scripts/jv.js <companyId>           # dry-run (default)
 *   node scripts/jv.js <companyId> --execute # apply changes
 *   node scripts/jv.js --all --execute       # all companies
 */

require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const { connectDatabase } = require("#utils/siteadmin");
const { Company } = require("#utils/company");
const { JvSalesData } = require("#controllers/company/admin/process/sales/jvsalesdata");

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const all = argv.includes("--all");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const companyId = all ? null : positional[0] || null;
  return { execute, all, companyId };
}

async function resetJvFlagsForCompany(companyId, { execute = false } = {}) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const filter = { companyId: companyOid };

  const total = await JvSalesData.countDocuments(filter);
  const alreadyPending = await JvSalesData.countDocuments({
    ...filter,
    "data.jv_droback": "pending",
    "data.jv_rodtep": "pending",
  });
  const needsUpdate = total - alreadyPending;

  const report = {
    companyId: String(companyId),
    totalRows: total,
    alreadyPending,
    rowsToUpdate: needsUpdate,
    applied: false,
    modifiedCount: 0,
  };

  if (!total) return report;

  if (execute && needsUpdate > 0) {
    const res = await JvSalesData.updateMany(filter, {
      $set: {
        "data.jv_droback": "pending",
        "data.jv_rodtep": "pending",
      },
    });
    report.modifiedCount = res.modifiedCount || 0;
    report.matchedCount = res.matchedCount || 0;
    report.applied = true;
  }

  return report;
}

async function main() {
  const { execute, all, companyId } = parseArgs(process.argv.slice(2));

  if (!all && !companyId) {
    console.error("Usage:");
    console.error("  node scripts/jv.js <companyId> [--execute]");
    console.error("  node scripts/jv.js --all [--execute]");
    process.exit(1);
  }

  if (!all && !mongoose.isValidObjectId(companyId)) {
    console.error("Invalid companyId (expected 24-char hex ObjectId).");
    process.exit(1);
  }

  console.log("Connecting to database...");
  await connectDatabase();
  console.log("Database connected.");
  console.log(
    execute
      ? "EXECUTE mode — jv_droback / jv_rodtep will be set to pending."
      : "DRY-RUN mode — no changes will be written."
  );

  const companies = all
    ? (await Company.find({}).select({ _id: 1, name: 1 }).lean()).map((c) => ({
        id: String(c._id),
        name: c.name || String(c._id),
      }))
    : [{ id: String(companyId), name: String(companyId) }];

  const results = [];
  for (const company of companies) {
    console.log(`\nProcessing company: ${company.name}`);
    const report = await resetJvFlagsForCompany(company.id, { execute });
    results.push({ companyName: company.name, ...report });
    console.log(
      `Done [${company.name}] total=${report.totalRows}, alreadyPending=${report.alreadyPending}, toUpdate=${report.rowsToUpdate}, modified=${report.modifiedCount}`
    );
  }

  console.log("\n" + JSON.stringify({ execute, results }, null, 2));
  await mongoose.disconnect();
  console.log("Finished.");
}

main().catch(async (err) => {
  console.error("Script failed:", err instanceof Error ? err.message : err);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exit(1);
});
