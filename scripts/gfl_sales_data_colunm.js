/**
 * Trim excess whitespace from a specific column in salesuploadrows.
 *
 * Targets:
 *   companyId  (positional arg 1, default below)
 *   data["FI-Doc Type"]  — trims leading/trailing whitespace; skips null/missing values.
 *
 * Dry-run (default) prints total matching count + samples without writing.
 *
 * Usage (from repo root):
 *   node scripts/gfl_sales_data_colunm.js
 *   node scripts/gfl_sales_data_colunm.js --execute
 *   node scripts/gfl_sales_data_colunm.js <companyId>
 *   node scripts/gfl_sales_data_colunm.js <companyId> --execute
 */

const path = require("path");
const Module = require("module");

const backendRoot = path.resolve(__dirname, "..", "backend");
Module.globalPaths.unshift(path.join(backendRoot, "node_modules"));
module.paths.unshift(path.join(backendRoot, "node_modules"));

const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(backendRoot, ".env"), quiet: true });

const DEFAULT_COMPANY_ID = "6a1d5566c7b893074737a1d9";
const COLUMN_KEY = "FI-Doc Type";
const COLLECTION_NAME = "salesuploadrows";
const SAMPLE_LIMIT = 5;
const CHUNK_SIZE = 500;

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const positional = argv.filter((a) => !a.startsWith("--"));
  return {
    execute,
    companyId: positional[0] || DEFAULT_COMPANY_ID,
  };
}

function getMongoUri() {
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.DB_URI ||
    process.env.DATABASE_URL;
  if (!uri) throw new Error("No MongoDB URI found in environment variables.");
  return uri;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const { execute, companyId } = parseArgs(process.argv.slice(2));

  console.log("=".repeat(60));
  console.log(`Mode     : ${execute ? "EXECUTE" : "DRY RUN"}`);
  console.log(`CompanyId: ${companyId}`);
  console.log(`Column   : data["${COLUMN_KEY}"]`);
  console.log("=".repeat(60));

  const uri = getMongoUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log("Connected to MongoDB.\n");

  const col = mongoose.connection.collection(COLLECTION_NAME);
  const oid = new mongoose.Types.ObjectId(companyId);
  const fieldPath = `data.${COLUMN_KEY}`;

  // Find rows where the column exists, is a string, and has leading/trailing whitespace
  const filter = {
    companyId: oid,
    [fieldPath]: {
      $type: "string",
      $regex: /^\s|\s$/,
    },
  };

  const docs = await col
    .find(filter, { projection: { _id: 1, [fieldPath]: 1 } })
    .toArray();

  console.log(`Rows with whitespace in "${COLUMN_KEY}": ${docs.length}`);

  if (docs.length === 0) {
    console.log("Nothing to update.");
    await mongoose.disconnect();
    return;
  }

  // Show samples
  const samples = docs.slice(0, SAMPLE_LIMIT);
  console.log(`\nSample (up to ${SAMPLE_LIMIT}):`);
  for (const doc of samples) {
    const raw = doc.data?.[COLUMN_KEY] ?? doc[fieldPath];
    console.log(`  _id=${doc._id}  raw="${raw}"  trimmed="${String(raw).trim()}"`);
  }

  if (!execute) {
    console.log("\nDry-run complete. Pass --execute to apply changes.");
    await mongoose.disconnect();
    return;
  }

  // Update in chunks using bulkWrite
  const chunks = chunk(docs, CHUNK_SIZE);
  let updated = 0;

  for (const batch of chunks) {
    const ops = batch.map((doc) => {
      // Re-read the raw value stored in the projected result
      const raw =
        doc.data?.[COLUMN_KEY] !== undefined
          ? doc.data[COLUMN_KEY]
          : null;
      const trimmed = raw != null ? String(raw).trim() : raw;
      return {
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { [fieldPath]: trimmed } },
        },
      };
    });

    const result = await col.bulkWrite(ops, { ordered: false });
    updated += result.modifiedCount;
    process.stdout.write(`  Updated ${updated}/${docs.length}...\r`);
  }

  console.log(`\nDone. Updated ${updated} rows.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
