/**
 * Remove duplicate dgftprocess rows per company.
 * Groups by shippingBillNo ref (when linked) or port + sbNumber + sbDate.
 *
 * When duplicates exist, keeps the row that already has DGFT data (table rows /
 * BRC response / success status). Empty error-only copies are removed.
 *
 * Usage:
 *   node scripts/dedupe-dgftprocess.js <companyId>           # dry-run (default)
 *   node scripts/dedupe-dgftprocess.js <companyId> --execute # apply changes
 *   node scripts/dedupe-dgftprocess.js --all --execute       # all companies
 */

require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { connectDatabase } = require("#utils/siteadmin");
const { Company } = require("#utils/company");
const { DgftProcess } = require("#utils/dgftProcess");
const { makeShippingBillKey } = require("#utils/sbOnline");

const BULK_CHUNK_SIZE = 200;

const SB_MONTH_MAP = Object.freeze({
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
});

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const all = argv.includes("--all");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const companyId = all ? null : positional[0] || null;
  return { execute, all, companyId };
}

function formatDateFromParts(year, month, day) {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeSbDateToIso(raw) {
  if (raw === null || raw === undefined || raw === "") return "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const parsed = xlsx.SSF?.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return formatDateFromParts(parsed.y, parsed.m, parsed.d);
    }
    return "";
  }
  const s = String(raw).trim();
  if (!s) return "";
  if (/^\d{4,6}$/.test(s)) {
    const serial = Number(s);
    const parsed = xlsx.SSF?.parse_date_code(serial);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return formatDateFromParts(parsed.y, parsed.m, parsed.d);
    }
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const d = Number(slash[1]);
    const m = Number(slash[2]);
    const y = Number(slash[3]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= 2100) {
      return formatDateFromParts(y, m, d);
    }
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return formatDateFromParts(y, m, d);
    }
  }
  const dMonY = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(s);
  if (dMonY) {
    const day = Number(dMonY[1]);
    const month = SB_MONTH_MAP[dMonY[2].toLowerCase()];
    let year = Number(dMonY[3]);
    if (month && day >= 1 && day <= 31) {
      if (year < 100) {
        year += year <= 69 ? 2000 : 1900;
      }
      if (year >= 1900 && year <= 2100) {
        return formatDateFromParts(year, month, day);
      }
    }
  }
  const dmyNum = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmyNum) {
    const d = Number(dmyNum[1]);
    const m = Number(dmyNum[2]);
    const y = Number(dmyNum[3]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return formatDateFromParts(y, m, d);
    }
  }
  return "";
}

function canonicalSbDateForKey(raw) {
  const iso = normalizeSbDateToIso(raw);
  if (iso) return iso;
  return String(raw ?? "").trim();
}

function dgftInputKey(doc) {
  const inp = doc?.input || {};
  const port = String(inp.port ?? "").trim();
  const sbNumber = String(inp.sbNumber ?? inp.sbNo ?? "").trim();
  const sbDate = canonicalSbDateForKey(inp.sbDate);
  if (!port || !sbNumber || !sbDate) return "";
  return makeShippingBillKey(sbNumber, sbDate, port);
}

function dgftDedupeKey(doc) {
  const refRaw = doc?.shippingBillNo ?? doc?.input?.shippingBillNoId ?? "";
  const refStr = String(refRaw ?? "").trim();
  if (mongoose.isValidObjectId(refStr)) return `sbref:${refStr}`;
  return dgftInputKey(doc) || "";
}

function countTableRows(scrapedData) {
  if (!scrapedData || typeof scrapedData !== "object") return 0;
  if (Array.isArray(scrapedData.tableRows) && scrapedData.tableRows.length) {
    return scrapedData.tableRows.length;
  }
  const brcRows = scrapedData?.brcResponse?.data;
  if (Array.isArray(brcRows) && brcRows.length) return brcRows.length;
  return 0;
}

function hasMeaningfulData(doc) {
  if (!doc || typeof doc !== "object") return false;
  if (doc.status === "success") return true;
  if (doc.scrapedData?.ok === true) return true;
  return countTableRows(doc.scrapedData) > 0;
}

function dataScore(doc) {
  let score = 0;
  if (doc.status === "success") score += 10_000;
  else if (doc.status === "no_data") score += 100;
  else if (doc.status === "error") score += 10;

  score += countTableRows(doc.scrapedData) * 1_000;
  if (doc.scrapedData?.ok === true) score += 500;

  const ts = new Date(doc.updatedAt || doc.createdAt || 0).getTime();
  if (Number.isFinite(ts)) score += ts / 1_000_000_000_000;

  return score;
}

function summarizeDoc(doc) {
  const inp = doc?.input || {};
  return {
    id: String(doc._id),
    status: doc.status || "",
    hasData: hasMeaningfulData(doc),
    tableRowsCount: countTableRows(doc.scrapedData),
    shippingBillNo: doc.shippingBillNo ? String(doc.shippingBillNo) : null,
    port: inp.port || "",
    sbNumber: inp.sbNumber || inp.sbNo || "",
    sbDate: inp.sbDate || "",
    batchId: doc.batchId || "",
    createdAt: doc.createdAt || null,
  };
}

function pickKeeperRow(rows) {
  const withData = rows.filter(hasMeaningfulData);
  const candidates = withData.length ? withData : rows;
  const sorted = [...candidates].sort((a, b) => dataScore(b) - dataScore(a));
  return sorted[0];
}

function buildDuplicateGroups(rows) {
  const groups = new Map();
  const skipped = [];

  for (const row of rows) {
    const key = dgftDedupeKey(row);
    if (!key) {
      skipped.push(String(row._id));
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const duplicateGroups = [];
  for (const [dedupeKey, groupRows] of groups) {
    if (groupRows.length <= 1) continue;
    const keeper = pickKeeperRow(groupRows);
    const remove = groupRows.filter((r) => String(r._id) !== String(keeper._id));
    duplicateGroups.push({ dedupeKey, keeper, remove });
  }

  return { duplicateGroups, skipped };
}

async function bulkDeleteIds(companyOid, ids) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BULK_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + BULK_CHUNK_SIZE);
    const res = await DgftProcess.deleteMany({
      companyId: companyOid,
      _id: { $in: chunk },
    });
    deleted += res.deletedCount || 0;
    if (ids.length > BULK_CHUNK_SIZE) {
      console.log(`  delete: chunk ${Math.min(i + BULK_CHUNK_SIZE, ids.length)}/${ids.length}`);
    }
  }
  return deleted;
}

async function dedupeCompany(companyId, options = {}) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));
  console.log(`  Loading dgftprocess rows...`);

  const rows = await DgftProcess.find({ companyId: companyOid })
    .select({
      _id: 1,
      companyId: 1,
      input: 1,
      shippingBillNo: 1,
      status: 1,
      errorMessage: 1,
      scrapedData: 1,
      batchId: 1,
      dayKey: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .lean();
  console.log(`  Loaded ${rows.length} row(s).`);

  const { duplicateGroups, skipped } = buildDuplicateGroups(rows);
  const rowsToRemove = duplicateGroups.reduce((sum, g) => sum + g.remove.length, 0);

  const report = {
    companyId: String(companyId),
    registeredCount: rows.length,
    skippedNoInputKey: skipped.length,
    duplicateInputGroups: duplicateGroups.length,
    rowsToRemove,
    samples: [],
    applied: false,
  };

  for (const group of duplicateGroups.slice(0, 20)) {
    report.samples.push({
      dedupeKey: group.dedupeKey,
      keeper: summarizeDoc(group.keeper),
      remove: group.remove.map(summarizeDoc),
    });
  }

  if (!duplicateGroups.length) {
    report.remainingCount = rows.length;
    return report;
  }

  if (options.execute) {
    const removeIds = duplicateGroups.flatMap((g) => g.remove.map((r) => r._id));
    console.log(`  Deleting ${removeIds.length} duplicate row(s)...`);
    report.deletedCount = await bulkDeleteIds(companyOid, removeIds);
    report.applied = true;
    report.remainingCount = await DgftProcess.countDocuments({ companyId: companyOid });
  } else {
    report.remainingCount = rows.length - rowsToRemove;
  }

  return report;
}

async function main() {
  const { execute, all, companyId } = parseArgs(process.argv.slice(2));

  if (!all && !companyId) {
    console.error("Usage:");
    console.error("  node scripts/dedupe-dgftprocess.js <companyId> [--execute]");
    console.error("  node scripts/dedupe-dgftprocess.js --all [--execute]");
    process.exit(1);
  }

  if (!mongoose.isValidObjectId(companyId) && !all) {
    console.error("Invalid companyId (expected 24-char hex ObjectId).");
    process.exit(1);
  }

  console.log("Connecting to database...");
  await connectDatabase();
  console.log("Database connected.");

  const companyIds = all
    ? (await Company.find({}).select({ _id: 1, name: 1 }).lean()).map((c) => ({
        id: String(c._id),
        name: c.name || String(c._id),
      }))
    : [{ id: String(companyId), name: String(companyId) }];

  console.log(
    execute ? "EXECUTE mode — changes will be written." : "DRY-RUN mode — no changes will be written."
  );

  const results = [];
  for (const company of companyIds) {
    console.log(`\nProcessing company: ${company.name}`);
    const report = await dedupeCompany(company.id, { execute });
    results.push({ companyName: company.name, ...report });
    console.log(
      `Done [${company.name}] registered=${report.registeredCount}, duplicateGroups=${report.duplicateInputGroups}, rowsToRemove=${report.rowsToRemove}, remaining=${report.remainingCount}`
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
