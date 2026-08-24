/**
 * Create jvpdfdata documents from existing pdfuploadrows for one company.
 *
 * Uses the same grouping/insert logic as PDF upload:
 *   processAndSaveJvPdfRows() in backend/controllers/company/admin/process/pdf/jvpdfdata.js
 *
 * Dry-run (default) prints counts and does not insert.
 *
 * Usage (from repo root):
 *   node scripts/jv_pdf_data_create_base_on_pdf_data.js
 *   node scripts/jv_pdf_data_create_base_on_pdf_data.js --execute
 *   node scripts/jv_pdf_data_create_base_on_pdf_data.js <companyId>
 *   node scripts/jv_pdf_data_create_base_on_pdf_data.js <companyId> --execute
 */

const path = require("path");
const Module = require("module");

const backendRoot = path.resolve(__dirname, "..", "backend");
Module.globalPaths.unshift(path.join(backendRoot, "node_modules"));
module.paths.unshift(path.join(backendRoot, "node_modules"));

const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(backendRoot, ".env"), quiet: true });

const {
  JvPdfData,
  buildJvPdfGroupedRows,
  processAndSaveJvPdfRows,
  normalizePdfInv,
  getJvPdfDocInv,
} = require(path.join(
  backendRoot,
  "controllers/company/admin/process/pdf/jvpdfdata.js"
));

const COMPANY_ID = "6a54bdaedad81ff2d5949197";
const PDF_COLLECTION = "pdfuploadrows";
const SAMPLE_LIMIT = 15;

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  return {
    execute,
    companyId: positional[0] || COMPANY_ID,
  };
}

function getMongoUri() {
  return String(
    process.env.MONGODB_URI_DIRECT ||
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      ""
  ).trim();
}

function safeText(value) {
  return String(value ?? "").trim();
}

async function loadExistingInvSet(companyId) {
  const docs = await JvPdfData.find({ companyId }, { inv: 1, inv_2: 1, data: 1 }).lean();
  const existing = new Set();
  for (const doc of docs) {
    const key = normalizePdfInv(getJvPdfDocInv(doc));
    if (key) existing.add(key);
  }
  return existing;
}

async function main() {
  const { execute, companyId } = parseArgs(process.argv.slice(2));
  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    throw new Error(`Invalid companyId: ${companyId}`);
  }

  const uri = getMongoUri();
  if (!uri) {
    throw new Error("MONGODB_URI is not set in backend/.env");
  }

  await mongoose.connect(uri);
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  const pdfCol = mongoose.connection.db.collection(PDF_COLLECTION);

  const pdfDocs = await pdfCol
    .find({ companyId: companyOid }, { projection: { data: 1, source: 1, pdfRowId: 1 } })
    .toArray();

  const pdfRows = pdfDocs
    .map((doc) => (doc?.data && typeof doc.data === "object" ? doc.data : null))
    .filter(Boolean);

  const { groupedRows, missingGroupKeyRows } = buildJvPdfGroupedRows(pdfRows);
  const existingSet = await loadExistingInvSet(companyOid);

  const uniqueRows = [];
  const seenInv = new Set();
  let skippedDuplicateInInput = 0;
  for (const row of groupedRows) {
    const inv = safeText(row?.inv || row?.INV_2);
    const key = normalizePdfInv(inv);
    if (!key) continue;
    if (seenInv.has(key)) {
      skippedDuplicateInInput += 1;
      continue;
    }
    seenInv.add(key);
    uniqueRows.push({ ...row, inv, INV_2: inv, _key: key });
  }

  const toInsert = uniqueRows.filter((row) => !existingSet.has(row._key));
  const skippedExisting = uniqueRows.length - toInsert.length;

  console.log(execute ? "MODE: execute (insert jvpdfdata)" : "MODE: dry-run (no insert)");
  console.log(`companyId: ${companyId}`);
  console.log(`pdfuploadrows: ${pdfDocs.length}`);
  console.log(`pdf rows with data: ${pdfRows.length}`);
  console.log(`grouped invoices: ${groupedRows.length}`);
  console.log(`skipped missing invoice key: ${missingGroupKeyRows}`);
  console.log(`skipped duplicate invoice in input: ${skippedDuplicateInInput}`);
  console.log(`already in jvpdfdata: ${skippedExisting}`);
  console.log(`would insert: ${toInsert.length}`);
  console.log(`existing jvpdfdata invoices: ${existingSet.size}`);

  if (toInsert.length) {
    console.log(`sample (${Math.min(SAMPLE_LIMIT, toInsert.length)} of ${toInsert.length}):`);
    for (const row of toInsert.slice(0, SAMPLE_LIMIT)) {
      console.log(
        JSON.stringify({
          inv: row.inv,
          total_dbk_amt: row.total_dbk_amt,
          total_rdt_value: row.total_rdt_value,
          sbNo: row["SB No"] || "",
          sbDate: row["SB Date"] || "",
          portCode: row["Port Code"] || "",
        })
      );
    }
  }

  if (!execute) {
    console.log("Dry run complete. Re-run with --execute to create jvpdfdata documents.");
    return;
  }

  if (!toInsert.length) {
    console.log("Nothing to insert.");
    return;
  }

  const result = await processAndSaveJvPdfRows({
    companyId: companyOid,
    pdfRows,
    sourceFileName: "rebuild-from-pdfuploadrows",
  });

  console.log("insert result:");
  console.log(
    JSON.stringify(
      {
        grouped_rows: result.grouped_rows,
        skipped_missing_group_key: result.skipped_missing_group_key,
        skipped_duplicate_in_input: result.skipped_duplicate_in_input,
        skipped_existing_in_collection: result.skipped_existing_in_collection,
        saved_rows: result.saved_rows,
      },
      null,
      2
    )
  );
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
