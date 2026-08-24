#!/usr/bin/env node
"use strict";

/**
 * Schedule `automation/automation.js` using a crontab expression from env.
 *
 * Env:
 *   AUTOMATION_CRON          required — e.g. "0 2 * * *" (daily 02:00)
 *   AUTOMATION_CRON_TZ       optional — IANA timezone, e.g. "Asia/Kolkata"
 *   AUTOMATION_CRON_ENABLED  optional — set "false" to disable (default: true)
 *   AUTOMATION_CRON_RUN_ON_START optional — set "true" to fire once immediately on start
 *
 * Run standalone:
 *   npm run automation:cron
 *
 * Or (preferred) started automatically from server.js when enabled.
 */

const path = require("node:path");
const { spawn } = require("node:child_process");
const cron = require("node-cron");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const AUTOMATION_SCRIPT = path.join(__dirname, "automation.js");

// When required from server.js, dotenv is already loaded. When run standalone, load .env
// from the backend root regardless of process.cwd().
if (require.main === module) {
  require("dotenv").config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });
}

function readCronExpression() {
  return String(process.env.AUTOMATION_CRON || "").trim();
}

function isCronEnabled() {
  const raw = String(process.env.AUTOMATION_CRON_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

function shouldRunOnStart() {
  const raw = String(process.env.AUTOMATION_CRON_RUN_ON_START ?? "false").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getTimezone() {
  const tz = String(process.env.AUTOMATION_CRON_TZ || "").trim();
  return tz || undefined;
}

function formatNextRun(task, timezone) {
  try {
    const next = typeof task.getNextRun === "function" ? task.getNextRun() : null;
    if (!next) return "unknown";
    const date = next instanceof Date ? next : new Date(next);
    if (Number.isNaN(date.getTime())) return "unknown";
    const iso = date.toISOString();
    if (!timezone) return iso;
    try {
      const local = date.toLocaleString("en-IN", { timeZone: timezone, hour12: false });
      return `${iso} (${local} ${timezone})`;
    } catch {
      return iso;
    }
  } catch {
    return "unknown";
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

let running = false;
let runCount = 0;
let lastStartedAt = null;
let lastFinishedAt = null;
let lastExitCode = null;
let scheduledTask = null;

function runAutomationOnce(trigger = "manual") {
  const tickAt = new Date().toISOString();
  console.log(`[automation:cron] Tick (${trigger}) at ${tickAt}`);

  if (running) {
    console.warn(
      `[automation:cron] Skipping trigger (${trigger}) — previous automation run is still in progress` +
        (lastStartedAt ? ` (started ${lastStartedAt})` : "") +
        "."
    );
    return;
  }

  running = true;
  runCount += 1;
  const runId = runCount;
  const startedMs = Date.now();
  lastStartedAt = new Date(startedMs).toISOString();
  console.log(
    `[automation:cron] Starting automation run #${runId} (${trigger}) at ${lastStartedAt}`
  );
  console.log(`[automation:cron] Spawn: ${process.execPath} ${AUTOMATION_SCRIPT}`);

  const child = spawn(process.execPath, [AUTOMATION_SCRIPT], {
    cwd: BACKEND_ROOT,
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (err) => {
    running = false;
    lastFinishedAt = new Date().toISOString();
    lastExitCode = null;
    console.error(
      `[automation:cron] Run #${runId} failed to start:`,
      err instanceof Error ? err.message : err
    );
    if (scheduledTask) {
      console.log(`[automation:cron] Next scheduled run: ${formatNextRun(scheduledTask, getTimezone())}`);
    }
  });

  child.on("exit", (code, signal) => {
    running = false;
    const endedMs = Date.now();
    lastFinishedAt = new Date(endedMs).toISOString();
    lastExitCode = code;
    const duration = formatDuration(endedMs - startedMs);

    if (signal) {
      console.error(
        `[automation:cron] Run #${runId} killed by signal ${signal} after ${duration} at ${lastFinishedAt}`
      );
    } else if (code === 0) {
      console.log(
        `[automation:cron] Run #${runId} finished successfully in ${duration} at ${lastFinishedAt}`
      );
    } else {
      console.error(
        `[automation:cron] Run #${runId} exited with code ${code} after ${duration} at ${lastFinishedAt}`
      );
    }

    if (scheduledTask) {
      console.log(`[automation:cron] Next scheduled run: ${formatNextRun(scheduledTask, getTimezone())}`);
    }
  });
}

/**
 * Start the in-process automation scheduler.
 * @returns {{ started: boolean, reason?: string, task?: import("node-cron").ScheduledTask }}
 */
function startAutomationCron() {
  if (!isCronEnabled()) {
    console.log("[automation:cron] AUTOMATION_CRON_ENABLED is false — scheduler not started.");
    return { started: false, reason: "disabled" };
  }

  if (scheduledTask) {
    console.warn("[automation:cron] Scheduler already started — ignoring duplicate start.");
    return { started: true, reason: "already_started", task: scheduledTask };
  }

  const expression = readCronExpression();
  if (!expression) {
    console.error(
      '[automation:cron] AUTOMATION_CRON is required in .env (example: AUTOMATION_CRON="0 2 * * *"). Scheduler not started.'
    );
    return { started: false, reason: "missing_expression" };
  }

  if (!cron.validate(expression)) {
    console.error(
      `[automation:cron] Invalid AUTOMATION_CRON expression: "${expression}". Scheduler not started.`
    );
    return { started: false, reason: "invalid_expression" };
  }

  const timezone = getTimezone();
  const options = timezone ? { timezone } : {};

  scheduledTask = cron.schedule(expression, () => runAutomationOnce("schedule"), options);

  console.log("[automation:cron] Scheduler started.");
  console.log(`[automation:cron] Expression: ${expression}`);
  if (timezone) console.log(`[automation:cron] Timezone: ${timezone}`);
  console.log(`[automation:cron] Script: ${AUTOMATION_SCRIPT}`);
  console.log(`[automation:cron] Backend root: ${BACKEND_ROOT}`);
  console.log(`[automation:cron] Next scheduled run: ${formatNextRun(scheduledTask, timezone)}`);
  console.log("[automation:cron] Waiting for scheduled ticks...");

  if (shouldRunOnStart()) {
    console.log("[automation:cron] AUTOMATION_CRON_RUN_ON_START=true — firing immediately.");
    setImmediate(() => runAutomationOnce("startup"));
  }

  return { started: true, task: scheduledTask };
}

function main() {
  const result = startAutomationCron();
  if (!result.started && result.reason === "disabled") {
    process.exit(0);
  }
  if (!result.started) {
    process.exit(1);
  }

  process.on("SIGINT", () => {
    console.log("\n[automation:cron] Shutting down (SIGINT)...");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    console.log("\n[automation:cron] Shutting down (SIGTERM)...");
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  startAutomationCron,
  runAutomationOnce,
  isCronEnabled,
  readCronExpression,
};
