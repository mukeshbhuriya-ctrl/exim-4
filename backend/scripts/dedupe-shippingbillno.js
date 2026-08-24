/**
 * Remove duplicate shippingbillno rows per company (same normalized sbNo).
 *
 * Keeps one row per sbNo (prefers dgft=true, then billing done, then newest updatedAt).
 * Merges dgft=true onto keeper if any duplicate had it.
 * Repoints shippingBillNo refs in dgftprocess, dgftbatch, sbonline before delete.
 *
 * Usage:
 *   node scripts/dedupe-shippingbillno.js <companyId>           # dry-run (default)
 *   node scripts/dedupe-shippingbillno.js <companyId> --execute # apply changes
 *   node scripts/dedupe-shippingbillno.js --all --execute       # all companies
 */

require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const { connectDatabase } = require("#utils/siteadmin");
const { Company } = require("#utils/company");
const {
  ShippingBillNo,
  isDgftMarkedTrue,
  normalizeSbNoForMatch,
} = require("#utils/shippingBillNo");
const { DgftProcess } = require("#utils/dgftProcess");
const { DgftBatch } = require("#utils/dgftBatch");
const { SbOnline } = require("#utils/sbOnline");

const REF_MODELS = [
  { Model: DgftProcess, label: "dgftprocess" },
  { Model: DgftBatch, label: "dgftbatch" },
  { Model: SbOnline, label: "sbonline" },
];

const INPUT_REF_MODELS = [
  { Model: DgftProcess, label: "dgftprocess_input" },
  { Model: DgftBatch, label: "dgftbatch_input" },
];

const BULK_CHUNK_SIZE = 100;

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const all = argv.includes("--all");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const companyId = all ? null : positional[0] || null;
  return { execute, all, companyId };
}

function billingScore(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "true" || v === "done" || v === "yes" || v === "1") return 10;
  if (v && v !== "pending") return 5;
  return 0;
}

function pickKeeperRow(rows) {
  const sorted = [...rows].sort((a, b) => {
    const dgftDiff = Number(isDgftMarkedTrue(b.dgft)) - Number(isDgftMarkedTrue(a.dgft));
    if (dgftDiff !== 0) return dgftDiff;

    const billingDiff = billingScore(b.billing) - billingScore(a.billing);
    if (billingDiff !== 0) return billingDiff;

    const bu = new Date(b.updatedAt || 0).getTime();
    const au = new Date(a.updatedAt || 0).getTime();
    if (bu !== au) return bu - au;

    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  });
  return sorted[0];
}

function buildDuplicateGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = normalizeSbNoForMatch(row.sbNo);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const duplicateGroups = [];
  for (const [sbNoKey, groupRows] of groups) {
    if (groupRows.length <= 1) continue;
    const keeper = pickKeeperRow(groupRows);
    const remove = groupRows.filter((r) => String(r._id) !== String(keeper._id));
    const mergeDgftTrue = groupRows.some((r) => isDgftMarkedTrue(r.dgft));
    duplicateGroups.push({ sbNoKey, keeper, remove, mergeDgftTrue });
  }
  return duplicateGroups;
}

async function bulkRepointForModel(Model, companyOid, idMap, label, buildWriteOp) {
  const entries = [...idMap.entries()];
  let modified = 0;

  for (let i = 0; i < entries.length; i += BULK_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + BULK_CHUNK_SIZE);
    const ops = chunk.map(([fromId, toId]) => buildWriteOp(companyOid, fromId, toId));
    if (!ops.length) continue;

    const res = await Model.bulkWrite(ops, { ordered: false });
    modified += res.modifiedCount || 0;

    if (entries.length > BULK_CHUNK_SIZE) {
      console.log(
        `  ${label}: repointed chunk ${Math.min(i + BULK_CHUNK_SIZE, entries.length)}/${entries.length}`
      );
    }
  }

  return modified;
}

async function repointAllShippingBillNoRefs(companyOid, idMap) {
  const summary = {};

  for (const { Model, label } of REF_MODELS) {
    summary[label] = await bulkRepointForModel(
      Model,
      companyOid,
      idMap,
      label,
      (companyId, fromId, toId) => ({
        updateMany: {
          filter: { companyId, shippingBillNo: fromId },
          update: { $set: { shippingBillNo: toId } },
        },
      })
    );
  }

  for (const { Model, label } of INPUT_REF_MODELS) {
    summary[label] = await bulkRepointForModel(
      Model,
      companyOid,
      idMap,
      label,
      (companyId, fromId, toId) => ({
        updateMany: {
          filter: { companyId, "input.shippingBillNoId": String(fromId) },
          update: { $set: { "input.shippingBillNoId": String(toId) } },
        },
      })
    );
  }

  return summary;
}

async function applyDedupe(companyOid, groups) {
  const idMap = new Map();
  const keeperDgftUpdates = [];
  const removeIds = [];

  for (const group of groups) {
    for (const dup of group.remove) {
      idMap.set(String(dup._id), group.keeper._id);
      removeIds.push(dup._id);
    }
    if (group.mergeDgftTrue && !isDgftMarkedTrue(group.keeper.dgft)) {
      keeperDgftUpdates.push(group.keeper._id);
    }
  }

  if (keeperDgftUpdates.length) {
    console.log(`  Merging dgft=true on ${keeperDgftUpdates.length} keeper row(s)...`);
    await ShippingBillNo.updateMany(
      { _id: { $in: keeperDgftUpdates }, companyId: companyOid },
      { $set: { dgft: "true" } }
    );
  }

  let repointedRefs = {};
  if (idMap.size) {
    console.log(`  Repointing refs for ${idMap.size} duplicate id(s)...`);
    repointedRefs = await repointAllShippingBillNoRefs(companyOid, idMap);
    console.log(`  Repointed refs: ${JSON.stringify(repointedRefs)}`);
  }

  if (removeIds.length) {
    console.log(`  Deleting ${removeIds.length} duplicate row(s)...`);
    const del = await ShippingBillNo.deleteMany({
      _id: { $in: removeIds },
      companyId: companyOid,
    });
    console.log(`  Deleted ${del.deletedCount || 0} row(s).`);
    return { deletedCount: del.deletedCount || 0, repointedRefs };
  }

  return { deletedCount: 0, repointedRefs };
}

async function dedupeCompany(companyId, options = {}) {
  const companyOid = new mongoose.Types.ObjectId(String(companyId));

  console.log(`  Loading shippingbillno rows...`);
  const rows = await ShippingBillNo.find({ companyId: companyOid })
    .select({
      _id: 1,
      companyId: 1,
      portCode: 1,
      sbNo: 1,
      sbDate: 1,
      billing: 1,
      dgft: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .lean();
  console.log(`  Loaded ${rows.length} row(s).`);

  const groups = buildDuplicateGroups(rows);
  const rowsToRemove = groups.reduce((sum, g) => sum + g.remove.length, 0);

  const report = {
    companyId: String(companyId),
    registeredCount: rows.length,
    duplicateSbNoGroups: groups.length,
    rowsToRemove,
    repointedRefs: {},
    samples: [],
    applied: false,
  };

  for (const group of groups.slice(0, 20)) {
    report.samples.push({
      sbNoKey: group.sbNoKey,
      keeper: {
        id: String(group.keeper._id),
        portCode: group.keeper.portCode,
        sbNo: group.keeper.sbNo,
        sbDate: group.keeper.sbDate,
        dgft: group.keeper.dgft,
      },
      removeCount: group.remove.length,
      removeIds: group.remove.map((r) => String(r._id)),
    });
  }

  if (!groups.length) {
    report.remainingCount = rows.length;
    return report;
  }

  if (options.execute) {
    const applyResult = await applyDedupe(companyOid, groups);
    report.repointedRefs = applyResult.repointedRefs;
    report.deletedCount = applyResult.deletedCount;
    report.applied = true;
    report.remainingCount = await ShippingBillNo.countDocuments({ companyId: companyOid });
  } else {
    report.remainingCount = rows.length - rowsToRemove;
  }

  return report;
}

async function main() {
  const { execute, all, companyId } = parseArgs(process.argv.slice(2));

  if (!all && !companyId) {
    console.error("Usage:");
    console.error("  node scripts/dedupe-shippingbillno.js <companyId> [--execute]");
    console.error("  node scripts/dedupe-shippingbillno.js --all [--execute]");
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

  console.log(execute ? "EXECUTE mode — changes will be written." : "DRY-RUN mode — no changes will be written.");

  const results = [];
  for (const company of companyIds) {
    console.log(`\nProcessing company: ${company.name}`);
    const report = await dedupeCompany(company.id, { execute });
    results.push({ companyName: company.name, ...report });
    console.log(
      `Done [${company.name}] registered=${report.registeredCount}, duplicateSbNoGroups=${report.duplicateSbNoGroups}, rowsToRemove=${report.rowsToRemove}, remaining=${report.remainingCount}`
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
