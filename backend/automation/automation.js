"use strict";

require("dotenv").config({ quiet: true });

const dns = require("node:dns");
const mongoUriBoot = String(process.env.MONGODB_URI || "");
if (mongoUriBoot.startsWith("mongodb+srv://")) {
  const custom = String(process.env.MONGODB_DNS_SERVERS || "").trim();
  dns.setServers(
    custom
      ? custom.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
      : ["8.8.8.8", "1.1.1.1"]
  );
}

const { connectDatabase } = require("#utils/siteadmin");
const mongoose = require("mongoose");
const { Company } = require("#utils/company");
const {
  formatDateKey,
  upsertProcessStatus,
} = require("#utils/automationLog");
const {
  loadConfigure,
  sanitizeAutomationSection,
} = require("#utils/configure");
const {
  AUTOMATION_PROCESSES,
  PROCESS_STATUS,
} = require("./constants");
const { processPdfDataFromMailbox } = require("./2_pdf/processPdfFromMailbox");
const { runProcessAutomationStep } = require("./3_process/runProcessStep");
const { runChaAutomationStep } = require("./4_cha/runChaStep");
const { runMergeChaAutomationStep } = require("./5_merge_cha_data/runMergeChaStep");
const { runSbAutomationStep } = require("./6_sbonline/runSbStep");
const { runDgftBulkAutomationStep } = require("./7_dgft_bulk_download/runDgftBulkStep");
const { runDgftAutomationStep } = require("./8_dgft/runDgftStep");
const { runJvAutomationStep } = require("./10_jv/runJvStep");

const SKIPPED_PROCESSES = [];

/** Optional override for step 7 submit logic (e.g. AUTOMATION_REFERENCE_DATE=2026-06-15). */
function getAutomationReferenceDate() {
  const raw = String(process.env.AUTOMATION_REFERENCE_DATE || "").trim();
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid AUTOMATION_REFERENCE_DATE: ${raw}`);
  }
  return d;
}

/**
 * Company names listed in AUTOMATION_SKIP_COMPANIES (comma/semicolon separated)
 * are skipped entirely for this automation run. Matching is case-insensitive.
 */
function getSkippedCompanyNames() {
  const raw = String(process.env.AUTOMATION_SKIP_COMPANIES || "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function shouldSkipCompany(company, skippedNames) {
  if (!skippedNames || skippedNames.size === 0) return false;
  const name = String(company?.name || "").trim().toLowerCase();
  if (name && skippedNames.has(name)) return true;
  const id = company?._id != null ? String(company._id).toLowerCase() : "";
  return Boolean(id && skippedNames.has(id));
}

async function markSkippedProcesses(companyId, dateKey) {
  for (const processKey of SKIPPED_PROCESSES) {
    await upsertProcessStatus(companyId, dateKey, processKey, {
      status: PROCESS_STATUS.SKIP,
      error: null,
      summary: null,
      ranAt: new Date(),
    });
    console.log(`[${companyId}] ${processKey}: skip`);
  }
}

async function markProcessSkipped(companyId, dateKey, processKey, reason) {
  await upsertProcessStatus(companyId, dateKey, processKey, {
    status: PROCESS_STATUS.SKIP,
    error: null,
    summary: reason ? { reason } : null,
    ranAt: new Date(),
  });
  console.log(`[${companyId}] ${processKey}: skip${reason ? ` — ${reason}` : ""}`);
  return {
    success: true,
    skipped: true,
    message: reason || "Skipped.",
  };
}

async function isJvAutomationEnabled(companyId) {
  const doc = await loadConfigure(companyId);
  const automation = sanitizeAutomationSection(doc);
  return automation?.jv?.enabled === true;
}

async function logProcessResult(companyId, dateKey, processKey, result) {
  if (result.skipped) {
    await upsertProcessStatus(companyId, dateKey, processKey, {
      status: PROCESS_STATUS.SKIP,
      error: null,
      summary: result.summary ?? (result.message ? { reason: result.message } : null),
      ranAt: new Date(),
    });
    console.log(`[${companyId}] ${processKey}: skip — ${result.message || "Skipped."}`);
    return;
  }

  if (result.success) {
    await upsertProcessStatus(companyId, dateKey, processKey, {
      status: PROCESS_STATUS.SUCCESSFUL,
      error: null,
      summary: result.summary ?? null,
      ranAt: new Date(),
    });
    console.log(`[${companyId}] ${processKey}: successful — ${result.message}`);
    return;
  }

  await upsertProcessStatus(companyId, dateKey, processKey, {
    status: PROCESS_STATUS.FAILED,
    error: result.error || result.message || "Step failed.",
    summary: result.summary ?? null,
    ranAt: new Date(),
  });
  console.log(
    `[${companyId}] ${processKey}: failed — ${result.error || result.message}`
  );
}

async function runNamedStep(companyId, dateKey, processKey, label, runner) {
  console.log(`[${companyId}] ${processKey}: ${label}...`);
  try {
    const result = await runner();
    await logProcessResult(companyId, dateKey, processKey, result);
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stepResult = { success: false, message: errorMessage, error: errorMessage };
    await logProcessResult(companyId, dateKey, processKey, stepResult);
    return stepResult;
  }
}

async function processCompany(company, dateKey, options = {}) {
  const companyId = company._id.toString();
  const companyName = company.name || companyId;

  console.log(`\n=== Processing company: ${companyName} (${companyId}) ===`);

  // 1_sales (SAP) is logged from POST /data-from-sap via frontend `logs` — not here.

  const pdfResult = await runNamedStep(
    companyId,
    dateKey,
    AUTOMATION_PROCESSES.PDF,
    "fetch PDF from active mailbox provider and store",
    async () => {
      try {
        const result = await processPdfDataFromMailbox(companyId);
        const summary = {
          provider: result.provider,
          processed_mails: result.data?.processed_mails ?? 0,
          skipped_mails: result.data?.skipped_mails ?? 0,
          failed_mails: result.data?.failed_mails ?? 0,
          stored_rows: result.data?.stored_rows ?? 0,
          fromMailboxName: result.data?.fromMailboxName,
          toMailboxName: result.data?.toMailboxName,
        };

        const noPdfFound =
          result.skipped === true ||
          (Number(summary.processed_mails) === 0 &&
            Number(result.data?.reconciled_mails || 0) === 0 &&
            Number(summary.stored_rows) === 0 &&
            Number(summary.failed_mails) === 0);

        // Empty mailbox / no PDF attachments → soft success so later steps still run.
        if (result.success || noPdfFound) {
          return {
            success: true,
            skipped: Boolean(noPdfFound || result.skipped),
            message: result.message || "No PDF found — continuing to next step.",
            summary,
          };
        }

        // Hard PDF errors: log as failed but do not abort the company pipeline.
        return {
          success: false,
          message:
            result.data?.errors?.map((e) => e.message || JSON.stringify(e)).join("; ") ||
            result.message ||
            "One or more mailbox PDFs failed to process.",
          summary,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const notFound =
          /not found|no messages|no pdf|not configured|credentials not found/i.test(
            errorMessage
          );
        if (notFound) {
          console.log(
            `[${companyId}] 2_pdf: ${errorMessage} — continuing to next step.`
          );
          return {
            success: true,
            skipped: true,
            message: `${errorMessage} — continuing to next step.`,
            summary: null,
          };
        }
        throw err;
      }
    }
  );

  console.log(
    `[${companyId}] 2_pdf: ${pdfResult.skipped ? "skip/no PDF" : pdfResult.success ? "ok" : "failed"} — proceeding to next steps.`
  );

  const processResult = await runNamedStep(
    companyId,
    dateKey,
    AUTOMATION_PROCESSES.PROCESS,
    "match sales rows to PDF rows (start-process)",
    () => runProcessAutomationStep(companyId)
  );

  const chaResult = await runNamedStep(
    companyId,
    dateKey,
    AUTOMATION_PROCESSES.CHA,
    "fetch CHA data without OTP",
    () => runChaAutomationStep(companyId)
  );

  const mergeResult = await runNamedStep(
    companyId,
    dateKey,
    AUTOMATION_PROCESSES.MERGE_CHA_DATA,
    "merge CHA data to sales",
    () => runMergeChaAutomationStep(companyId)
  );

  const sbResult = await runNamedStep(
    companyId,
    dateKey,
    AUTOMATION_PROCESSES.SBONLINE,
    "fetch shipping bills (process-shipping-bill)",
    () => runSbAutomationStep(companyId)
  );

  const dgftBulkResult = await runNamedStep(
    companyId,
    dateKey,
    AUTOMATION_PROCESSES.DGFT_BULK_DOWNLOAD,
    "DGFT bulk download (submit by DGFT_BULK_DOWNLOAD_MODE + fetch requests)",
    () =>
      runDgftBulkAutomationStep(companyId, {
        referenceDate: options.referenceDate,
      })
  );

  const dgftResult = await runNamedStep(
    companyId,
    dateKey,
    AUTOMATION_PROCESSES.DGFT,
    "DGFT fetch for all shipping bills with dgft=true",
    () => runDgftAutomationStep(companyId)
  );

  const jvEnabled = await isJvAutomationEnabled(companyId);
  const jvResult = jvEnabled
    ? await runNamedStep(
        companyId,
        dateKey,
        AUTOMATION_PROCESSES.JV,
        "JV data creation + DBK/RODTP (jv_data_creation, process-jv-dbk, process-jv-rodtp)",
        () => runJvAutomationStep(companyId)
      )
    : await markProcessSkipped(
        companyId,
        dateKey,
        AUTOMATION_PROCESSES.JV,
        "JV automation disabled in configure settings"
      );

  const results = {
    [AUTOMATION_PROCESSES.PDF]: pdfResult,
    [AUTOMATION_PROCESSES.PROCESS]: processResult,
    [AUTOMATION_PROCESSES.CHA]: chaResult,
    [AUTOMATION_PROCESSES.MERGE_CHA_DATA]: mergeResult,
    [AUTOMATION_PROCESSES.SBONLINE]: sbResult,
    [AUTOMATION_PROCESSES.DGFT_BULK_DOWNLOAD]: dgftBulkResult,
    [AUTOMATION_PROCESSES.DGFT]: dgftResult,
    [AUTOMATION_PROCESSES.JV]: jvResult,
  };

  const allOk = Object.values(results).every((r) => r.success);

  const stepLabel = (r) => (r.skipped ? "skip" : r.success ? "ok" : "fail");
  console.log(
    `=== Finished company: ${companyName} — ` +
      `pdf ${stepLabel(pdfResult)}, ` +
      `process ${stepLabel(processResult)}, ` +
      `cha ${stepLabel(chaResult)}, ` +
      `merge ${stepLabel(mergeResult)}, ` +
      `sb ${stepLabel(sbResult)}, ` +
      `dgft_bulk ${stepLabel(dgftBulkResult)}, ` +
      `dgft ${stepLabel(dgftResult)}, ` +
      `jv ${stepLabel(jvResult)} ===`
  );

  return { success: allOk, results };
}

async function main() {
  const runStartedAt = new Date();
  const referenceDate = getAutomationReferenceDate();
  const skippedCompanyNames = getSkippedCompanyNames();
  const dateKey = formatDateKey(runStartedAt);
  console.log(`[automation] ========== RUN START ==========`);
  console.log(`[automation] pid=${process.pid} dateKey=${dateKey} startedAt=${runStartedAt.toISOString()}`);
  if (referenceDate) {
    console.log(
      `[automation] AUTOMATION_REFERENCE_DATE override active: ${referenceDate.toISOString().slice(0, 10)} (step 7 Monday logic)`
    );
  }
  if (skippedCompanyNames.size > 0) {
    console.log(
      `[automation] AUTOMATION_SKIP_COMPANIES: ${[...skippedCompanyNames].join(", ")}`
    );
  }

  await connectDatabase();
  console.log("[automation] Database connected.");

  const companies = await Company.find({}).select({ _id: 1, name: 1, isActive: 1 }).lean();
  console.log(`[automation] Found ${companies.length} company/companies to process.`);

  if (companies.length === 0) {
    console.log("[automation] No companies found. Exiting.");
    return;
  }

  const activeSteps = [
    AUTOMATION_PROCESSES.PDF,
    AUTOMATION_PROCESSES.PROCESS,
    AUTOMATION_PROCESSES.CHA,
    AUTOMATION_PROCESSES.MERGE_CHA_DATA,
    AUTOMATION_PROCESSES.SBONLINE,
    AUTOMATION_PROCESSES.DGFT_BULK_DOWNLOAD,
    AUTOMATION_PROCESSES.DGFT,
    AUTOMATION_PROCESSES.JV,
  ];
  const counts = Object.fromEntries(activeSteps.map((key) => [key, { success: 0, failed: 0 }]));
  let processedCount = 0;
  let skippedCount = 0;

  for (const company of companies) {
    const companyName = company.name || String(company._id);
    if (shouldSkipCompany(company, skippedCompanyNames)) {
      skippedCount += 1;
      console.log(
        `\n=== Skipping company: ${companyName} (${company._id}) — listed in AUTOMATION_SKIP_COMPANIES ===`
      );
      continue;
    }

    processedCount += 1;
    const { results } = await processCompany(company, dateKey, { referenceDate });
    for (const key of activeSteps) {
      if (results[key].success) counts[key].success += 1;
      else counts[key].failed += 1;
    }
  }

  const elapsedMs = Date.now() - runStartedAt.getTime();
  const elapsedSec = Math.round(elapsedMs / 1000);
  console.log(`[automation] ========== RUN COMPLETE ==========`);
  console.log(
    `[automation] dateKey=${dateKey} companies=${companies.length} processed=${processedCount} skipped=${skippedCount} duration=${elapsedSec}s`
  );
  for (const key of activeSteps) {
    console.log(`[automation] ${key}: successful=${counts[key].success} failed=${counts[key].failed}`);
  }
}

async function shutdown(exitCode = 0) {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exit(exitCode);
}

main()
  .then(() => shutdown(0))
  .catch((err) => {
    console.error("Automation run failed:", err instanceof Error ? err.message : err);
    shutdown(1);
  });










// How to run (simulate Monday)
// PowerShell:

// $env:AUTOMATION_REFERENCE_DATE="2026-06-15"
// npm run automation
// One-liner:

// $env:AUTOMATION_REFERENCE_DATE="2026-06-15"; npm run automation
// CMD:

// set AUTOMATION_REFERENCE_DATE=2026-06-15 && npm run automation
