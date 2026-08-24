const crypto = require("node:crypto");
const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { SbOnline, makeShippingBillKey } = require("#utils/sbOnline");
const {
  findShippingBillNoId,
  listUniqueShippingBills,
} = require("#utils/shippingBillNo");
const {
  ShippingBillExcelBatchRow,
} = require("#utils/shippingBillExcelBatchRow");

function resolveShippingBillNoObjectId(input) {
  const raw = input?.shippingBillNoId ?? input?.shippingBillNo;
  if (!raw) return null;
  const s = String(raw);
  return mongoose.isValidObjectId(s) ? new mongoose.Types.ObjectId(s) : null;
}

async function loadSuccessfulShippingBillKeys(companyId) {
  const docs = await SbOnline.find({
    companyId,
    status: "success",
  })
    .select({ sbNo: 1, sbDate: 1, sbLocation: 1 })
    .lean();

  return new Set(
    docs.map((d) => makeShippingBillKey(d.sbNo, d.sbDate, d.sbLocation))
  );
}

/**
 * Unique SB triples from `shippingbillno` (registered via PDF upload), with registry `_id` for `sbonline.shippingBillNo`.
 */
async function loadPendingFromShippingBillNo(companyId) {
  const rows = await listUniqueShippingBills(companyId);
  return rows.map((r) => ({
    shippingBillNoId: r._id,
    sbNo: r.sbNo,
    sbDate: r.sbDate,
    sbLocation: r.portCode,
  }));
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getConfiguredRowsPerSession() {
  return Math.max(1, Number(process.env.SB_ROWS_PER_SESSION ?? 5) || 5);
}

function getEffectiveRowsPerSession(totalRows) {
  const configured = getConfiguredRowsPerSession();
  const count = Math.max(0, Number(totalRows) || 0);
  return count > 0 ? Math.max(1, Math.min(count, configured)) : configured;
}

function getConfiguredExcelMaxSessions(totalRows) {
  const globalConfigured = Math.max(
    1,
    Number(process.env.SB_MAX_SESSIONS ?? 3) || 1
  );
  const fallback = Math.min(globalConfigured, 5);
  const requested = Math.max(
    1,
    Number(process.env.SB_EXCEL_MAX_SESSIONS ?? fallback) || fallback
  );
  const configured = Math.min(globalConfigured, requested);
  const count = Math.max(0, Number(totalRows) || 0);
  return count > 0 ? Math.max(1, Math.min(count, configured)) : configured;
}

function getConfiguredExcelWindowSize(totalRows, rowsPerSession, maxSessions) {
  const baseWindowSize =
    Math.max(1, Number(rowsPerSession) || 1) *
    Math.max(1, Number(maxSessions) || 1) *
    Math.max(1, Number(process.env.SB_EXCEL_WINDOW_MULTIPLIER ?? 2) || 2);
  const configured = Math.max(
    1,
    Number(process.env.SB_EXCEL_WINDOW_SIZE ?? baseWindowSize) ||
      baseWindowSize
  );
  const count = Math.max(0, Number(totalRows) || 0);
  return count > 0 ? Math.max(1, Math.min(count, configured)) : configured;
}

function chunkArray(arr, chunkSize) {
  const list = Array.isArray(arr) ? arr : [];
  const size = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];
  for (let start = 0; start < list.length; start += size) {
    chunks.push(list.slice(start, start + size));
  }
  return chunks;
}

function buildRowTimingEntry({ index, input, status, timing, errorMessage = "" }) {
  const normalizedTiming = timing || null;
  return {
    inputIndex: index,
    sbNo: input?.sbNo,
    sbDate: input?.sbDate,
    sbLocation: input?.sbLocation,
    status,
    totalDurationMs: normalizedTiming?.totalDurationMs ?? null,
    attemptsUsed: normalizedTiming?.attemptsUsed ?? null,
    stepTimings: Array.isArray(normalizedTiming?.steps) ? normalizedTiming.steps : [],
    timing: normalizedTiming,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

function normalizeScrapedDataSectionsForStorage(scraped) {
  if (!scraped || typeof scraped !== "object") return scraped;
  if (Array.isArray(scraped)) return scraped;

  const out = { ...scraped };

  // Rename sections (keep old keys too? No: store only new keys to avoid duplication)
  if (out.rows !== undefined) {
    out["Shipping Bill Details"] = out.rows;
    delete out.rows;
  }
  if (out.queueRows !== undefined) {
    out["Current Status"] = out.queueRows;
    delete out.queueRows;
  }
  if (out.egmRows !== undefined) {
    out["LEGM Status"] = out.egmRows;
    delete out.egmRows;
  }
  if (out.drawbackQueryRows !== undefined) {
    out["Drawback Query Details"] = out.drawbackQueryRows;
    delete out.drawbackQueryRows;
  }
  if (out.gatewayExportRows !== undefined) {
    out["Gateway EGM Status Enquiry"] = out.gatewayExportRows;
    delete out.gatewayExportRows;
  }

  return out;
}

function resolveShippingBillFetchEngine(body = {}) {
  const requested = String(body.fetchUsing ?? body.engine ?? body.mode ?? "")
    .trim()
    .toLowerCase();
  if (!requested || requested === "selenium") return "selenium";
  if (requested === "dricat") return "dricat";
  throw new Error("Invalid fetchUsing value. Allowed: selenium, dricat");
}

async function persistSbOnlineOne(
  companyId,
  dayKey,
  batchId,
  index,
  ok,
  input,
  data,
  message
) {
  const inp = input || {};
  await SbOnline.create({
    companyId,
    dayKey,
    batchId,
    shippingBillNo: resolveShippingBillNoObjectId(inp),
    sbNo: String(inp.sbNo ?? "").trim(),
    sbDate: String(inp.sbDate ?? "").trim(),
    sbLocation: String(inp.sbLocation ?? "").trim(),
    status: ok ? "success" : "error",
    errorMessage: ok ? "" : String(message || ""),
    scrapedData: ok ? normalizeScrapedDataSectionsForStorage(data ?? null) : null,
    inputIndex: index,
  });
}

const DEFAULT_RANDOM_SB_SAMPLE_SIZE = 30;

/**
 * POST /process-random-ten-shipping-bills
 * Picks a random sample of pending SBs (from PDF-upload row headers), scrapes them,
 * and writes each outcome to `sbonline` as soon as that row finishes (not after the full batch).
 * Default sample size is 20 (override with body `count` or `sampleSize`).
 * Pending list comes from unique rows in `shippingbillno` (see PDF upload flow).
 */
async function processRandomTenShippingBills(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const body = req.body || {};
  let fetchUsing = "selenium";
  try {
    fetchUsing = resolveShippingBillFetchEngine(body);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  const sampleSize = Math.min(
    100,
    Math.max(
      1,
      Number(body.count ?? body.sampleSize ?? DEFAULT_RANDOM_SB_SAMPLE_SIZE) ||
        DEFAULT_RANDOM_SB_SAMPLE_SIZE
    )
  );

  let pending = await loadPendingFromShippingBillNo(companyId);
  const successKeys = await loadSuccessfulShippingBillKeys(companyId);
  pending = pending.filter(
    (it) =>
      it.sbNo &&
      it.sbDate &&
      it.sbLocation &&
      !successKeys.has(makeShippingBillKey(it.sbNo, it.sbDate, it.sbLocation))
  );

  if (!pending.length) {
    return res.status(400).json({
      success: false,
      message:
        "No pending shipping bills left (all succeeded already, or no rows in shippingbillno — upload PDFs first to register Port Code / SB No / SB Date).",
    });
  }

  const shuffled = shuffleArray(pending);
  const items = shuffled.slice(0, sampleSize).map((it) => ({
    shippingBillNoId: it.shippingBillNoId,
    sbNo: String(it.sbNo).trim(),
    sbDate: String(it.sbDate).trim(),
    sbLocation: String(it.sbLocation).trim(),
  }));

  const dayKey = new Date().toISOString().slice(0, 10);
  const batchId = crypto.randomUUID();

  const maxSessions = Math.max(1, Number(process.env.SB_MAX_SESSIONS || 5) || 1);
  const rowsPerSession = getEffectiveRowsPerSession(items.length);

  const summary = [];
  let distributed;

  if (fetchUsing === "dricat") {
    const { processShippingBillRequest } = require("../../../../web_scraping/shipping_bill/dricat");
    const results = [];
    const errors = [];
    for (let index = 0; index < items.length; index += 1) {
      const input = items[index];
      try {
        const dricatResult = await processShippingBillRequest({
          location: input.sbLocation,
          sbNo: input.sbNo,
          sbDate: input.sbDate,
        });
        const row = dricatResult?.ok
          ? { ok: true, index, input, data: dricatResult.data }
          : {
              ok: false,
              index,
              input,
              message:
                dricatResult?.data?.error_message ||
                "Dricat fetch failed",
              timing: null,
            };

        if (row.ok) results.push({ index, input, data: row.data });
        else errors.push({ index, input, message: row.message, timing: null });

        await persistSbOnlineOne(
          companyId,
          dayKey,
          batchId,
          row.index,
          row.ok,
          row.input,
          row.ok ? row.data : null,
          row.ok ? "" : row.message
        );
        summary.push({
          inputIndex: row.index,
          shippingBillNoId: row.input?.shippingBillNoId
            ? String(row.input.shippingBillNoId)
            : undefined,
          sbNo: row.input?.sbNo,
          sbDate: row.input?.sbDate,
          sbLocation: row.input?.sbLocation,
          savedToDatabase: row.ok ? "success" : "error",
          errorMessage: row.ok ? undefined : row.message,
          totalDurationMs: null,
          stepTimings: [],
          timing: null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ index, input, message, timing: null });
        await persistSbOnlineOne(
          companyId,
          dayKey,
          batchId,
          index,
          false,
          input,
          null,
          message
        );
        summary.push({
          inputIndex: index,
          shippingBillNoId: input?.shippingBillNoId
            ? String(input.shippingBillNoId)
            : undefined,
          sbNo: input?.sbNo,
          sbDate: input?.sbDate,
          sbLocation: input?.sbLocation,
          savedToDatabase: "error",
          errorMessage: message,
          totalDurationMs: null,
          stepTimings: [],
          timing: null,
        });
      }
    }
    distributed = {
      results,
      errors,
      rowsPerSession: 1,
      maxSessions: 1,
    };
  } else {
    const { scrapeShippingBillsDistributed } = require("../../../../web_scraping/shipping_bill/main");
    distributed = await scrapeShippingBillsDistributed({
      items,
      rowsPerSession,
      maxSessions,
      onRowResult: async (row) => {
        await persistSbOnlineOne(
          companyId,
          dayKey,
          batchId,
          row.index,
          row.ok,
          row.input,
          row.ok ? row.data : null,
          row.ok ? "" : row.message
        );
        summary.push({
          inputIndex: row.index,
          shippingBillNoId: row.input?.shippingBillNoId
            ? String(row.input.shippingBillNoId)
            : undefined,
          sbNo: row.input?.sbNo,
          sbDate: row.input?.sbDate,
          sbLocation: row.input?.sbLocation,
          savedToDatabase: row.ok ? "success" : "error",
          errorMessage: row.ok ? undefined : row.message,
          totalDurationMs: row.ok
            ? row.data?.timing?.totalDurationMs ?? null
            : row.timing?.totalDurationMs ?? null,
          stepTimings: row.ok
            ? row.data?.timing?.steps ?? []
            : row.timing?.steps ?? [],
          timing: row.ok ? row.data?.timing ?? null : row.timing ?? null,
        });
      },
    });
  }

  summary.sort((a, b) => (a.inputIndex ?? 0) - (b.inputIndex ?? 0));

  const httpStatus = distributed.errors.length ? 207 : 200;

  return res.status(httpStatus).json({
    success: distributed.errors.length === 0,
    message:
      distributed.errors.length === 0
        ? `Scraped ${items.length} shipping bill(s). Each result was saved to the database immediately when that scrape finished.`
        : `Batch finished with some errors; successful rows were still saved to the database as each completed.`,
    data: {
      fetchUsing,
      dayKey,
      batchId,
      requestedSampleSize: sampleSize,
      pickedCount: items.length,
      pendingPoolSize: pending.length,
      succeeded: distributed.results.length,
      failed: distributed.errors.length,
      rowsPerSession: distributed.rowsPerSession,
      maxSessions: distributed.maxSessions,
      incrementalDbSave: true,
      summary,
    },
  });
}

/** GET /process-shipping-bill-dates — per-day counts and error SB numbers. */
async function getSbOnlineDates(req, res) {
  const companyId = req.companyId;
  const rowsPerSession = getConfiguredRowsPerSession();
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));

  const docs = await SbOnline.find({ companyId: oid })
    .select({ dayKey: 1, status: 1, sbNo: 1, sbDate: 1, sbLocation: 1 })
    .lean();

  /** One logical shipping bill per `makeShippingBillKey`; duplicate scrapes same day count once. */
  const dayToKeyMap = new Map();
  for (const d of docs) {
    const dk = String(d.dayKey || "").trim();
    if (!dk) continue;
    const shipKey = makeShippingBillKey(d.sbNo, d.sbDate, d.sbLocation);
    if (!shipKey || shipKey === "||") continue;

    if (!dayToKeyMap.has(dk)) dayToKeyMap.set(dk, new Map());
    const keyMap = dayToKeyMap.get(dk);
    if (!keyMap.has(shipKey)) {
      keyMap.set(shipKey, { statuses: [], sbNo: String(d.sbNo ?? "").trim() });
    }
    keyMap.get(shipKey).statuses.push(d.status);
  }

  const days = [];
  for (const [dayKey, keyMap] of dayToKeyMap) {
    let processedSuccess = 0;
    let processedError = 0;
    let skipped = 0;
    const errorShippingBillNumbers = new Set();

    for (const { statuses, sbNo } of keyMap.values()) {
      const hasSuccess = statuses.includes("success");
      const hasError = statuses.includes("error");
      const hasSkipped = statuses.includes("skipped");
      if (hasSuccess) {
        processedSuccess += 1;
      } else if (hasError) {
        processedError += 1;
        if (sbNo) errorShippingBillNumbers.add(sbNo);
      } else if (hasSkipped) {
        skipped += 1;
      }
    }

    days.push({
      id: dayKey,
      dayKey,
      processedSuccess,
      processedError,
      skipped,
      uniqueShippingBillCount: keyMap.size,
      errorShippingBillNumbers: [...errorShippingBillNumbers].sort(),
    });
  }

  days.sort((a, b) => b.dayKey.localeCompare(a.dayKey));

  return res.status(200).json({
    success: true,
    message:
      "sbonline aggregated by UTC dayKey (unique shipping bills per day by SB No + date + port).",
    rowsPerSession,
    count: days.length,
    days,
  });
}

/** GET /process-shipping-bill-date-wise-detail?id=YYYY-MM-DD */
async function getShippingBillDateWiseDetail(req, res) {
  const companyId = req.companyId;
  const dayKey = String(req.query.id ?? "").trim();
  const rowsPerSession = getConfiguredRowsPerSession();

  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }
  if (!dayKey) {
    return res.status(400).json({
      success: false,
      message: "Query parameter `id` is required (dayKey, e.g. 2026-04-06).",
    });
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));

  const rows = await SbOnline.find({ companyId: oid, dayKey })
    .sort({ createdAt: 1, inputIndex: 1 })
    .lean();

  if (!rows.length) {
    return res.status(404).json({
      success: false,
      message: "No shipping bill process records for this day id.",
    });
  }

  /** One row per unique shipping bill (SB No + date + port); prefer latest success, else latest doc */
  const byShipKey = new Map();
  for (const d of rows) {
    const baseKey = makeShippingBillKey(d.sbNo, d.sbDate, d.sbLocation);
    const shipKey =
      baseKey && baseKey !== "||" ? baseKey : `__id:${String(d._id)}`;
    const prev = byShipKey.get(shipKey);
    if (!prev) {
      byShipKey.set(shipKey, d);
      continue;
    }
    const prevSuccess = prev.status === "success";
    const curSuccess = d.status === "success";
    if (curSuccess && !prevSuccess) {
      byShipKey.set(shipKey, d);
    } else if (prevSuccess === curSuccess) {
      const tPrev = new Date(prev.createdAt || 0).getTime();
      const tCur = new Date(d.createdAt || 0).getTime();
      if (tCur >= tPrev) byShipKey.set(shipKey, d);
    }
  }

  const deduped = [...byShipKey.values()].sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return ta - tb;
  });

  const out = deduped.map((d) => ({
    id: d._id?.toString(),
    companyId: String(d.companyId),
    dayKey: d.dayKey,
    batchId: d.batchId,
    shippingBillNoId: d.shippingBillNo ? String(d.shippingBillNo) : null,
    sbNo: d.sbNo,
    sbDate: d.sbDate,
    sbLocation: d.sbLocation,
    status: d.status,
    errorMessage: d.errorMessage,
    scrapedData: d.scrapedData,
    inputIndex: d.inputIndex,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));

  return res.status(200).json({
    success: true,
    dayKey,
    rowsPerSession,
    count: out.length,
    totalRecordsBeforeDedupe: rows.length,
    rows: out,
  });
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse multi SB Nos from string/array (comma, space, newline, semicolon, pipe). */
function parseMultiSbNos(input) {
  if (Array.isArray(input)) {
    const out = [];
    for (const item of input) out.push(...parseMultiSbNos(item));
    return [...new Set(out.map((s) => String(s).trim()).filter(Boolean))];
  }
  const text = String(input ?? "").trim();
  if (!text) return [];
  return [
    ...new Set(
      text
        .split(/[\s,;|]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

function normalizeSbNoForMatch(sbNo) {
  const s = String(sbNo ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) {
    const stripped = s.replace(/^0+/, "");
    return stripped || "0";
  }
  return s.toUpperCase();
}

function buildSbNoMongoOrClauses(sbNos, fieldPath = "sbNo") {
  const ors = [];
  for (const raw of sbNos) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const norm = normalizeSbNoForMatch(s);
    if (/^\d+$/.test(norm)) {
      ors.push({ [fieldPath]: new RegExp(`^0*${escapeRegex(norm)}$`) });
    } else {
      ors.push({ [fieldPath]: new RegExp(`^${escapeRegex(s)}$`, "i") });
    }
  }
  return ors;
}

function serializeSbOnlineRow(d) {
  return {
    id: d._id?.toString(),
    companyId: String(d.companyId),
    dayKey: d.dayKey,
    batchId: d.batchId,
    shippingBillNoId: d.shippingBillNo ? String(d.shippingBillNo) : null,
    sbNo: d.sbNo,
    sbDate: d.sbDate,
    sbLocation: d.sbLocation,
    status: d.status,
    errorMessage: d.errorMessage,
    scrapedData: d.scrapedData,
    inputIndex: d.inputIndex,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function dedupeSbOnlineRowsByShipKey(rows) {
  const byShipKey = new Map();
  for (const d of rows) {
    const baseKey = makeShippingBillKey(d.sbNo, d.sbDate, d.sbLocation);
    const shipKey =
      baseKey && baseKey !== "||" ? baseKey : `__id:${String(d._id)}`;
    const prev = byShipKey.get(shipKey);
    if (!prev) {
      byShipKey.set(shipKey, d);
      continue;
    }
    const prevSuccess = prev.status === "success";
    const curSuccess = d.status === "success";
    if (curSuccess && !prevSuccess) {
      byShipKey.set(shipKey, d);
    } else if (prevSuccess === curSuccess) {
      const tPrev = new Date(prev.createdAt || 0).getTime();
      const tCur = new Date(d.createdAt || 0).getTime();
      if (tCur >= tPrev) byShipKey.set(shipKey, d);
    }
  }

  return [...byShipKey.values()].sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return ta - tb;
  });
}

/**
 * POST /search-by-sb-no
 * Body: { sbNos: ["123","456"] } or { sbNo: "123, 456 789" }
 * Searches all company sbonline records (not limited to one day).
 */
async function searchShippingBillsBySbNo(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const sbNos = parseMultiSbNos(
    body.sbNos ?? body.sbNo ?? body.q ?? body.search ?? req.query?.sbNos ?? req.query?.sbNo
  );

  if (!sbNos.length) {
    return res.status(400).json({
      success: false,
      message:
        "Provide one or more SB numbers via sbNos (array) or sbNo (comma/space separated).",
    });
  }

  const ors = buildSbNoMongoOrClauses(sbNos, "sbNo");
  if (!ors.length) {
    return res.status(400).json({
      success: false,
      message: "No valid SB numbers provided.",
    });
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));
  const rows = await SbOnline.find({ companyId: oid, $or: ors })
    .sort({ createdAt: 1, inputIndex: 1 })
    .lean();

  const wantNorm = new Set(sbNos.map(normalizeSbNoForMatch).filter(Boolean));
  const matched = rows.filter((d) =>
    wantNorm.has(normalizeSbNoForMatch(d.sbNo))
  );
  const deduped = dedupeSbOnlineRowsByShipKey(matched);
  const out = deduped.map(serializeSbOnlineRow);

  const foundNorm = new Set(out.map((r) => normalizeSbNoForMatch(r.sbNo)));
  const notFound = sbNos.filter((n) => !foundNorm.has(normalizeSbNoForMatch(n)));

  return res.status(200).json({
    success: true,
    message: "Company-wide shipping bill search by SB No.",
    searchedSbNos: sbNos,
    notFoundSbNos: notFound,
    count: out.length,
    totalRecordsBeforeDedupe: matched.length,
    rows: out,
  });
}

async function runScrapeShippingBillForCompany(companyId, body = {}) {
  if (!companyId) {
    return {
      success: false,
      httpStatus: 401,
      message: "Company admin access is required.",
    };
  }

  const {
    scrapeShippingBill: runSingle,
    scrapeShippingBillsDistributed,
  } = require("../../../../web_scraping/shipping_bill/main");
  const { processShippingBillRequest } = require("../../../../web_scraping/shipping_bill/dricat");

  let fetchUsing = "selenium";
  try {
    fetchUsing = resolveShippingBillFetchEngine(body);
  } catch (err) {
    return {
      success: false,
      httpStatus: 400,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const onlyUnprocessed =
    body.onlyUnprocessed === true || body.onlyPending === true;

  let bulkItems = Array.isArray(body?.data) ? body.data : null;
  const singleItem =
    bulkItems === null && (body.sbNo || body.sbDate || body.sbLocation)
      ? body
      : null;

  if (onlyUnprocessed && !bulkItems?.length && !singleItem) {
    bulkItems = await loadPendingFromShippingBillNo(companyId);
  }

  let items = bulkItems || (singleItem ? [singleItem] : []);

  if (onlyUnprocessed && items.length) {
    const successKeys = await loadSuccessfulShippingBillKeys(companyId);
    items = items.filter(
      (it) =>
        !successKeys.has(
          makeShippingBillKey(it.sbNo, it.sbDate, it.sbLocation)
        )
    );
  }

  if (!items.length) {
    const message = onlyUnprocessed
      ? "No shipping bills to process (all already succeeded, or no rows in shippingbillno / no body data). Upload PDFs to register SB triples."
      : "Body must be either { sbNo, sbDate, sbLocation } or { data: [{ sbNo, sbDate, sbLocation }, ...] }";

    if (onlyUnprocessed && body.treatEmptyAsSuccess === true) {
      return {
        success: true,
        httpStatus: 200,
        message: "No unfetched shipping bills to process.",
        onlyUnprocessed: true,
        summary: {
          fetchUsing,
          onlyUnprocessed: true,
          total: 0,
          succeeded: 0,
          failed: 0,
          skippedValidation: 0,
        },
      };
    }

    return {
      success: false,
      httpStatus: 400,
      message,
      onlyUnprocessed,
    };
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const batchId = crypto.randomUUID();

  const maxSessions = Math.max(1, Number(process.env.SB_MAX_SESSIONS || 1) || 1);

  const normalized = items.map((it) => ({
    sbNo: it?.sbNo,
    sbDate: it?.sbDate,
    sbLocation: it?.sbLocation,
    shippingBillNoId: it?.shippingBillNoId,
  }));

  const valid = [];
  const errors = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const it = normalized[i];
    if (!it.sbNo || !it.sbDate || !it.sbLocation) {
      errors.push({
        index: i,
        input: it,
        message: "Required: sbNo, sbDate, sbLocation",
      });
    } else {
      valid.push({ index: i, input: it });
    }
  }

  const rowsPerSession = valid.length
    ? getEffectiveRowsPerSession(valid.length)
    : getConfiguredRowsPerSession();
  let effectiveRowsPerSession = rowsPerSession;
  let effectiveMaxSessions = Math.max(1, Math.min(maxSessions, valid.length || 1));

  const results = [];
  if (fetchUsing === "dricat" && valid.length) {
    for (const one of valid) {
      try {
        const dricatResult = await processShippingBillRequest({
          location: String(one.input.sbLocation),
          sbNo: String(one.input.sbNo),
          sbDate: String(one.input.sbDate),
        });
        if (dricatResult?.ok) {
          results.push({ index: one.index, input: one.input, data: dricatResult.data });
        } else {
          errors.push({
            index: one.index,
            input: one.input,
            message: dricatResult?.data?.error_message || "Dricat fetch failed",
            timing: null,
          });
        }
      } catch (err) {
        errors.push({
          index: one.index,
          input: one.input,
          message: err instanceof Error ? err.message : String(err),
          timing: null,
        });
      }
    }
    effectiveRowsPerSession = 1;
    effectiveMaxSessions = 1;
  } else if (valid.length === 1 && rowsPerSession === 1) {
    const one = valid[0];
    try {
      const data = await runSingle({
        sbNo: String(one.input.sbNo),
        sbDate: String(one.input.sbDate),
        sbLocation: String(one.input.sbLocation),
      });
      results.push({ index: one.index, input: one.input, data });
    } catch (err) {
      errors.push({
        index: one.index,
        input: one.input,
        message: err instanceof Error ? err.message : String(err),
        timing: err?.timing || null,
      });
    }
  } else if (valid.length) {
    const payloadItems = valid.map((v) => ({
      sbNo: String(v.input.sbNo),
      sbDate: String(v.input.sbDate),
      sbLocation: String(v.input.sbLocation),
    }));

    const distributed = await scrapeShippingBillsDistributed({
      items: payloadItems,
      rowsPerSession,
      maxSessions,
    });
    effectiveRowsPerSession = distributed.rowsPerSession;
    effectiveMaxSessions = distributed.maxSessions;

    for (const r of distributed.results) {
      const original = valid[r.index];
      results.push({ index: original.index, input: original.input, data: r.data });
    }
    for (const e of distributed.errors) {
      const original = valid[e.index];
      errors.push({
        index: original.index,
        input: original.input,
        message: e.message,
        timing: e.timing || null,
      });
    }
  }

  const persistRows = [];

  for (const e of errors) {
    const input = e.input || {};
    const hasRequired = input.sbNo && input.sbDate && input.sbLocation;
    let shippingBill = resolveShippingBillNoObjectId(input);
    if (!shippingBill && hasRequired) {
      const regId = await findShippingBillNoId(companyId, {
        portCode: input.sbLocation,
        sbNo: input.sbNo,
        sbDate: input.sbDate,
      });
      shippingBill = regId;
    }
    persistRows.push({
      companyId,
      dayKey,
      batchId,
      shippingBillNo: shippingBill,
      sbNo: String(input.sbNo ?? "").trim(),
      sbDate: String(input.sbDate ?? "").trim(),
      sbLocation: String(input.sbLocation ?? "").trim(),
      status: hasRequired ? "error" : "skipped",
      errorMessage: String(e.message || ""),
      scrapedData: null,
      inputIndex: e.index,
    });
  }

  for (const r of results) {
    const input = r.input || {};
    let shippingBill = resolveShippingBillNoObjectId(input);
    if (!shippingBill) {
      const regId = await findShippingBillNoId(companyId, {
        portCode: input.sbLocation,
        sbNo: input.sbNo,
        sbDate: input.sbDate,
      });
      shippingBill = regId;
    }
    persistRows.push({
      companyId,
      dayKey,
      batchId,
      shippingBillNo: shippingBill,
      sbNo: String(input.sbNo ?? "").trim(),
      sbDate: String(input.sbDate ?? "").trim(),
      sbLocation: String(input.sbLocation ?? "").trim(),
      status: "success",
      errorMessage: "",
      scrapedData: normalizeScrapedDataSectionsForStorage(r.data ?? null),
      inputIndex: r.index,
    });
  }

  if (persistRows.length) {
    await SbOnline.insertMany(persistRows, {
      ordered: false,
    });
  }

  const scrapeErrors = errors.filter((e) => {
    const input = e.input || {};
    return input.sbNo && input.sbDate && input.sbLocation;
  });

  const summary = {
    fetchUsing,
    dayKey,
    batchId,
    onlyUnprocessed,
    total: items.length,
    succeeded: results.length,
    failed: scrapeErrors.length,
    skippedValidation: errors.length - scrapeErrors.length,
    rowsPerSession: effectiveRowsPerSession,
    maxSessions: effectiveMaxSessions,
  };

  const httpStatus = errors.length ? 207 : 200;

  return {
    success: errors.length === 0,
    httpStatus,
    message:
      errors.length === 0
        ? `Scraped ${items.length} shipping bill(s) and saved to database.`
        : "Scrape completed with some errors or skipped rows.",
    onlyUnprocessed,
    summary,
    data: {
      ...summary,
      timings: [
        ...results.map((r) =>
          buildRowTimingEntry({
            index: r.index,
            input: r.input,
            status: "success",
            timing: r.data?.timing || null,
          })
        ),
        ...errors.map((e) =>
          buildRowTimingEntry({
            index: e.index,
            input: e.input,
            status:
              e.input?.sbNo && e.input?.sbDate && e.input?.sbLocation
                ? "error"
                : "skipped",
            timing: e.timing || null,
            errorMessage: e.message,
          })
        ),
      ].sort((a, b) => (a.inputIndex ?? 0) - (b.inputIndex ?? 0)),
      results,
      errors,
    },
  };
}

async function scrapeShippingBill(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const result = await runScrapeShippingBillForCompany(companyId, req.body || {});
  const status = result.httpStatus || (result.success ? 200 : 207);

  if (status === 400 || status === 401) {
    return res.status(status).json({
      success: false,
      message: result.message,
    });
  }

  return res.status(status).json({
    success: result.success,
    message:
      result.message ||
      (result.success
        ? "Scrape completed."
        : "Scrape completed with some errors or skipped rows."),
    data: result.data,
  });
}

function normalizeExcelHeaderKey(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "");
}

function isSeleniumGridConnectionError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("connect econnrefused") ||
    msg.includes("127.0.0.1:4444") ||
    msg.includes("localhost:4444")
  );
}

function findExcelColumnIndex(headers, candidates) {
  const normalized = headers.map((cell) => normalizeExcelHeaderKey(cell));
  for (const c of candidates) {
    const idx = normalized.indexOf(normalizeExcelHeaderKey(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

function formatDateFromParts(year, month, day) {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeSbDateCell(raw) {
  if (raw === null || raw === undefined || raw === "") return "";

  // Excel serial date (number) -> yyyy-mm-dd
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const parsed = xlsx.SSF?.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return formatDateFromParts(parsed.y, parsed.m, parsed.d);
    }
    return String(raw).trim();
  }

  const text = String(raw).trim();
  if (!text) return "";

  // Numeric string serial date (e.g. "45961")
  if (/^\d{4,6}$/.test(text)) {
    const serial = Number(text);
    const parsed = xlsx.SSF?.parse_date_code(serial);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return formatDateFromParts(parsed.y, parsed.m, parsed.d);
    }
  }

  // Keep user-provided textual dates as-is.
  return text;
}

/**
 * Parse first sheet: expects columns for SB number, date, and location (port).
 * @returns {{ error: string|null, rows: { excelRowIndex: number, sheetRowNumber: number, sbNo: string, sbDate: string, sbLocation: string }[] }}
 */
function parseShippingBillExcelBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { error: "Missing or invalid file buffer.", rows: [] };
  }
  let wb;
  try {
    wb = xlsx.read(buffer, { type: "buffer" });
  } catch (e) {
    return {
      error: `Could not read Excel file: ${e instanceof Error ? e.message : String(e)}`,
      rows: [],
    };
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { error: "Workbook has no sheets.", rows: [] };
  const sheet = wb.Sheets[sheetName];
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!matrix.length) return { error: "Sheet is empty.", rows: [] };

  const headerRow = matrix[0].map((c) => String(c ?? "").trim());
  const sbNoIdx = findExcelColumnIndex(headerRow, [
    "sbno",
    "sb_no",
    "sbnumber",
    "shippingbillno",
    "sb no",
  ]);
  const sbDateIdx = findExcelColumnIndex(headerRow, [
    "sbdate",
    "sb_date",
    "shippingbilldate",
    "sb date",
  ]);
  const sbLocIdx = findExcelColumnIndex(headerRow, [
    "sblocation",
    "sb_location",
    "portcode",
    "port code",
    "port",
    "location",
    "sb location",
  ]);

  if (sbNoIdx < 0 || sbDateIdx < 0 || sbLocIdx < 0) {
    return {
      error:
        "Excel must have header row with sbNo, sbDate, and sbLocation (or Port Code).",
      rows: [],
    };
  }

  const rows = [];
  let excelRowIndex = 0;
  for (let r = 1; r < matrix.length; r += 1) {
    const line = matrix[r];
    if (!Array.isArray(line)) continue;
    const sbNo = String(line[sbNoIdx] ?? "").trim();
    const sbDate = normalizeSbDateCell(line[sbDateIdx]);
    const sbLocation = String(line[sbLocIdx] ?? "").trim();
    if (!sbNo && !sbDate && !sbLocation) continue;
    rows.push({
      excelRowIndex: excelRowIndex,
      sheetRowNumber: r + 1,
      sbNo,
      sbDate,
      sbLocation,
    });
    excelRowIndex += 1;
  }

  return { error: null, rows };
}

/**
 * POST /batch-process-shipping — multipart Excel (field `excel` or `file`).
 * Each scrape result is saved immediately to sbonlinebatch (not the main sbonline scrape table).
 * One uploadBatchId + batchStartedAt per request; chunked scraping via distributed runner.
 */
async function processShippingBillByDate(req, res) {
  const companyId = req.companyId;
  const body = req.body || {};
  let fetchUsing = "selenium";
  try {
    fetchUsing = resolveShippingBillFetchEngine(body);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  console.log("[batch-process-shipping] request received", {
    companyId: companyId ? String(companyId) : null,
    hasFileFieldExcel: Boolean(req?.files?.excel?.[0]),
    hasFileFieldFile: Boolean(req?.files?.file?.[0]),
    fetchUsing,
  });
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const file =
    req.file ||
    req.files?.excel?.[0] ||
    req.files?.file?.[0] ||
    null;
  if (!file?.buffer) {
    console.warn("[batch-process-shipping] missing upload file buffer");
    return res.status(400).json({
      success: false,
      message:
        "Upload an Excel file using multipart field `excel` or `file` (.xlsx).",
    });
  }

  const { error, rows: parsedRows } = parseShippingBillExcelBuffer(file.buffer);
  if (error) {
    console.warn("[batch-process-shipping] excel parse failed", {
      fileName: file?.originalname,
      error,
    });
    return res.status(400).json({ success: false, message: error });
  }
  if (!parsedRows.length) {
    console.warn("[batch-process-shipping] no parsed rows", {
      fileName: file?.originalname,
    });
    return res.status(400).json({
      success: false,
      message: "No data rows found under the header row.",
    });
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));
  const uploadBatchId = crypto.randomUUID();
  const batchStartedAt = new Date();
  const sourceFileName = String(file.originalname || "").trim() || "upload.xlsx";
  console.log("[batch-process-shipping] excel parsed", {
    sourceFileName,
    parsedRows: parsedRows.length,
    uploadBatchId,
  });

  // Session management from env:
  // - SB_MAX_SESSIONS
  // - SB_EXCEL_MAX_SESSIONS
  // - SB_ROWS_PER_SESSION
  // - SB_EXCEL_WINDOW_SIZE / SB_EXCEL_WINDOW_MULTIPLIER
  const configuredMaxSessions = Math.max(
    1,
    Number(process.env.SB_MAX_SESSIONS ?? 3) || 1
  );
  const configuredRowsPerSession = getConfiguredRowsPerSession();
  const refetchRounds = Math.max(
    0,
    Math.min(
      5,
      Number(body?.refetchRounds ?? body?.retryRounds ?? process.env.SB_REFETCH_ROUNDS ?? 0) || 0
    )
  );

  const validForScrape = [];
  let skippedValidation = 0;

  for (const row of parsedRows) {
    if (!row.sbNo || !row.sbDate || !row.sbLocation) {
      skippedValidation += 1;
      try {
        await ShippingBillExcelBatchRow.create({
          companyId: oid,
          uploadBatchId,
          batchStartedAt,
          excelRowIndex: row.excelRowIndex,
          sheetRowNumber: row.sheetRowNumber,
          sbNo: row.sbNo || "",
          sbDate: row.sbDate || "",
          sbLocation: row.sbLocation || "",
          status: "skipped",
          errorMessage: "Required: sbNo, sbDate, sbLocation",
          scrapedData: null,
          sourceFileName,
        });
      } catch (err) {
        console.error(
          "[processShippingBillByDate] skip-row save failed:",
          err
        );
      }
      continue;
    }
    validForScrape.push(row);
  }

  let succeeded = 0;
  let failed = 0;
  const processedRowsByIndex = new Map();
  let processedRows = [];
  console.log("[batch-process-shipping] validation summary", {
    uploadBatchId,
    validForScrape: validForScrape.length,
    skippedValidation,
  });

  let rowsPerSession = 1;
  let sessionsToOpen = 1;
  let executionWindowSize = 1;
  let windowsExecuted = 0;
  let roundsExecuted = 0;
  if (validForScrape.length) {
    const totalValidRows = validForScrape.length;
    const safeExcelMaxSessions =
      fetchUsing === "dricat"
        ? 1
        : getConfiguredExcelMaxSessions(totalValidRows);
    sessionsToOpen =
      fetchUsing === "dricat"
        ? 1
        : Math.max(1, Math.min(totalValidRows, safeExcelMaxSessions));
    rowsPerSession = fetchUsing === "dricat" ? 1 : configuredRowsPerSession;
    executionWindowSize =
      fetchUsing === "dricat"
        ? totalValidRows
        : getConfiguredExcelWindowSize(
            totalValidRows,
            rowsPerSession,
            sessionsToOpen
          );
    console.log("[batch-process-shipping] scrape config", {
      uploadBatchId,
      fetchUsing,
      totalValidRows,
      configuredMaxSessions,
      safeExcelMaxSessions,
      configuredRowsPerSession,
      sessionsToOpen,
      rowsPerSession,
      executionWindowSize,
      refetchRounds,
    });

    const baseItems = validForScrape.map((r) => ({
      sbNo: String(r.sbNo).trim(),
      sbDate: String(r.sbDate).trim(),
      sbLocation: String(r.sbLocation).trim(),
    }));

    async function persistScrapeRowNow(originalIndex, statusPayload) {
      const r = validForScrape[originalIndex];
      if (!r) return;

      const ok = statusPayload?.ok === true;
      const normalizedData = ok
        ? normalizeScrapedDataSectionsForStorage(statusPayload?.data ?? null)
        : null;
      const errorMessage = ok ? "" : String(statusPayload?.message || "");

      try {
        const writeRes = await ShippingBillExcelBatchRow.updateOne(
          {
            companyId: oid,
            uploadBatchId,
            excelRowIndex: r.excelRowIndex,
          },
          {
            $set: {
              companyId: oid,
              uploadBatchId,
              batchStartedAt,
              excelRowIndex: r.excelRowIndex,
              sheetRowNumber: r.sheetRowNumber,
              sbNo: String(r.sbNo).trim(),
              sbDate: String(r.sbDate).trim(),
              sbLocation: String(r.sbLocation).trim(),
              status: ok ? "success" : "error",
              errorMessage,
              scrapedData: normalizedData,
              sourceFileName,
            },
          },
          { upsert: true }
        );
        console.log("[batch-process-shipping] row saved", {
          uploadBatchId,
          excelRowIndex: r.excelRowIndex,
          sbNo: String(r.sbNo).trim(),
          status: ok ? "success" : "error",
          acknowledged: writeRes?.acknowledged,
          matchedCount: writeRes?.matchedCount,
          modifiedCount: writeRes?.modifiedCount,
          upsertedCount: writeRes?.upsertedCount,
        });
      } catch (dbErr) {
        console.error("[batch-process-shipping] row save failed", {
          uploadBatchId,
          excelRowIndex: r.excelRowIndex,
          sbNo: String(r.sbNo).trim(),
          status: ok ? "success" : "error",
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        });
        throw dbErr;
      }

      processedRowsByIndex.set(originalIndex, {
        excelRowIndex: r.excelRowIndex,
        sheetRowNumber: r.sheetRowNumber,
        sbNo: String(r.sbNo).trim(),
        sbDate: String(r.sbDate).trim(),
        sbLocation: String(r.sbLocation).trim(),
        status: ok ? "success" : "error",
        errorMessage,
        scrapedData: normalizedData,
      });
    }

    const statusByOriginalIndex = new Map();
    let pendingOriginalIndexes = validForScrape.map((_, idx) => idx);

    if (fetchUsing === "dricat") {
      const { processShippingBillRequest } = require("../../../../web_scraping/shipping_bill/dricat");
      roundsExecuted = 1;
      windowsExecuted = 1;
      for (const originalIndex of pendingOriginalIndexes) {
        try {
          const input = baseItems[originalIndex];
          const dricatResult = await processShippingBillRequest({
            location: input.sbLocation,
            sbNo: input.sbNo,
            sbDate: input.sbDate,
          });
          const payload =
            dricatResult?.ok === true
              ? { ok: true, message: "", data: dricatResult.data ?? null }
              : {
                  ok: false,
                  message: String(dricatResult?.data?.error_message || "Dricat fetch failed"),
                  data: null,
                };
          statusByOriginalIndex.set(originalIndex, payload);
          await persistScrapeRowNow(originalIndex, payload);
        } catch (err) {
          const payload = {
            ok: false,
            message: err instanceof Error ? err.message : String(err),
            data: null,
          };
          statusByOriginalIndex.set(originalIndex, payload);
          await persistScrapeRowNow(originalIndex, payload);
        }
      }
      pendingOriginalIndexes = pendingOriginalIndexes.filter((originalIndex) => {
        const st = statusByOriginalIndex.get(originalIndex);
        return !st || st.ok !== true;
      });
      console.log("[batch-process-shipping] dricat finished", {
        uploadBatchId,
        attempted: totalValidRows,
        pendingAfterRun: pendingOriginalIndexes.length,
      });
    } else {
      const { scrapeShippingBillsDistributed } = require("../../../../web_scraping/shipping_bill/main");
      for (let round = 0; round <= refetchRounds && pendingOriginalIndexes.length; round += 1) {
        roundsExecuted += 1;
        const isRefetchRound = round > 0;
        const roundRowsPerSession = rowsPerSession;
        const windowedPendingIndexes = chunkArray(
          pendingOriginalIndexes,
          executionWindowSize
        );

        for (
          let windowIndex = 0;
          windowIndex < windowedPendingIndexes.length;
          windowIndex += 1
        ) {
          const indexMap = windowedPendingIndexes[windowIndex];
          const roundItems = indexMap.map((originalIdx) => baseItems[originalIdx]);
          const roundMaxSessions = Math.max(
            1,
            Math.min(sessionsToOpen, roundItems.length)
          );

          try {
            await scrapeShippingBillsDistributed({
              items: roundItems,
              rowsPerSession: roundRowsPerSession,
              maxSessions: roundMaxSessions,
              onRowResult: async (rowResult) => {
                const originalIndex = indexMap[rowResult?.index];
                if (!Number.isInteger(originalIndex)) return;

                const payload =
                  rowResult?.ok === true
                    ? {
                        ok: true,
                        message: "",
                        data: rowResult?.data ?? null,
                      }
                    : {
                        ok: false,
                        message: String(rowResult?.message || ""),
                        data: null,
                      };

                statusByOriginalIndex.set(originalIndex, payload);
                await persistScrapeRowNow(originalIndex, payload);
              },
            });
            windowsExecuted += 1;
            console.log("[batch-process-shipping] window finished", {
              uploadBatchId,
              round: round + 1,
              window: windowIndex + 1,
              windowCount: windowedPendingIndexes.length,
              attempted: roundItems.length,
              roundRowsPerSession,
              roundMaxSessions,
            });
          } catch (err) {
            if (isSeleniumGridConnectionError(err)) {
              console.error("[batch-process-shipping] selenium grid unreachable", {
                uploadBatchId,
                error: err instanceof Error ? err.message : String(err),
              });
              return res.status(503).json({
                success: false,
                message:
                  "Selenium Grid is not reachable at http://127.0.0.1:4444. Start Selenium/Grid or set SELENIUM_GRID_URL in .env.",
                data: {
                  uploadBatchId,
                  batchStartedAt: batchStartedAt.toISOString(),
                  sourceFileName,
                  totalParsedRows: parsedRows.length,
                  skippedValidation,
                  toScrape: validForScrape.length,
                  rowsPerSession: roundRowsPerSession,
                  maxSessions: roundMaxSessions,
                  executionWindowSize,
                  refetchRounds,
                  round: round + 1,
                  window: windowIndex + 1,
                },
              });
            }
            throw err;
          }
        }

        pendingOriginalIndexes = pendingOriginalIndexes.filter((originalIndex) => {
          const st = statusByOriginalIndex.get(originalIndex);
          return !st || st.ok !== true;
        });

        console.log("[batch-process-shipping] round finished", {
          uploadBatchId,
          round: round + 1,
          isRefetchRound,
          attempted: windowedPendingIndexes.reduce(
            (sum, windowItems) => sum + windowItems.length,
            0
          ),
          pendingAfterRound: pendingOriginalIndexes.length,
        });
      }
    }

    for (let originalIndex = 0; originalIndex < validForScrape.length; originalIndex += 1) {
      const finalStatus = statusByOriginalIndex.get(originalIndex) || {
        ok: false,
        message: "No final status returned by scraper",
        data: null,
      };
      if (!processedRowsByIndex.has(originalIndex)) {
        await persistScrapeRowNow(originalIndex, finalStatus);
      }
    }

    processedRows = Array.from(processedRowsByIndex.values()).sort(
      (a, b) => (a.excelRowIndex ?? 0) - (b.excelRowIndex ?? 0)
    );
    const dbStoredRows = await ShippingBillExcelBatchRow.countDocuments({
      companyId: oid,
      uploadBatchId,
    });
    succeeded = processedRows.filter((r) => r.status === "success").length;
    failed = processedRows.filter((r) => r.status === "error").length;
    console.log("[batch-process-shipping] scrape finished", {
      uploadBatchId,
      succeeded,
      failed,
      roundsExecuted,
      windowsExecuted,
      dbStoredRows,
    });
  }

  const httpStatus =
    skippedValidation || failed ? 207 : 200;

  return res.status(httpStatus).json({
    success: skippedValidation === 0 && failed === 0,
    message:
      skippedValidation || failed
        ? "Batch finished with some skipped or failed rows; each row was saved to sbonlinebatch as it completed."
        : "Batch completed; each row saved to sbonlinebatch.",
    data: {
      fetchUsing,
      collection: "sbonlinebatch",
      uploadBatchId,
      batchStartedAt: batchStartedAt.toISOString(),
      sourceFileName,
      totalParsedRows: parsedRows.length,
      skippedValidation,
      toScrape: validForScrape.length,
      succeeded,
      failed,
      rowsPerSession,
      maxSessions: sessionsToOpen,
      executionWindowSize,
      refetchRounds,
      roundsExecuted,
      windowsExecuted,
      processedRows,
    },
  });
}

/** GET /batch-process-shipping-batches — list uploaded Excel batch summaries. */
async function listShippingBillExcelBatches(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));
  const batches = await ShippingBillExcelBatchRow.aggregate([
    { $match: { companyId: oid } },
    {
      $group: {
        _id: "$uploadBatchId",
        batchStartedAt: { $max: "$batchStartedAt" },
        sourceFileName: { $max: "$sourceFileName" },
        totalRows: { $sum: 1 },
        successCount: {
          $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
        },
        errorCount: {
          $sum: { $cond: [{ $eq: ["$status", "error"] }, 1, 0] },
        },
        skippedCount: {
          $sum: { $cond: [{ $eq: ["$status", "skipped"] }, 1, 0] },
        },
      },
    },
    { $sort: { batchStartedAt: -1 } },
    {
      $project: {
        _id: 0,
        batchId: "$_id",
        batchStartedAt: 1,
        sourceFileName: 1,
        totalRows: 1,
        successCount: 1,
        errorCount: 1,
        skippedCount: 1,
      },
    },
  ]);

  return res.status(200).json({
    success: true,
    collection: "sbonlinebatch",
    count: batches.length,
    batches,
  });
}

/** GET /batch-process-shipping-batch-detail?id=<batchId> — all rows for one upload batch. */
async function getShippingBillExcelBatchDetail(req, res) {
  const companyId = req.companyId;
  const batchId = String(req.query.id ?? req.query.batchId ?? "").trim();
  const rowsPerSession = getConfiguredRowsPerSession();
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }
  if (!batchId) {
    return res.status(400).json({
      success: false,
      message: "Query parameter `id` (or `batchId`) is required.",
    });
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));
  const rows = await ShippingBillExcelBatchRow.find({
    companyId: oid,
    uploadBatchId: batchId,
  })
    .sort({ excelRowIndex: 1, createdAt: 1 })
    .lean();

  if (!rows.length) {
    return res.status(404).json({
      success: false,
      message: "No batch rows found for this batch id.",
    });
  }

  /** One row per unique shipping bill (SB No + date + port); prefer latest success, else latest row */
  const byShipKey = new Map();
  for (const r of rows) {
    const baseKey = makeShippingBillKey(r.sbNo, r.sbDate, r.sbLocation);
    const shipKey =
      baseKey && baseKey !== "||" ? baseKey : `__id:${String(r._id)}`;
    const prev = byShipKey.get(shipKey);
    if (!prev) {
      byShipKey.set(shipKey, r);
      continue;
    }
    const prevSuccess = prev.status === "success";
    const curSuccess = r.status === "success";
    if (curSuccess && !prevSuccess) {
      byShipKey.set(shipKey, r);
    } else if (prevSuccess === curSuccess) {
      const tPrev = new Date(prev.createdAt || 0).getTime();
      const tCur = new Date(r.createdAt || 0).getTime();
      if (tCur >= tPrev) byShipKey.set(shipKey, r);
    }
  }

  const deduped = [...byShipKey.values()].sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return ta - tb;
  });

  const out = deduped.map((r) => ({
    id: r._id?.toString(),
    companyId: String(r.companyId),
    dayKey: "",
    batchId: r.uploadBatchId,
    sbNo: r.sbNo,
    sbDate: r.sbDate,
    sbLocation: r.sbLocation,
    status: r.status,
    errorMessage: r.errorMessage,
    scrapedData: r.scrapedData,
    inputIndex: r.excelRowIndex,
    batchStartedAt: r.batchStartedAt,
    sourceFileName: r.sourceFileName,
    excelRowIndex: r.excelRowIndex,
    sheetRowNumber: r.sheetRowNumber,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  const successCount = out.filter((r) => r.status === "success").length;
  const errorCount = out.filter((r) => r.status === "error").length;
  const skippedCount = out.filter((r) => r.status === "skipped").length;

  return res.status(200).json({
    success: true,
    batchId,
    rowsPerSession,
    count: out.length,
    totalRecordsBeforeDedupe: rows.length,
    batchStartedAt: out[0]?.batchStartedAt || null,
    sourceFileName: out[0]?.sourceFileName || "",
    totalRows: out.length,
    successCount,
    errorCount,
    skippedCount,
    rows: out,
  });
}

/**
 * GET /get-count-of-unfetched-shipping-bills
 * Counts unique SB triples in shippingbillno that are not yet successful in sbonline.
 */
async function getCountOfUnfetchedShippingBills(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const registered = await loadPendingFromShippingBillNo(companyId);
  const successKeys = await loadSuccessfulShippingBillKeys(companyId);

  const unfetched = registered.filter(
    (it) =>
      it.sbNo &&
      it.sbDate &&
      it.sbLocation &&
      !successKeys.has(makeShippingBillKey(it.sbNo, it.sbDate, it.sbLocation))
  );

  return res.status(200).json({
    success: true,
    collection: "sbonline",
    registeredCount: registered.length,
    fetchedSuccessCount: successKeys.size,
    unfetchedCount: unfetched.length,
    message:
      unfetched.length > 0
        ? `${unfetched.length} shipping bill(s) registered from PDFs but not yet fetched successfully in sbonline.`
        : "All registered shipping bills have a successful sbonline record.",
  });
}

module.exports = {
  getSbOnlineDates,
  getShippingBillDateWiseDetail,
  searchShippingBillsBySbNo,
  scrapeShippingBill,
  runScrapeShippingBillForCompany,
  processRandomTenShippingBills,
  processShippingBillByDate,
  listShippingBillExcelBatches,
  getShippingBillExcelBatchDetail,
  getCountOfUnfetchedShippingBills,
};
