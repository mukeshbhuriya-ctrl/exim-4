/**
 * Delete salesuploadrows by rowId values from an Excel file.
 *
 * Default file: scripts/1.xlsx
 * Prefers the "Delete" sheet (column `rowId`). Also reads `rowId` from other sheets.
 *
 * Dry-run (default) prints the total matching count and does not delete.
 *
 * Usage (from repo root):
 *   node scripts/remove_sales_data_from_excel.js
 *   node scripts/remove_sales_data_from_excel.js --execute
 *   node scripts/remove_sales_data_from_excel.js scripts/1.xlsx
 *   node scripts/remove_sales_data_from_excel.js scripts/1.xlsx --execute
 */

const path = require("path");
const Module = require("module");
const fs = require("fs");

const backendRoot = path.resolve(__dirname, "..", "backend");
Module.globalPaths.unshift(path.join(backendRoot, "node_modules"));
module.paths.unshift(path.join(backendRoot, "node_modules"));

const mongoose = require("mongoose");
const xlsx = require("xlsx");
require("dotenv").config({ path: path.join(backendRoot, ".env"), quiet: true });

const DEFAULT_EXCEL = path.resolve(__dirname, "1.xlsx");
const COLLECTION_NAME = "salesuploadrows";
const SAMPLE_LIMIT = 15;
const CHUNK_SIZE = 500;

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  return {
    execute,
    excelPath: path.resolve(positional[0] || DEFAULT_EXCEL),
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

function normalizeRowId(value) {
  return String(value ?? "").trim();
}

function isRowIdHeader(key) {
  const norm = String(key ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
  return norm === "rowid" || norm === "row_id" || norm === "id";
}

function readRowIdsFromSheet(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const ids = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const key = Object.keys(row).find(isRowIdHeader);
    if (!key) continue;
    const id = normalizeRowId(row[key]);
    if (id) ids.push(id);
  }
  return ids;
}

function readRowIdsFromExcel(excelPath) {
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Excel file not found: ${excelPath}`);
  }

  const wb = xlsx.readFile(excelPath);
  const sheetNames = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
  if (!sheetNames.length) {
    throw new Error("Excel file has no sheets.");
  }

  const preferred = sheetNames.find((name) => String(name).trim().toLowerCase() === "delete");
  const namesToRead = preferred ? [preferred] : sheetNames;

  const seen = new Set();
  const rowIds = [];
  const usedSheets = [];

  for (const name of namesToRead) {
    const ids = readRowIdsFromSheet(wb.Sheets[name]);
    if (!ids.length) continue;
    usedSheets.push({ sheet: name, count: ids.length });
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      rowIds.push(id);
    }
  }

  if (!rowIds.length) {
    throw new Error(
      `No rowId values found in ${path.basename(excelPath)}. Expected a column named rowId (sheet "Delete" preferred).`
    );
  }

  return { rowIds, usedSheets, sheetNames };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

async function main() {
  const { execute, excelPath } = parseArgs(process.argv.slice(2));
  const { rowIds, usedSheets, sheetNames } = readRowIdsFromExcel(excelPath);

  const uri = getMongoUri();
  if (!uri) {
    throw new Error("MONGODB_URI is not set in backend/.env");
  }

  await mongoose.connect(uri);
  const col = mongoose.connection.db.collection(COLLECTION_NAME);
  const filter = { rowId: { $in: rowIds } };

  const totalCount = await col.countDocuments(filter);
  const samples = await col
    .find(filter, {
      projection: {
        rowId: 1,
        rowIndex: 1,
        uploadId: 1,
        "data.inv": 1,
        "data.Billing Date": 1,
      },
    })
    .limit(SAMPLE_LIMIT)
    .toArray();

  const foundIds = new Set(
    (await col.find(filter, { projection: { rowId: 1 } }).toArray()).map((d) => String(d.rowId))
  );
  const missingIds = rowIds.filter((id) => !foundIds.has(id));

  console.log(execute ? "MODE: execute (delete)" : "MODE: dry-run (no delete)");
  console.log(`excel: ${excelPath}`);
  console.log(`sheets: ${sheetNames.join(", ")}`);
  console.log(
    `rowId source: ${usedSheets.map((s) => `${s.sheet} (${s.count})`).join(", ") || "none"}`
  );
  console.log(`collection: ${COLLECTION_NAME}`);
  console.log(`excel unique rowId count: ${rowIds.length}`);
  console.log(`matched in salesuploadrows: ${totalCount}`);
  console.log(`not found in salesuploadrows: ${missingIds.length}`);

  if (samples.length) {
    console.log(`sample (${samples.length} of ${totalCount}):`);
    for (const row of samples) {
      console.log(
        JSON.stringify({
          _id: String(row._id),
          rowId: row.rowId || "",
          inv: row.data?.inv || "",
          billingDate: row.data?.["Billing Date"] || "",
        })
      );
    }
  }

  if (missingIds.length && missingIds.length <= 20) {
    console.log("missing rowIds:", missingIds.join(", "));
  }

  if (!execute) {
    console.log("Dry run complete. Re-run with --execute to delete these rows.");
    return;
  }

  if (!totalCount) {
    console.log("Nothing to delete.");
    return;
  }

  let deleted = 0;
  for (const ids of chunk(rowIds, CHUNK_SIZE)) {
    const result = await col.deleteMany({ rowId: { $in: ids } });
    deleted += result.deletedCount || 0;
  }
  console.log(`deleted: ${deleted}`);
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
