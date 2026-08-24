/**
 * Remove duplicate sbonline rows per company.
 *
 * Same logical shipping bill can appear twice with different sbDate formats:
 *   5167525  19-JUL-26    INNSA1
 *   5167525  19-JUL-2026  INNSA1
 *
 * Groups by: normalized sbNo + ISO date + port (sbLocation).
 * Keeps one row (prefers short-year date like JUL-26, then success, then newest).
 * Also deletes orphan rows whose shippingBillNo ref no longer exists in shippingbillno.
 *
 * Usage:
 *   node scripts/dedupe-sbonline.js <companyId>           # dry-run (default)
 *   node scripts/dedupe-sbonline.js <companyId> --execute # apply changes
 *   node scripts/dedupe-sbonline.js --all --execute       # all companies
 */

require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { connectDatabase } = require("#utils/siteadmin");
const { Company } = require("#utils/company");
const { SbOnline } = require("#utils/sbOnline");
const {
  ShippingBillNo,
  normalizeSbNoForMatch,
} = require("#utils/shippingBillNo");

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

/** Prefer short-year display like 19-JUL-26 over 19-JUL-2026. */
function isShortYearSbDate(raw) {
  return /^\d{1,2}-[A-Za-z]{3}-\d{2}$/.test(String(raw ?? "").trim());
}

function isLongYearSbDate(raw) {
  return /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(String(raw ?? "").trim());
}

function statusScore(status) {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "success") return 100;
  if (s === "skipped") return 20;
  if (s === "error") return 10;
  return 0;
}

function hasScrapedData(doc) {
  return Boolean(doc?.scrapedData && typeof doc.scrapedData === "object");
}

function dedupeKey(doc) {
  const sbNo = normalizeSbNoForMatch(doc.sbNo);
  const iso = normalizeSbDateToIso(doc.sbDate) || String(doc.sbDate ?? "").trim().toUpperCase();
  const port = String(doc.sbLocation ?? "").trim().toUpperCase();
  if (!sbNo || !iso || !port) return "";
  return `${sbNo}|${iso}|${port}`;
}

function pickKeeperRow(rows) {
  const sorted = [...rows].sort((a, b) => {
    // Prefer short-year date format (JUL-26) over long (JUL-2026).
    const aShort = Number(isShortYearSbDate(a.sbDate));
    const bShort = Number(isShortYearSbDate(b.sbDate));
    if (aShort !== bShort) return bShort - aShort;

    const aLong = Number(isLongYearSbDate(a.sbDate));
    const bLong = Number(isLongYearSbDate(b.sbDate));
    // If one is long-year and other is neither short nor long, still prefer non-long when short exists;
    // otherwise prefer short already handled. Prefer non-long slightly when comparing long vs other.
    if (aLong !== bLong) return aLong - bLong;

    const statusDiff = statusScore(b.status) - statusScore(a.status);
    if (statusDiff !== 0) return statusDiff;

    const dataDiff = Number(hasScrapedData(b)) - Number(hasScrapedData(a));
    if (dataDiff !== 0) return dataDiff;

    const bu = new Date(b.updatedAt || 0).getTime();
    const au = new Date(a.updatedAt || 0).getTime();
    if (bu !== au) return bu - au;

    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  });
  return sorted[0];
}

function buildDuplicateGroups(rows) {
  const groups = new Map();
  let skippedNoKey = 0;

  for (const row of rows) {
    const key = dedupeKey(row);
    if (!key) {
      skippedNoKey += 1;
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const duplicateGroups = [];
  for (const [key, groupRows] of groups) {
    if (groupRows.length <= 1) continue;
    const keeper = pickKeeperRow(groupRows);
    const remove = groupRows.filter((r) => String(r._id) !== String(keeper._id));
    duplicateGroups.push({ key, keeper, remove });
  }

  return { duplicateGroups, skippedNoKey };
}

async function findOrphanIds(companyOid, rows) {
  const refIds = [
    ...new Set(
      rows
        .map((r) => (r.shippingBillNo ? String(r.shippingBillNo) : ""))
        .filter((id) => mongoose.isValidObjectId(id))
    ),
  ];
  if (!refIds.length) return [];

  const existing = await ShippingBillNo.find({
    companyId: companyOid,
    _id: { $in: refIds.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select({ _id: 1 })
    .lean();

  const existingSet = new Set(existing.map((d) => String(d._id)));
  return rows
    .filter((r) => {
      const ref = r.shippingBillNo ? String(r.shippingBillNo) : "";
      if (!ref || !mongoose.isValidObjectId(ref)) return false;
      return !existingSet.has(ref);
    })
    .map((r) => r._id);
}

async function bulkDeleteIds(companyOid, ids) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BULK_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + BULK_CHUNK_SIZE);
    const res = await SbOnline.deleteMany({
      _id: { $in: chunk },
      companyId: companyOid,
    });
    deleted += res.deletedCount || 0;
  }
  return deleted;
}

async function dedupeCompany(companyId, options = {}) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));

  console.log(`  Loading sbonline rows...`);
  const rows = await SbOnline.find({ companyId: companyOid })
    .select({
      _id: 1,
      companyId: 1,
      dayKey: 1,
      batchId: 1,
      shippingBillNo: 1,
      sbNo: 1,
      sbDate: 1,
      sbLocation: 1,
      status: 1,
      errorMessage: 1,
      scrapedData: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .lean();
  console.log(`  Loaded ${rows.length} row(s).`);

  const { duplicateGroups, skippedNoKey } = buildDuplicateGroups(rows);
  const duplicateRemoveIds = duplicateGroups.flatMap((g) => g.remove.map((r) => r._id));

  console.log(`  Finding orphan sbonline rows (missing shippingbillno ref)...`);
  const orphanIds = await findOrphanIds(companyOid, rows);
  const orphanIdSet = new Set(orphanIds.map((id) => String(id)));

  // Avoid double-counting ids already marked as duplicate removes.
  const dupIdSet = new Set(duplicateRemoveIds.map((id) => String(id)));
  const orphanOnlyIds = orphanIds.filter((id) => !dupIdSet.has(String(id)));

  const allRemoveIds = [...duplicateRemoveIds, ...orphanOnlyIds];
  const rowsToRemove = allRemoveIds.length;

  const report = {
    companyId: String(companyId),
    registeredCount: rows.length,
    skippedNoKey,
    duplicateGroups: duplicateGroups.length,
    duplicateRowsToRemove: duplicateRemoveIds.length,
    orphanRowsToRemove: orphanOnlyIds.length,
    rowsToRemove,
    samples: [],
    orphanSamples: [],
    applied: false,
  };

  for (const group of duplicateGroups.slice(0, 20)) {
    report.samples.push({
      key: group.key,
      keeper: {
        id: String(group.keeper._id),
        dayKey: group.keeper.dayKey,
        sbNo: group.keeper.sbNo,
        sbDate: group.keeper.sbDate,
        sbLocation: group.keeper.sbLocation,
        status: group.keeper.status,
      },
      remove: group.remove.slice(0, 5).map((r) => ({
        id: String(r._id),
        dayKey: r.dayKey,
        sbNo: r.sbNo,
        sbDate: r.sbDate,
        sbLocation: r.sbLocation,
        status: r.status,
      })),
    });
  }

  for (const id of orphanOnlyIds.slice(0, 10)) {
    const row = rows.find((r) => String(r._id) === String(id));
    if (!row) continue;
    report.orphanSamples.push({
      id: String(row._id),
      sbNo: row.sbNo,
      sbDate: row.sbDate,
      sbLocation: row.sbLocation,
      shippingBillNo: row.shippingBillNo ? String(row.shippingBillNo) : null,
    });
  }

  if (options.execute && rowsToRemove) {
    console.log(
      `  Deleting ${rowsToRemove} row(s) (duplicates=${duplicateRemoveIds.length}, orphans=${orphanOnlyIds.length})...`
    );
    const deletedCount = await bulkDeleteIds(companyOid, allRemoveIds);
    report.applied = true;
    report.deletedCount = deletedCount;
  }

  const remaining = await SbOnline.countDocuments({ companyId: companyOid });
  report.remainingCount = remaining;

  console.log(
    `Done [${options.companyName || companyId}] registered=${rows.length}, duplicateGroups=${duplicateGroups.length}, rowsToRemove=${rowsToRemove}, remaining=${remaining}`
  );

  return report;
}

async function main() {
  const { execute, all, companyId } = parseArgs(process.argv.slice(2));

  if (!all && !companyId) {
    console.error(
      "Usage: node scripts/dedupe-sbonline.js <companyId> [--execute]\n" +
        "       node scripts/dedupe-sbonline.js --all [--execute]"
    );
    process.exit(1);
  }

  console.log("Connecting to database...");
  await connectDatabase();
  console.log("Database connected.");
  console.log(execute ? "EXECUTE mode — changes will be written.\n" : "DRY-RUN mode — no writes.\n");

  let companies = [];
  if (all) {
    companies = await Company.find({}).select({ _id: 1, name: 1 }).lean();
  } else {
    const company = await Company.findById(companyId).select({ _id: 1, name: 1 }).lean();
    if (!company) {
      console.error(`Company not found: ${companyId}`);
      process.exit(1);
    }
    companies = [company];
  }

  const results = [];
  for (const company of companies) {
    console.log(`\nProcessing company: ${company.name || company._id}`);
    const report = await dedupeCompany(company._id, {
      execute,
      companyName: company.name || String(company._id),
    });
    results.push({
      companyName: company.name || "",
      ...report,
    });
  }

  console.log("\n" + JSON.stringify({ execute, results }, null, 2));
  console.log("Finished.");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
