/**
 * Delete sales upload rows for one company + Billing Date.
 *
 * Targets:
 *   companyId
 *   data["Billing Date"]
 *
 * Dry-run (default) prints the total matching count and does not delete.
 *
 * Usage (from repo root):
 *   node scripts/remove_sales_data_date_wise.js
 *   node scripts/remove_sales_data_date_wise.js --execute
 *   node scripts/remove_sales_data_date_wise.js <companyId> <billingDate>
 *   node scripts/remove_sales_data_date_wise.js <companyId> <billingDate> --execute
 */

const path = require("path");
const Module = require("module");

const backendRoot = path.resolve(__dirname, "..", "backend");
Module.globalPaths.unshift(path.join(backendRoot, "node_modules"));
module.paths.unshift(path.join(backendRoot, "node_modules"));

const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(backendRoot, ".env"), quiet: true });

const COMPANY_ID = "6a1d5566c7b893074737a1d9";
const BILLING_DATE = "2026-08-17";
const COLLECTION_NAME = "salesuploadrows";
const BILLING_DATE_KEY = "Billing Date";
const SAMPLE_LIMIT = 1;

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  return {
    execute,
    companyId: positional[0] || COMPANY_ID,
    billingDate: positional[1] || BILLING_DATE,
  };
}

function toIsoDateKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmyDash = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (dmyDash) return `${dmyDash[3]}-${dmyDash[2]}-${dmyDash[1]}`;

  const dmySlash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (dmySlash) {
    return `${dmySlash[3]}-${String(dmySlash[2]).padStart(2, "0")}-${String(dmySlash[1]).padStart(2, "0")}`;
  }

  const dmyDot = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
  if (dmyDot) {
    return `${dmyDot[3]}-${String(dmyDot[2]).padStart(2, "0")}-${String(dmyDot[1]).padStart(2, "0")}`;
  }

  return raw;
}

function dateVariants(isoDate) {
  const iso = toIsoDateKey(isoDate);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return [String(isoDate).trim()].filter(Boolean);

  const [, year, month, day] = match;
  const dayNum = String(Number(day));
  const monthNum = String(Number(month));

  return [
    ...new Set([
      `${year}-${month}-${day}`,
      `${day}-${month}-${year}`,
      `${day}/${month}/${year}`,
      `${dayNum}/${monthNum}/${year}`,
      `${day}.${month}.${year}`,
      `${dayNum}.${monthNum}.${year}`,
    ]),
  ];
}

function getMongoUri() {
  return String(
    process.env.MONGODB_URI_DIRECT ||
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      ""
  ).trim();
}

function buildFilter(companyId, billingDate) {
  const variants = dateVariants(billingDate);
  return {
    companyId: new mongoose.Types.ObjectId(String(companyId)),
    [`data.${BILLING_DATE_KEY}`]: variants.length === 1 ? variants[0] : { $in: variants },
  };
}

async function main() {
  const { execute, companyId, billingDate } = parseArgs(process.argv.slice(2));

  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    throw new Error(`Invalid companyId: ${companyId}`);
  }
  if (!String(billingDate || "").trim()) {
    throw new Error("Billing Date is required.");
  }

  const uri = getMongoUri();
  if (!uri) {
    throw new Error("MONGODB_URI is not set in backend/.env");
  }

  await mongoose.connect(uri);
  const col = mongoose.connection.db.collection(COLLECTION_NAME);
  const filter = buildFilter(companyId, billingDate);

  const totalCount = await col.countDocuments(filter);
  const samples = await col
    .find(filter, {
      projection: {
        rowId: 1,
        rowIndex: 1,
        uploadId: 1,
        "data.inv": 1,
        [`data.${BILLING_DATE_KEY}`]: 1,
      },
    })
    .limit(SAMPLE_LIMIT)
    .toArray();

  console.log(execute ? "MODE: execute (delete)" : "MODE: dry-run (no delete)");
  console.log(`companyId: ${companyId}`);
  console.log(`${BILLING_DATE_KEY}: ${billingDate}`);
  console.log(`matched date values: ${dateVariants(billingDate).join(", ")}`);
  console.log(`collection: ${COLLECTION_NAME}`);
  console.log(`total count: ${totalCount}`);

  if (samples.length) {
    console.log(`sample (${samples.length} of ${totalCount}):`);
    for (const row of samples) {
      console.log(
        JSON.stringify({
          _id: String(row._id),
          rowId: row.rowId || "",
          inv: row.data?.inv || "",
          billingDate: row.data?.[BILLING_DATE_KEY] || "",
        })
      );
    }
  }

  if (!execute) {
    console.log("Dry run complete. Re-run with --execute to delete these rows.");
    return;
  }

  if (!totalCount) {
    console.log("Nothing to delete.");
    return;
  }

  const result = await col.deleteMany(filter);
  console.log(`deleted: ${result.deletedCount}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  });
