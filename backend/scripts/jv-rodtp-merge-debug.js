/**
 * CLI: print JV RODTP sales↔PDF merge counts and unmatched sales sample (read-only).
 *
 * Usage:
 *   node scripts/jv-rodtp-merge-debug.js <companyIdMongoHexOr24Char>
 *
 * Requires .env with same Mongo URI as the API (see server / siteadmin connect).
 */

require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { connectDatabase } = require("#utils/siteadmin");
const { debugJvRodtpMerge } = require("#controllers/company/admin/jv/rodtpMergeDebug");

async function main() {
  const rawId = process.argv[2];
  if (!rawId) {
    console.error("Usage: node scripts/jv-rodtp-merge-debug.js <companyId>");
    process.exit(1);
  }

  let companyId;
  try {
    companyId = new mongoose.Types.ObjectId(String(rawId).trim());
  } catch {
    console.error("Invalid companyId (expected 24-char hex ObjectId).");
    process.exit(1);
  }

  await connectDatabase();
  const report = await debugJvRodtpMerge(companyId, { limitUnmatched: 80, samplePdfKeys: 40 });
  console.log(JSON.stringify(report, null, 2));
  await mongoose.connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
