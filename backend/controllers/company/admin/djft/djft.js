const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { runDgftScrapeBatch } = require("../../../../web_scraping/djft/main");
const { fetchcookie: runDgftDricatBatch } = require("../../../../web_scraping/djft/dricat/token_scraping");
const { fetchDgftData } = require("../../../../web_scraping/djft/dricat/main");
const {
  resolveDgftSessionForApi,
  clearDgftSession,
} = require("../../../../web_scraping/djft/dricat/dgft_session");
const { DgftProcess } = require("#utils/dgftProcess");
const { DgftBatch } = require("#utils/dgftBatch");
const {
  getStoredDgftCredentials,
} = require("#utils/dgftCredentials");
const { makeShippingBillKey } = require("#utils/sbOnline");
const {
  listUniqueShippingBills,
  findShippingBillNoId,
  isDgftMarkedTrue,
  ShippingBillNo,
} = require("#utils/shippingBillNo");

function toCompanyObjectId(companyId) {
  const s = String(companyId ?? "").trim();
  return mongoose.isValidObjectId(s) ? new mongoose.Types.ObjectId(s) : null;
}

/** Normalize sbNo for comparison (trim; strip leading zeros on numeric ids). */
function normalizeSbNoForMatch(sbNo) {
  const s = String(sbNo ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) {
    const stripped = s.replace(/^0+/, "");
    return stripped || "0";
  }
  return s.toUpperCase();
}

function extractSbNoFromDgftDoc(doc) {
  if (!doc || typeof doc !== "object") return "";

  const inp = doc.input;
  if (inp && typeof inp === "object") {
    const fromInput = String(inp.sbNumber ?? inp.sbNo ?? "").trim();
    if (fromInput) return fromInput;
  }

  const scraped = doc.scrapedData;
  if (scraped && typeof scraped === "object") {
    const tableRows = Array.isArray(scraped.tableRows) ? scraped.tableRows : [];
    for (const row of tableRows) {
      if (!row || typeof row !== "object") continue;
      const n = String(
        row["Shipping Bill Number"] ?? row.sbNumber ?? row.sbNo ?? ""
      ).trim();
      if (n) return n;
    }
    const brcRows = Array.isArray(scraped.brcResponse?.data)
      ? scraped.brcResponse.data
      : [];
    for (const row of brcRows) {
      if (!row || typeof row !== "object") continue;
      const n = String(row.sbNumber ?? row.sbNo ?? "").trim();
      if (n) return n;
    }
  }

  return "";
}

/** Request body overrides, else per-company DB (`configure.dgft`), else env. */
async function resolveDgftAuth(companyId, body = {}) {
  const u = body.username ?? body.id ?? body.userId ?? "";
  const p = body.password ?? "";
  if (String(u).trim() && String(p).length) {
    return { username: String(u).trim(), password: String(p) };
  }
  const stored = await getStoredDgftCredentials(companyId);
  if (stored) return stored;
  const envUser = String(process.env.DGFT_USERNAME ?? process.env.DGFT_USER_ID ?? "").trim();
  const envPass = String(process.env.DGFT_PASSWORD ?? "");
  if (envUser && envPass) return { username: envUser, password: envPass };
  return null;
}

const DGFT_ROWS_PER_SESSION_CAP = 100;

/** Env `DGFT_ROWS_PER_SESSION` (default 5): shipping bills per Selenium session. */
function getDgftRowsPerSession() {
  const n = Number(process.env.DGFT_ROWS_PER_SESSION ?? 5);
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(Math.floor(n), DGFT_ROWS_PER_SESSION_CAP);
}

function chunkArray(items, size) {
  const out = [];
  const step = Math.max(1, size);
  for (let i = 0; i < items.length; i += step) {
    out.push(items.slice(i, i + step));
  }
  return out;
}

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

function formatDateFromParts(year, month, day) {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Parse shipping-bill date to ISO `YYYY-MM-DD`; empty if unrecognized. */
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

/** Stable date string for `makeShippingBillKey` (ISO when parseable, else raw). */
function canonicalSbDateForKey(raw) {
  const iso = normalizeSbDateToIso(raw);
  if (iso) return iso;
  return String(raw ?? "").trim();
}

/** DGFT date field expects `DD/MM/YYYY` (e.g. `04/03/2026` from `04-MAR-26`). */
function formatSbDateDdMmYyyy(raw) {
  const iso = normalizeSbDateToIso(raw);
  if (!iso) {
    return String(raw ?? "").trim();
  }
  const [y, m, d] = iso.split("-").map(Number);
  return `${pad2(d)}/${pad2(m)}/${y}`;
}

/**
 * Unique registered SBs from `shippingbillno` (PDF upload), for DGFT random / only-unprocessed queues.
 */
async function loadUniqueShippingBillsFromShippingBillNo(companyId) {
  const rows = await listUniqueShippingBills(companyId);
  return rows.map((r) => ({
    shippingBillNoId: r._id,
    sbNo: r.sbNo,
    sbDate: canonicalSbDateForKey(r.sbDate),
    sbLocation: String(r.portCode ?? "").trim(),
    dgft: r.dgft,
  }));
}

/**
 * SB numbers with at least one successful DGFT row (dgftprocess / dgftbatch).
 * Match basis: sbNo only. Reads input.sbNumber/sbNo, scrapedData, and shippingBillNo registry ref.
 */
async function loadSuccessfulDgftSbNos(companyId, models = [DgftProcess]) {
  const oid = toCompanyObjectId(companyId);
  if (!oid) return { sbNos: new Set(), debug: { successDocCount: 0 } };

  const list = Array.isArray(models) && models.length ? models : [DgftProcess];
  const sbNos = new Set();
  let successDocCount = 0;
  let fromDocFieldsCount = 0;
  let fromRegistryRefCount = 0;
  const registryIds = new Set();

  for (const Model of list) {
    if (!Model) continue;
    const docs = await Model.find({
      companyId: oid,
      status: "success",
    })
      .select({ input: 1, shippingBillNo: 1, scrapedData: 1 })
      .lean();

    successDocCount += docs.length;

    for (const d of docs) {
      const sbFromDoc = extractSbNoFromDgftDoc(d);
      if (sbFromDoc) {
        sbNos.add(normalizeSbNoForMatch(sbFromDoc));
        fromDocFieldsCount += 1;
      }

      if (d.shippingBillNo) {
        registryIds.add(String(d.shippingBillNo));
      }
    }
  }

  if (registryIds.size) {
    const registryDocs = await ShippingBillNo.find({
      companyId: oid,
      _id: { $in: [...registryIds] },
    })
      .select({ sbNo: 1 })
      .lean();
    for (const r of registryDocs) {
      const sbNo = String(r.sbNo ?? "").trim();
      if (sbNo) {
        sbNos.add(normalizeSbNoForMatch(sbNo));
        fromRegistryRefCount += 1;
      }
    }
  }

  return {
    sbNos,
    debug: {
      successDocCount,
      fromDocFieldsCount,
      fromRegistryRefCount,
      uniqueFetchedSbNoCount: sbNos.size,
    },
  };
}

/**
 * Success triple keys (port + sbNumber + sbDate) from one or more DGFT storage models.
 * Default: `dgftprocess` only. Pass `[DgftProcess, DgftBatch]` to treat either store as "done".
 */
function inputKeyFromDgftInput(input) {
  const port = String(input?.port ?? "").trim();
  const sbNumber = String(input?.sbNumber ?? input?.sbNo ?? "").trim();
  const sbDate = canonicalSbDateForKey(input?.sbDate);
  if (!port || !sbNumber || !sbDate) return "";
  return makeShippingBillKey(sbNumber, sbDate, port);
}

function isDgftFetchFailedStatus(status, errorMessage = "") {
  const s = String(status ?? "").trim();
  if (s === "success") return false;
  if (s === "error" || s === "no_data") return true;
  if (/no brc number found/i.test(s)) return true;
  return /no brc number found/i.test(String(errorMessage ?? ""));
}

async function loadDgftInputKeysByStatusFilter(companyId, models, statusFilter) {
  const oid = toCompanyObjectId(companyId);
  if (!oid) return new Set();

  const list = Array.isArray(models) && models.length ? models : [DgftProcess];
  const keys = new Set();
  for (const Model of list) {
    if (!Model) continue;
    const query = { companyId: oid };
    if (statusFilter === "success") {
      query.status = "success";
    } else if (statusFilter === "failed") {
      query.status = { $ne: "success" };
    }
    const docs = await Model.find(query).select({ input: 1, status: 1, errorMessage: 1 }).lean();
    for (const d of docs) {
      if (statusFilter === "failed" && !isDgftFetchFailedStatus(d.status, d.errorMessage)) {
        continue;
      }
      const key = inputKeyFromDgftInput(d.input || {});
      if (key) keys.add(key);
    }
  }
  return keys;
}

async function loadSuccessfulDgftInputKeys(companyId, models = [DgftProcess]) {
  return loadDgftInputKeysByStatusFilter(companyId, models, "success");
}

async function loadFailedDgftInputKeys(companyId, models = [DgftProcess, DgftBatch]) {
  return loadDgftInputKeysByStatusFilter(companyId, models, "failed");
}

/** Normalized sbNos with any dgftprocess/dgftbatch row (any status). */
async function loadAttemptedDgftSbNos(companyId, models = [DgftProcess, DgftBatch]) {
  const oid = toCompanyObjectId(companyId);
  const sbNos = new Set();
  if (!oid) return sbNos;

  const list = Array.isArray(models) && models.length ? models : [DgftProcess];
  for (const Model of list) {
    if (!Model) continue;
    const docs = await Model.find({ companyId: oid })
      .select({ input: 1, shippingBillNo: 1, scrapedData: 1 })
      .lean();
    for (const d of docs) {
      const sbNo = normalizeSbNoForMatch(extractSbNoFromDgftDoc(d));
      if (sbNo) sbNos.add(sbNo);
    }
  }
  return sbNos;
}

/** Normalized sbNos with failed dgft row (error / no_data / No BRC number found). */
async function loadFailedDgftSbNos(companyId, models = [DgftProcess, DgftBatch]) {
  const oid = toCompanyObjectId(companyId);
  const sbNos = new Set();
  if (!oid) return sbNos;

  const list = Array.isArray(models) && models.length ? models : [DgftProcess];
  for (const Model of list) {
    if (!Model) continue;
    const docs = await Model.find({ companyId: oid })
      .select({ input: 1, status: 1, errorMessage: 1, shippingBillNo: 1, scrapedData: 1 })
      .lean();
    for (const d of docs) {
      if (!isDgftFetchFailedStatus(d.status, d.errorMessage)) continue;
      const sbNo = normalizeSbNoForMatch(extractSbNoFromDgftDoc(d));
      if (sbNo) sbNos.add(sbNo);
    }
  }
  return sbNos;
}

async function loadSuccessfulDgftShippingBillNoRefs(companyId, models = [DgftProcess, DgftBatch]) {
  const oid = toCompanyObjectId(companyId);
  const refs = new Set();
  if (!oid) return refs;

  const list = Array.isArray(models) && models.length ? models : [DgftProcess];
  for (const Model of list) {
    if (!Model) continue;
    const docs = await Model.find({
      companyId: oid,
      status: "success",
      shippingBillNo: { $ne: null },
    })
      .select({ shippingBillNo: 1 })
      .lean();
    for (const d of docs) {
      if (d.shippingBillNo) refs.add(String(d.shippingBillNo));
    }
  }
  return refs;
}

function dgftDedupeKeyFromParts({ shippingBillNoRef, input }) {
  const refRaw =
    shippingBillNoRef ??
    input?.shippingBillNoId ??
    input?.shippingBillNo ??
    "";
  const refStr = String(refRaw ?? "").trim();
  if (mongoose.isValidObjectId(refStr)) return `sbref:${refStr}`;
  return inputKeyFromDgftInput(input || {});
}

function dgftDedupeKeyFromDoc(doc) {
  return dgftDedupeKeyFromParts({
    shippingBillNoRef: doc?.shippingBillNo,
    input: doc?.input,
  });
}

function existingDocKeeperScore(entry) {
  if (!entry) return -1;
  if (entry.status === "success") return 1_000;
  if (!entry.failed) return 100;
  return 1;
}

function pickExistingDocEntry(prev, entry) {
  const prevScore = existingDocKeeperScore(prev);
  const entryScore = existingDocKeeperScore(entry);
  if (entryScore !== prevScore) return entryScore > prevScore ? entry : prev;
  return entry;
}

/** Latest dgftprocess/dgftbatch row per shippingBillNo ref or port+sb+date. */
async function loadExistingDgftDocsByInputKey(companyId, models = [DgftProcess, DgftBatch]) {
  const oid = toCompanyObjectId(companyId);
  const map = new Map();
  if (!oid) return map;

  const list = Array.isArray(models) && models.length ? models : [DgftProcess];
  for (const Model of list) {
    if (!Model) continue;
    const docs = await Model.find({ companyId: oid })
      .select({
        _id: 1,
        input: 1,
        status: 1,
        batchId: 1,
        inputIndex: 1,
        createdAt: 1,
        errorMessage: 1,
        shippingBillNo: 1,
      })
      .sort({ createdAt: -1 })
      .lean();
    for (const d of docs) {
      const entry = {
        _id: d._id,
        Model,
        batchId: d.batchId,
        inputIndex: d.inputIndex,
        status: d.status,
        failed: isDgftFetchFailedStatus(d.status, d.errorMessage),
      };
      const keys = new Set();
      const dedupeKey = dgftDedupeKeyFromDoc(d);
      if (dedupeKey) keys.add(dedupeKey);
      const inputKey = inputKeyFromDgftInput(d.input || {});
      if (inputKey) keys.add(`input:${inputKey}`);

      for (const key of keys) {
        const prev = map.get(key);
        map.set(key, prev ? pickExistingDocEntry(prev, entry) : entry);
      }
    }
  }
  return map;
}

function isRetryableDgftSessionError(error) {
  const msg = String(error?.message || "");
  return (
    /failed with HTTP (403|404|401)/i.test(msg) ||
    /Could not find _csrf token/i.test(msg) ||
    /session validation failed/i.test(msg)
  );
}

/** Cached DGFT session first; fresh Selenium login only when cache is invalid (same as eBRC bulk download). */
async function resolveDgftDricatSessionWithRetry(options = {}) {
  const attempts =
    options.forceRefresh === true
      ? [{ ...options, forceRefresh: true }]
      : [
          { ...options, forceRefresh: false },
          { ...options, forceRefresh: true },
        ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const session = await resolveDgftSessionForApi({
        companyId: attempt.companyId,
        username: attempt.username,
        password: attempt.password,
        maxLoginRetries: attempt.maxLoginRetries,
        seleniumGridUrl: attempt.seleniumGridUrl,
        forceRefresh: attempt.forceRefresh === true,
      });
      return {
        cookies: session.cookies,
        sessionFromCache: session.fromCache === true,
        sessionRefreshed: session.refreshed === true,
      };
    } catch (error) {
      lastError = error;
      if (attempt.companyId) {
        await clearDgftSession(attempt.companyId);
      }
      if (attempt.forceRefresh === true || !isRetryableDgftSessionError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("DGFT session resolution failed.");
}

/** Fresh Selenium login cookies — same path as POST /process (dricat). */
async function loginDricatCookies(companyId, auth, body = {}) {
  const tokenData = await runDgftDricatBatch({
    companyId: String(companyId),
    username: auth.username,
    password: auth.password,
    maxLoginRetries: body.maxLoginRetries,
    seleniumGridUrl: body.seleniumGridUrl,
    cloudOnly: body.cloudOnly !== false,
  });
  return Array.isArray(tokenData?.cookies) ? tokenData.cookies : [];
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dedupePendingBySbNo(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeSbNoForMatch(row.sbNo);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, row);
    }
  }
  return [...map.values()];
}

function pickUniquePendingSample(pending, sampleSize) {
  const shuffled = shuffleArray(pending);
  const picked = [];
  const seenSbNos = new Set();
  for (const row of shuffled) {
    const key = normalizeSbNoForMatch(row.sbNo);
    if (!key || seenSbNos.has(key)) continue;
    seenSbNos.add(key);
    picked.push(row);
    if (picked.length >= sampleSize) break;
  }
  return picked;
}

/**
 * Pending `shippingbillno` rows with dgft=true not yet successful in dgftprocess/dgftbatch.
 * One row per unique sbNo; skips sbNos already fetched successfully (sbNo match).
 */
async function loadPendingDgftMarkedShippingBills(companyId) {
  let pending = await loadUniqueShippingBillsFromShippingBillNo(companyId);
  pending = pending.filter(
    (it) => it.sbNo && it.sbDate && it.sbLocation && isDgftMarkedTrue(it.dgft)
  );

  const { sbNos: fetchedSuccessSbNos } = await loadSuccessfulDgftSbNos(companyId, [
    DgftProcess,
    DgftBatch,
  ]);
  const successKeys = await loadSuccessfulDgftInputKeys(companyId, [DgftProcess, DgftBatch]);
  const successShippingBillNoRefs = await loadSuccessfulDgftShippingBillNoRefs(companyId, [
    DgftProcess,
    DgftBatch,
  ]);
  const failedKeys = await loadFailedDgftInputKeys(companyId, [DgftProcess, DgftBatch]);
  pending = pending.filter((it) => {
    const sbNo = normalizeSbNoForMatch(it.sbNo);
    if (!sbNo) return false;
    if (fetchedSuccessSbNos.has(sbNo)) return false;
    const sbRef = String(it.shippingBillNoId ?? "");
    if (sbRef && successShippingBillNoRefs.has(sbRef)) return false;
    return !successKeys.has(makeShippingBillKey(it.sbNo, it.sbDate, it.sbLocation));
  });

  pending = dedupePendingBySbNo(pending);

  pending.sort((a, b) => {
    const aFailed = failedKeys.has(makeShippingBillKey(a.sbNo, a.sbDate, a.sbLocation)) ? 1 : 0;
    const bFailed = failedKeys.has(makeShippingBillKey(b.sbNo, b.sbDate, b.sbLocation)) ? 1 : 0;
    return bFailed - aFailed;
  });

  return pending;
}

function mapPendingShippingBillsToDgftInputs(pending) {
  return pending.map((it) => ({
    port: String(it.sbLocation).trim(),
    sbNumber: String(it.sbNo).trim(),
    sbDate: formatSbDateDdMmYyyy(it.sbDate),
    shippingBillNoId: String(it.shippingBillNoId),
  }));
}

/**
 * Run DGFT fetch for a list of inputs (dricat or selenium). Persists to dgftprocess.
 */
async function runDgftInputsBatch(companyId, inputs, options = {}) {
  const { fetchUsing, auth, body = {}, pendingPoolSize = inputs.length } = options;
  const existingDocsByInputKey = await loadExistingDgftDocsByInputKey(companyId, [DgftProcess]);
  const persistOpts = { Model: DgftProcess, existingDocsByInputKey };

  if (fetchUsing === "dricat") {
    const dricatMeta = {
      batchId: new mongoose.Types.ObjectId().toString(),
      dayKey: new Date().toISOString().slice(0, 10),
      s3Bucket: "",
      s3PdfKeyPrefix: "",
      outputDir: "",
      pdfDir: "",
      resultJsonPath: "",
    };
    let workingCookies = await loginDricatCookies(companyId, auth, body);
    const dricatRows = [];
    for (let i = 0; i < inputs.length; i += 1) {
      const input = inputs[i] || {};
      try {
        const rowData = await fetchDgftData({
          companyId: String(companyId),
          sbNumber: input.sbNumber,
          sbDate: input.sbDate,
          portName: input.port,
          cookies: workingCookies,
        });
        workingCookies = Array.isArray(rowData?.cookies) ? rowData.cookies : workingCookies;
        const rowErrorMessage =
          rowData?.ok === true
            ? ""
            : String(
                rowData?.body?.message ||
                  rowData?.message ||
                  (typeof rowData?.status === "string" ? rowData.status : "") ||
                  "DGFT dricat fetch failed."
              );
        const rowStatus =
          rowData?.ok === true
            ? "success"
            : /no brc number found/i.test(rowErrorMessage)
              ? "No BRC number found"
              : "error";
        const dricatRow = {
          inputIndex: i,
          input,
          iecNo: rowData?.iecNo || "",
          iecNumber:
            rowData?.iecNumber != null && Number.isFinite(Number(rowData.iecNumber))
              ? Number(rowData.iecNumber)
              : null,
          portPreview: rowData?.portPreview || [],
          tableRows: Array.isArray(rowData?.tableRows) ? rowData.tableRows : [],
          brcResponse: rowData?.brcResponse || null,
          brcNumbers: Array.isArray(rowData?.brcNumbers) ? rowData.brcNumbers : [],
          brcDetailsResponses: Array.isArray(rowData?.brcDetailsResponses)
            ? rowData.brcDetailsResponses
            : [],
          ok: rowData?.ok === true,
          errorMessage: rowErrorMessage,
        };
        dricatRows.push(dricatRow);
        await persistDgftRow(
          companyId,
          dricatMeta,
          {
            input,
            status: rowStatus,
            errorMessage: rowErrorMessage,
            scrapedData: buildDricatScrapedData(companyId, dricatMeta.batchId, dricatRow),
          },
          i,
          persistOpts
        );
      } catch (error) {
        const rowErrorMessage = error instanceof Error ? error.message : String(error);
        const dricatRow = {
          inputIndex: i,
          input,
          iecNo: "",
          iecNumber: null,
          portPreview: [],
          tableRows: [],
          brcResponse: null,
          brcNumbers: [],
          brcDetailsResponses: [],
          ok: false,
          errorMessage: rowErrorMessage,
        };
        dricatRows.push(dricatRow);
        await persistDgftRow(
          companyId,
          dricatMeta,
          {
            input,
            status: "error",
            errorMessage: rowErrorMessage,
            scrapedData: buildDricatScrapedData(companyId, dricatMeta.batchId, dricatRow),
          },
          i,
          persistOpts
        );
      }
    }

    return {
      collection: "dgftprocess",
      fetchUsing,
      sessionFromCache: false,
      sessionRefreshed: true,
      cookies: workingCookies,
      iecNo: dricatRows[0]?.iecNo || "",
      iecNumber:
        dricatRows[0]?.iecNumber != null && Number.isFinite(Number(dricatRows[0].iecNumber))
          ? Number(dricatRows[0].iecNumber)
          : null,
      brcResponse: dricatRows[0]?.brcResponse || null,
      brcNumbers: Array.isArray(dricatRows[0]?.brcNumbers) ? dricatRows[0].brcNumbers : [],
      brcDetailsResponses: Array.isArray(dricatRows[0]?.brcDetailsResponses)
        ? dricatRows[0].brcDetailsResponses
        : [],
      rows: dricatRows,
      processedCount: inputs.length,
      pendingPoolSize,
      successCount: dricatRows.filter((r) => r.ok === true).length,
      errorCount: dricatRows.filter((r) => r.ok !== true).length,
      inputs,
    };
  }

  const data = await runDgftScrapeChunked({
    companyId,
    inputs,
    auth,
    body,
    persistCompanyId: companyId,
    persistModel: DgftProcess,
    persistOptions: persistOpts,
  });

  return {
    collection: "dgftprocess",
    fetchUsing,
    ...data,
    processedCount: inputs.length,
    pendingPoolSize,
    inputs,
  };
}

/**
 * Process all pending shippingbillno rows where dgft=true (automation + API).
 */
async function runProcessAllDgftMarkedForCompany(companyId, options = {}) {
  const body = { ...(options.body || {}) };
  if (options.fetchUsing) {
    body.fetchUsing = options.fetchUsing;
  }

  let fetchUsing = "dricat";
  try {
    fetchUsing = resolveDgftFetchEngine(body);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Invalid fetchUsing value.",
    };
  }

  const pending = await loadPendingDgftMarkedShippingBills(companyId);
  const pendingPoolSize = pending.length;
  const inputs = mapPendingShippingBillsToDgftInputs(pending);

  if (!inputs.length) {
    const summary = { fetchUsing, pendingPoolSize: 0, processedCount: 0, empty: true };
    if (options.treatEmptyAsSuccess) {
      return {
        success: true,
        message: "No pending shipping bills with dgft=true to process.",
        summary,
      };
    }
    return {
      success: false,
      message:
        "No pending shipping bills for DGFT. Requires shippingbillno.dgft=true (from eBRC bulk download) and not yet succeeded in dgftprocess/dgftbatch.",
      summary,
    };
  }

  const auth = await resolveDgftAuth(companyId, body);
  if (!auth) {
    return {
      success: false,
      message:
        "DGFT credentials missing: call POST /api/company/admin/configure/dgft/add-id-pass with id and password, or set DGFT_USERNAME and DGFT_PASSWORD.",
    };
  }

  try {
    const data = await runDgftInputsBatch(companyId, inputs, {
      fetchUsing,
      auth,
      body,
      pendingPoolSize,
    });
    const summary = {
      fetchUsing,
      pendingPoolSize,
      processedCount: inputs.length,
      successCount: data.successCount ?? 0,
      errorCount: data.errorCount ?? 0,
      sessionCount: data.sessionCount ?? 1,
    };
    return {
      success: true,
      message: `DGFT completed for ${inputs.length} dgft=true shipping bill(s).`,
      data,
      summary,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "DGFT batch failed.",
    };
  }
}

async function processAllDgftMarkedShippingBills(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const result = await runProcessAllDgftMarkedForCompany(companyId, {
    body: req.body || {},
  });

  if (!result.success) {
    const status =
      /credentials missing|No pending|Invalid fetchUsing/i.test(result.message) ? 400 : 500;
    return res.status(status).json({
      success: false,
      message: result.message,
      summary: result.summary ?? null,
    });
  }

  return res.status(200).json({
    success: true,
    message: result.message,
    data: result.data,
    summary: result.summary ?? null,
  });
}

function normalizeBodyInputs(body = {}) {
  const mapRow = (row) => {
    const o = {
      port: row.port || row.portCode || row.sbLocation,
      sbNumber: row.sbNumber || row.sbNo,
      sbDate: formatSbDateDdMmYyyy(row.sbDate),
    };
    if (row.shippingBillNoId != null && row.shippingBillNoId !== "") {
      o.shippingBillNoId = String(row.shippingBillNoId);
    }
    return o;
  };
  if (Array.isArray(body.inputs)) {
    return body.inputs.map(mapRow);
  }
  if (body.port || body.sbNumber || body.sbNo) {
    return [
      mapRow({
        port: body.port || body.portCode || body.sbLocation,
        sbNumber: body.sbNumber || body.sbNo,
        sbDate: body.sbDate,
        shippingBillNoId: body.shippingBillNoId,
      }),
    ];
  }
  return [];
}

function shippingBillNoRefFromInput(input) {
  if (!input || typeof input !== "object") return null;
  const raw = input.shippingBillNoId ?? input.shippingBillNo;
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  return mongoose.isValidObjectId(s) ? new mongoose.Types.ObjectId(s) : null;
}

function normalizeInputForStorage(input, options = {}) {
  if (!input || typeof input !== "object") return {};
  const port = String(input.port ?? "").trim();
  const sbNumber = String(input.sbNumber ?? "").trim();
  const sbDate = String(input.sbDate ?? "").trim();
  if (options.linkShippingBillNo === false) {
    return { port, sbNumber, sbDate };
  }
  const sid =
    input.shippingBillNoId != null && input.shippingBillNoId !== ""
      ? String(input.shippingBillNoId)
      : "";
  return sid
    ? { port, sbNumber, sbDate, shippingBillNoId: sid }
    : { port, sbNumber, sbDate };
}

function resolveDgftFetchEngine(body = {}) {
  const requested = String(body.fetchUsing ?? body.engine ?? body.mode ?? "")
    .trim()
    .toLowerCase();
  if (!requested || requested === "selenium") return "selenium";
  if (requested === "dricat") return "dricat";
  throw new Error("Invalid fetchUsing value. Allowed: selenium, dricat");
}

function buildDricatScrapedData(companyId, batchId, rowData) {
  const brcResponse =
    rowData?.brcResponse && typeof rowData.brcResponse === "object"
      ? { ...rowData.brcResponse }
      : null;
  const body =
    brcResponse?.body && typeof brcResponse.body === "object" ? brcResponse.body : null;

  if (brcResponse && Array.isArray(body?.data)) {
    brcResponse.data = body.data;
  }
  if (brcResponse && Object.prototype.hasOwnProperty.call(brcResponse, "body")) {
    delete brcResponse.body;
  }

  return {
    companyId: String(companyId),
    batchId: batchId || "",
    ok: rowData?.ok === true,
    iecNo: rowData?.iecNo || "",
    iecNumber:
      rowData?.iecNumber != null && Number.isFinite(Number(rowData.iecNumber))
        ? Number(rowData.iecNumber)
        : null,
    tableRows: Array.isArray(rowData?.tableRows) ? rowData.tableRows : [],
    brcResponse,
  };
}

async function persistDgftRow(companyId, meta, rowResult, inputIndex, options = {}) {
  const { Model = DgftProcess, existingDocsByInputKey } = options;
  const refId =
    options.linkShippingBillNo === false
      ? null
      : shippingBillNoRefFromInput(rowResult?.input) || null;
  const lookupKeys = [];
  if (refId) lookupKeys.push(`sbref:${String(refId)}`);
  const inputKey = inputKeyFromDgftInput(rowResult?.input);
  if (inputKey) lookupKeys.push(`input:${inputKey}`);
  let existing = null;
  for (const key of lookupKeys) {
    const hit = existingDocsByInputKey?.get(key);
    if (hit) {
      existing = hit;
      break;
    }
  }

  const setFields = {
    dayKey: meta.dayKey,
    input: normalizeInputForStorage(rowResult?.input, options),
    shippingBillNo: refId,
    status: rowResult.status || "error",
    errorMessage: rowResult.errorMessage || "",
    scrapedData:
      rowResult.scrapedData && typeof rowResult.scrapedData === "object"
        ? rowResult.scrapedData
        : {
            companyId: String(companyId),
            batchId: meta.batchId || "",
            tableRows: rowResult.tableRows || [],
          },
    output: {
      s3Bucket: meta.s3Bucket || "",
      s3PdfKeyPrefix: meta.s3PdfKeyPrefix || "",
      outputDir: meta.outputDir || "",
      pdfDir: meta.pdfDir || "",
      resultJsonPath: meta.resultJsonPath || "",
    },
  };

  if (existing?._id) {
    await existing.Model.updateOne({ _id: existing._id, companyId }, { $set: setFields });
    return;
  }

  await Model.updateOne(
    {
      companyId,
      batchId: meta.batchId,
      inputIndex,
    },
    {
      $set: setFields,
      $setOnInsert: {
        companyId,
        batchId: meta.batchId,
        inputIndex,
      },
    },
    { upsert: true }
  );
}

async function persistDgftBatch(companyId, batchPayload) {
  const meta = {
    batchId: batchPayload.batchId,
    dayKey: batchPayload.dayKey,
    s3Bucket: batchPayload.s3Bucket || "",
    s3PdfKeyPrefix: batchPayload.s3PdfKeyPrefix || "",
    outputDir: batchPayload.outputDir || "",
    pdfDir: batchPayload.pdfDir || "",
    resultJsonPath: batchPayload.resultJsonPath || "",
  };
  const rows = batchPayload.results || [];
  for (let i = 0; i < rows.length; i += 1) {
    await persistDgftRow(companyId, meta, rows[i], i, {});
  }
}

/**
 * Splits inputs into chunks of `DGFT_ROWS_PER_SESSION` and runs one `runDgftScrapeBatch` per chunk
 * (separate browser login/session each chunk). Persists each row as today via `onEachResult`.
 */
async function runDgftScrapeChunked({
  companyId,
  inputs,
  auth,
  body,
  persistCompanyId,
  persistModel,
  persistOptions,
}) {
  const rowModel = persistModel || DgftProcess;
  const rowsPerSession = getDgftRowsPerSession();
  const chunks = chunkArray(inputs, rowsPerSession);
  const sessions = [];
  for (const chunk of chunks) {
    const result = await runDgftScrapeBatch({
      companyId: String(companyId),
      inputs: chunk,
      username: auth.username,
      password: auth.password,
      maxLoginRetries: body.maxLoginRetries,
      savePdf: body.savePdf !== false,
      cloudOnly: body.cloudOnly !== false,
      onEachResult: async (rowResult, inputIndex, meta) => {
        await persistDgftRow(persistCompanyId, meta, rowResult, inputIndex, {
          Model: rowModel,
          ...(persistOptions || {}),
        });
      },
    });
    sessions.push(result);
  }
  const successCount = sessions.reduce((a, s) => a + (s.successCount || 0), 0);
  const noDataCount = sessions.reduce((a, s) => a + (s.noDataCount || 0), 0);
  const errorCount = sessions.reduce((a, s) => a + (s.errorCount || 0), 0);
  return {
    rowsPerSession,
    sessionCount: sessions.length,
    totalInputs: inputs.length,
    sessions,
    successCount,
    noDataCount,
    errorCount,
    total: inputs.length,
    results: sessions.flatMap((s) => s.results || []),
  };
}

async function processDgft(req, res) {
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
    fetchUsing = resolveDgftFetchEngine(body);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Invalid fetchUsing value.",
    });
  }
  const onlyUnprocessed = body.onlyUnprocessed === true || body.onlyPending === true;
  let bodyInputs = normalizeBodyInputs(body);
  if (onlyUnprocessed && !bodyInputs.length) {
    const pending = await loadUniqueShippingBillsFromShippingBillNo(companyId);
    const successKeys = await loadSuccessfulDgftInputKeys(companyId, [DgftBatch]);
    bodyInputs = pending
      .filter(
        (it) =>
          it.sbNo &&
          it.sbDate &&
          it.sbLocation &&
          !successKeys.has(makeShippingBillKey(it.sbNo, it.sbDate, it.sbLocation))
      )
      .map((it) => ({
        port: String(it.sbLocation).trim(),
        sbNumber: String(it.sbNo).trim(),
        sbDate: formatSbDateDdMmYyyy(it.sbDate),
        shippingBillNoId: String(it.shippingBillNoId),
      }));
  }
  if (!bodyInputs.length) {
    return res.status(400).json({
      success: false,
      message: onlyUnprocessed
        ? "No pending DGFT rows (all already succeeded, or no rows in shippingbillno). Upload PDFs to register Port / SB / date."
        : "Provide `inputs` with rows { port, sbNumber, sbDate }, or set onlyUnprocessed with rows in shippingbillno.",
    });
  }

  const auth = await resolveDgftAuth(companyId, body);
  if (!auth) {
    return res.status(400).json({
      success: false,
      message:
        "DGFT credentials missing: call POST /api/company/admin/configure/dgft/add-id-pass with id and password, or set DGFT_USERNAME and DGFT_PASSWORD.",
    });
  }

  try {
    if (fetchUsing === "dricat") {
      const dricatMeta = {
        batchId: new mongoose.Types.ObjectId().toString(),
        dayKey: new Date().toISOString().slice(0, 10),
        s3Bucket: "",
        s3PdfKeyPrefix: "",
        outputDir: "",
        pdfDir: "",
        resultJsonPath: "",
      };
      let workingCookies = await loginDricatCookies(companyId, auth, body);
      const dricatRows = [];
      for (let i = 0; i < bodyInputs.length; i += 1) {
        const input = bodyInputs[i] || {};
        try {
          const rowData = await fetchDgftData({
            companyId: String(companyId),
            sbNumber: input.sbNumber,
            sbDate: input.sbDate,
            portName: input.port,
            cookies: workingCookies,
          });
          workingCookies = Array.isArray(rowData?.cookies) ? rowData.cookies : workingCookies;
          const rowErrorMessage =
            rowData?.ok === true
              ? ""
              : String(
                  rowData?.body?.message ||
                    rowData?.message ||
                    (typeof rowData?.status === "string" ? rowData.status : "") ||
                    "DGFT dricat fetch failed."
                );
          const rowStatus =
            rowData?.ok === true
              ? "success"
              : /no brc number found/i.test(rowErrorMessage)
                ? "No BRC number found"
                : "error";
          const dricatRow = {
            inputIndex: i,
            input,
            iecNo: rowData?.iecNo || "",
            iecNumber:
              rowData?.iecNumber != null && Number.isFinite(Number(rowData.iecNumber))
                ? Number(rowData.iecNumber)
                : null,
            portPreview: rowData?.portPreview || [],
            tableRows: Array.isArray(rowData?.tableRows) ? rowData.tableRows : [],
            brcResponse: rowData?.brcResponse || null,
            brcNumbers: Array.isArray(rowData?.brcNumbers) ? rowData.brcNumbers : [],
            brcDetailsResponses: Array.isArray(rowData?.brcDetailsResponses)
              ? rowData.brcDetailsResponses
              : [],
            ok: rowData?.ok === true,
            errorMessage: rowErrorMessage,
          };
          dricatRows.push(dricatRow);
          await persistDgftRow(
            companyId,
            dricatMeta,
            {
              input,
              status: rowStatus,
              errorMessage: rowErrorMessage,
              scrapedData: buildDricatScrapedData(companyId, dricatMeta.batchId, dricatRow),
            },
            i,
            { Model: DgftBatch }
          );
        } catch (error) {
          const rowErrorMessage = error instanceof Error ? error.message : String(error);
          const dricatRow = {
            inputIndex: i,
            input,
            iecNo: "",
            iecNumber: null,
            portPreview: [],
            tableRows: [],
            brcResponse: null,
            brcNumbers: [],
            brcDetailsResponses: [],
            ok: false,
            errorMessage: rowErrorMessage,
          };
          dricatRows.push(dricatRow);
          await persistDgftRow(
            companyId,
            dricatMeta,
            {
              input,
              status: "error",
              errorMessage: rowErrorMessage,
              scrapedData: buildDricatScrapedData(companyId, dricatMeta.batchId, dricatRow),
            },
            i,
            { Model: DgftBatch }
          );
        }
      }
      // console.log(
      //   "[djft/process] dricat cookies:",
      //   JSON.stringify(workingCookies || [], null, 2)
      // );

      return res.status(200).json({
        success: true,
        message: "DGFT dricat token process completed.",
        data: {
          collection: "dgftbatch",
          fetchUsing,
          totalInputs: bodyInputs.length,
          cookies: workingCookies,
          iecNo: dricatRows[0]?.iecNo || "",
          iecNumber:
            dricatRows[0]?.iecNumber != null &&
            Number.isFinite(Number(dricatRows[0].iecNumber))
              ? Number(dricatRows[0].iecNumber)
              : null,
          brcResponse: dricatRows[0]?.brcResponse || null,
          brcNumbers: Array.isArray(dricatRows[0]?.brcNumbers)
            ? dricatRows[0].brcNumbers
            : [],
          brcDetailsResponses: Array.isArray(dricatRows[0]?.brcDetailsResponses)
            ? dricatRows[0].brcDetailsResponses
            : [],
          rows: dricatRows,
        },
      });
    }

    const data = await runDgftScrapeChunked({
      companyId,
      inputs: bodyInputs,
      auth,
      body,
      persistCompanyId: companyId,
      persistModel: DgftBatch,
    });

    return res.status(200).json({
      success: true,
      message:
        data.sessionCount > 1
          ? `DGFT process completed in ${data.sessionCount} session(s) (${data.rowsPerSession} rows per session).`
          : "DGFT process completed.",
      data: {
        collection: "dgftbatch",
        fetchUsing,
        ...data,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "DGFT process failed.",
    });
  }
}

function serializeDgftProcessInputRow(r) {
  return {
    id: String(r._id),
    collection: r._storage || "dgftprocess",
    input: r.input || {},
    shippingBillNoId: r.shippingBillNo ? String(r.shippingBillNo) : null,
    status: r.status || "",
    batchId: r.batchId || "",
    dayKey: r.dayKey || "",
    inputIndex: r.inputIndex ?? null,
    errorMessage: r.errorMessage || "",
    fetchUsing: inferDgftScrapeEngine(r.scrapedData),
    tableRowsCount: normalizeDgftTableRows(r.scrapedData).length,
    ok: r.scrapedData?.ok === true,
    createdAt: r.createdAt || null,
    updatedAt: r.updatedAt || null,
  };
}

async function loadDgftProcessAndBatchDocs(companyId, filter = {}, select = null) {
  const queryFilter = { companyId, ...filter };
  const processQuery = DgftProcess.find(queryFilter);
  const batchQuery = DgftBatch.find(queryFilter);
  if (select) {
    processQuery.select(select);
    batchQuery.select(select);
  }
  const [fromProcess, fromBatch] = await Promise.all([
    processQuery.lean(),
    batchQuery.lean(),
  ]);
  return [
    ...fromProcess.map((r) => ({ ...r, _storage: "dgftprocess" })),
    ...fromBatch.map((r) => ({ ...r, _storage: "dgftbatch" })),
  ];
}

async function listDgftProcessInputs(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const rows = (
    await loadDgftProcessAndBatchDocs(companyId, {}, {
      _id: 1,
      input: 1,
      scrapedData: 1,
      status: 1,
      batchId: 1,
      dayKey: 1,
      shippingBillNo: 1,
      inputIndex: 1,
      errorMessage: 1,
      createdAt: 1,
      updatedAt: 1,
    })
  ).sort((a, b) => {
    const ta = new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    if (ta !== 0) return ta;
    return (
      String(a.batchId || "").localeCompare(String(b.batchId || "")) ||
      (a.inputIndex ?? 0) - (b.inputIndex ?? 0)
    );
  });

  return res.status(200).json({
    success: true,
    count: rows.length,
    rows: rows.map(serializeDgftProcessInputRow),
  });
}

/**
 * GET /process-days — day-wise DGFT batch summary (like SB process-shipping-bill-dates).
 */
async function listDgftProcessDays(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const docs = await loadDgftProcessAndBatchDocs(companyId, {}, {
    dayKey: 1,
    status: 1,
    batchId: 1,
    input: 1,
    createdAt: 1,
  });

  const dayMap = new Map();
  for (const d of docs) {
    const dayKey = String(d.dayKey || "").trim();
    if (!dayKey) continue;

    if (!dayMap.has(dayKey)) {
      dayMap.set(dayKey, {
        id: dayKey,
        dayKey,
        totalRows: 0,
        processedSuccess: 0,
        processedError: 0,
        noDataCount: 0,
        batchIds: new Set(),
        errorShippingBillNumbers: new Set(),
        latestCreatedAt: null,
      });
    }

    const day = dayMap.get(dayKey);
    day.totalRows += 1;
    if (d.batchId) day.batchIds.add(String(d.batchId));

    const status = String(d.status || "").toLowerCase();
    const sbNo = String(d.input?.sbNumber || d.input?.sbNo || "").trim();
    if (status === "success") {
      day.processedSuccess += 1;
    } else if (status === "error") {
      day.processedError += 1;
      if (sbNo) day.errorShippingBillNumbers.add(sbNo);
    } else if (status === "no_data") {
      day.noDataCount += 1;
    }

    const createdAt = d.createdAt ? new Date(d.createdAt) : null;
    if (
      createdAt &&
      (!day.latestCreatedAt || createdAt.getTime() > day.latestCreatedAt.getTime())
    ) {
      day.latestCreatedAt = createdAt;
    }
  }

  const days = [...dayMap.values()]
    .map((day) => ({
      id: day.id,
      dayKey: day.dayKey,
      totalRows: day.totalRows,
      processedSuccess: day.processedSuccess,
      processedError: day.processedError,
      noDataCount: day.noDataCount,
      skipped: day.noDataCount,
      batchCount: day.batchIds.size,
      batchIds: [...day.batchIds].sort(),
      errorShippingBillNumbers: [...day.errorShippingBillNumbers].sort(),
      latestCreatedAt: day.latestCreatedAt,
    }))
    .sort((a, b) => String(b.dayKey).localeCompare(String(a.dayKey)));

  return res.status(200).json({
    success: true,
    message: "DGFT rows aggregated by dayKey from dgftprocess + dgftbatch.",
    count: days.length,
    days,
  });
}

/**
 * GET /process-day-detail?id=YYYY-MM-DD — all DGFT input rows for one day.
 */
async function getDgftProcessDayDetail(req, res) {
  const companyId = req.companyId;
  const dayKey = String(req.query.id ?? req.query.dayKey ?? "").trim();

  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }
  if (!dayKey) {
    return res.status(400).json({
      success: false,
      message: "Query parameter `id` (or `dayKey`) is required.",
    });
  }

  const rows = (
    await loadDgftProcessAndBatchDocs(
      companyId,
      { dayKey },
      {
        _id: 1,
        input: 1,
        scrapedData: 1,
        status: 1,
        batchId: 1,
        dayKey: 1,
        shippingBillNo: 1,
        inputIndex: 1,
        errorMessage: 1,
        createdAt: 1,
        updatedAt: 1,
      }
    )
  ).sort((a, b) => {
    const ta = new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    if (ta !== 0) return ta;
    return (
      String(a.batchId || "").localeCompare(String(b.batchId || "")) ||
      (a.inputIndex ?? 0) - (b.inputIndex ?? 0)
    );
  });

  if (!rows.length) {
    return res.status(404).json({
      success: false,
      message: "No DGFT rows found for this day.",
    });
  }

  const out = rows.map(serializeDgftProcessInputRow);
  const successCount = out.filter((r) => String(r.status).toLowerCase() === "success").length;
  const errorCount = out.filter((r) => String(r.status).toLowerCase() === "error").length;
  const noDataCount = out.filter((r) => String(r.status).toLowerCase() === "no_data").length;
  const batchIds = [...new Set(out.map((r) => r.batchId).filter(Boolean))];

  return res.status(200).json({
    success: true,
    dayKey,
    count: out.length,
    totalRows: out.length,
    successCount,
    errorCount,
    noDataCount,
    skippedCount: noDataCount,
    batchCount: batchIds.length,
    batchIds,
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

function buildDgftSbNoMongoOrClauses(sbNos) {
  const ors = [];
  for (const raw of sbNos) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const norm = normalizeSbNoForMatch(s);
    if (/^\d+$/.test(norm)) {
      const re = new RegExp(`^0*${escapeRegex(norm)}$`);
      ors.push({ "input.sbNumber": re });
      ors.push({ "input.sbNo": re });
    } else {
      const re = new RegExp(`^${escapeRegex(s)}$`, "i");
      ors.push({ "input.sbNumber": re });
      ors.push({ "input.sbNo": re });
    }
  }
  return ors;
}

/**
 * POST /search-by-sb-no
 * Body: { sbNos: ["123","456"] } or { sbNo: "123, 456 789" }
 * Searches all company dgftprocess + dgftbatch records (not limited to one day).
 */
async function searchDgftBySbNo(req, res) {
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

  const ors = buildDgftSbNoMongoOrClauses(sbNos);
  if (!ors.length) {
    return res.status(400).json({
      success: false,
      message: "No valid SB numbers provided.",
    });
  }

  const rows = (
    await loadDgftProcessAndBatchDocs(
      companyId,
      { $or: ors },
      {
        _id: 1,
        input: 1,
        scrapedData: 1,
        status: 1,
        batchId: 1,
        dayKey: 1,
        shippingBillNo: 1,
        inputIndex: 1,
        errorMessage: 1,
        createdAt: 1,
        updatedAt: 1,
      }
    )
  )
    .filter((d) => {
      const want = new Set(sbNos.map(normalizeSbNoForMatch).filter(Boolean));
      return want.has(normalizeSbNoForMatch(extractSbNoFromDgftDoc(d)));
    })
    .sort((a, b) => {
      const ta = new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      if (ta !== 0) return ta;
      return (
        String(a.batchId || "").localeCompare(String(b.batchId || "")) ||
        (a.inputIndex ?? 0) - (b.inputIndex ?? 0)
      );
    });

  const out = rows.map(serializeDgftProcessInputRow);
  const foundNorm = new Set(
    out.map((r) =>
      normalizeSbNoForMatch(r.input?.sbNumber ?? r.input?.sbNo ?? "")
    )
  );
  const notFound = sbNos.filter((n) => !foundNorm.has(normalizeSbNoForMatch(n)));

  const successCount = out.filter((r) => String(r.status).toLowerCase() === "success").length;
  const errorCount = out.filter((r) => String(r.status).toLowerCase() === "error").length;
  const noDataCount = out.filter((r) => String(r.status).toLowerCase() === "no_data").length;
  const batchIds = [...new Set(out.map((r) => r.batchId).filter(Boolean))];
  const dayKeys = [...new Set(out.map((r) => r.dayKey).filter(Boolean))].sort();

  return res.status(200).json({
    success: true,
    message: "Company-wide DGFT search by SB No.",
    searchedSbNos: sbNos,
    notFoundSbNos: notFound,
    count: out.length,
    totalRows: out.length,
    successCount,
    errorCount,
    noDataCount,
    skippedCount: noDataCount,
    batchCount: batchIds.length,
    batchIds,
    dayKeys,
    rows: out,
  });
}

/**
 * POST /process-random-ten
 * Picks up to N unique sbNo from `shippingbillno` where dgft=true and not yet fetched successfully.
 */
async function processRandomTenDgft(req, res) {
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
    fetchUsing = resolveDgftFetchEngine(body);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Invalid fetchUsing value.",
    });
  }
  const sampleSize = Math.min(
    100,
    Math.max(1, Number(body.count ?? body.sampleSize ?? 10) || 10)
  );

  const pending = await loadPendingDgftMarkedShippingBills(companyId);

  if (!pending.length) {
    return res.status(400).json({
      success: false,
      message:
        "No pending shipping bills for DGFT. Requires shippingbillno.dgft=true, unique sbNo, and not yet succeeded in dgftprocess/dgftbatch.",
    });
  }

  const picked = pickUniquePendingSample(pending, sampleSize);
  const inputs = mapPendingShippingBillsToDgftInputs(picked);

  const auth = await resolveDgftAuth(companyId, body);
  if (!auth) {
    return res.status(400).json({
      success: false,
      message:
        "DGFT credentials missing: call POST /api/company/admin/configure/dgft/add-id-pass with id and password, or set DGFT_USERNAME and DGFT_PASSWORD.",
    });
  }

  try {
    const data = await runDgftInputsBatch(companyId, inputs, {
      fetchUsing,
      auth,
      body,
      pendingPoolSize: pending.length,
    });

    return res.status(200).json({
      success: true,
      message:
        fetchUsing === "dricat"
          ? "DGFT dricat token process completed."
          : `DGFT batch completed for ${inputs.length} shipping bill(s) in ${data.sessionCount} session(s).`,
      data: {
        ...data,
        pickedSampleSize: sampleSize,
        pickedCount: inputs.length,
        pendingPoolSize: pending.length,
        pickedInputs: inputs,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "DGFT random batch failed.",
    });
  }
}

function inferDgftScrapeEngine(scrapedData) {
  if (!scrapedData || typeof scrapedData !== "object") return "unknown";
  const rows = scrapedData.tableRows;
  if (Array.isArray(rows)) {
    if (rows.length === 0 && scrapedData.brcResponse && typeof scrapedData.brcResponse === "object") {
      return "dricat";
    }
    if (rows.length > 0) return "table_rows";
  }
  if (scrapedData.brcResponse != null && typeof scrapedData.brcResponse === "object") {
    return "dricat";
  }
  return "unknown";
}

function normalizeDgftTableRows(scrapedData) {
  if (!scrapedData || typeof scrapedData !== "object") return [];
  if (Array.isArray(scrapedData.tableRows)) return scrapedData.tableRows;

  const rows = Array.isArray(scrapedData?.brcResponse?.data) ? scrapedData.brcResponse.data : [];
  if (!rows.length) return [];

  return rows.map((row) => ({
    "BRC Issue Date": row?.uploadDate ?? "",
    "Bank Realisation Number": row?.brcNumber ?? "",
    "Bank Realisation Status": row?.brcStatus?.value ?? row?.brcStatus ?? "",
    "Bill ID": row?.invoiceNumber ?? "",
    "Cancel eBRC": "initiate",
    "Date on which the amount is realized in the bank": row?.realisationDate ?? "",
    "FOB value realized in the foreign currency code":
      row?.realizedAmountCC ?? row?.realizedAmountCC1 ?? "",
    "GST Details": "-",
    "Shipping Bill Date": row?.sbDate ?? "",
    "Shipping Bill Number": row?.sbNumber ?? "",
    "Shipping Bill Port": row?.exportPortCode?.value ?? row?.exportPortCode ?? "",
    "Utilisation Status": row?.utilizationStatus ?? "No",
    brcDetail:
      row?.detailResponse && typeof row.detailResponse === "object"
        ? row.detailResponse
        : null,
  }));
}

async function getDgftProcessTableRowsById(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const id = String(req.params?.id ?? req.query?.id ?? "").trim();
  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Parameter `id` is required (path or query), e.g. /process-table-rows/:id or ?id=.",
    });
  }

  let doc =
    (await DgftProcess.findOne({ _id: id, companyId })
      .select({ _id: 1, input: 1, scrapedData: 1, status: 1, batchId: 1, dayKey: 1, shippingBillNo: 1 })
      .lean()) || null;
  let rowCollection = "dgftprocess";
  if (!doc) {
    doc = await DgftBatch.findOne({ _id: id, companyId })
      .select({ _id: 1, input: 1, scrapedData: 1, status: 1, batchId: 1, dayKey: 1, shippingBillNo: 1 })
      .lean();
    rowCollection = "dgftbatch";
  }

  if (!doc) {
    return res.status(404).json({
      success: false,
      message: "DGFT process row not found for this company.",
    });
  }

  const scraped = doc.scrapedData && typeof doc.scrapedData === "object" ? doc.scrapedData : null;
  const fetchUsing = inferDgftScrapeEngine(scraped);
  const tableRows = normalizeDgftTableRows(scraped);

  return res.status(200).json({
    success: true,
    id: String(doc._id),
    collection: rowCollection,
    input: doc.input || {},
    shippingBillNoId: doc.shippingBillNo ? String(doc.shippingBillNo) : null,
    status: doc.status || "",
    batchId: doc.batchId || "",
    dayKey: doc.dayKey || "",
    fetchUsing,
    tableRows,
    brcResponse: scraped?.brcResponse ?? null,
    iecNo: scraped?.iecNo ?? "",
    iecNumber: scraped?.iecNumber ?? null,
    ok: scraped?.ok === true,
    ...(String(req.query?.includeScrapedData ?? "").trim() === "1" ? { scrapedData: scraped } : {}),
  });
}

function parseBillsJsonParam(raw) {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") return [raw];
  const text = String(raw).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : null;
  } catch {
    return null;
  }
}

/** Frontend bills: port/sbLocation + sbNo/sbNumber + sbDate (shippingBillNoId resolved server-side). */
function mapFrontendDgftBill(row) {
  const registrySbDate = String(row?.sbDate ?? "").trim();
  return {
    port: String(row?.port ?? row?.portCode ?? row?.sbLocation ?? "").trim(),
    sbNumber: String(row?.sbNumber ?? row?.sbNo ?? "").trim(),
    sbDate: formatSbDateDdMmYyyy(registrySbDate),
    registrySbDate,
  };
}

/**
 * If sbNo exists in shippingbillno for this company, return its _id to link dgftprocess.
 * Prefer full triple (port + sbNo + sbDate); else unique match on sbNo alone.
 */
async function resolveShippingBillNoLinkForDgft(companyId, bill) {
  const portCode = String(bill?.port ?? "").trim();
  const sbNo = String(bill?.sbNumber ?? "").trim();
  const registrySbDate = String(bill?.registrySbDate ?? "").trim();
  if (!sbNo) return null;

  if (portCode && registrySbDate) {
    const id = await findShippingBillNoId(companyId, {
      portCode,
      sbNo,
      sbDate: registrySbDate,
    });
    if (id) return id;
  }

  const oid = new mongoose.Types.ObjectId(String(companyId));
  const candidates = await ShippingBillNo.find({ companyId: oid, sbNo })
    .select({ _id: 1, portCode: 1, sbDate: 1 })
    .lean();

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0]._id;

  if (portCode && registrySbDate) {
    const match = candidates.find(
      (r) =>
        String(r.portCode ?? "").trim() === portCode &&
        String(r.sbDate ?? "").trim() === registrySbDate
    );
    return match?._id || null;
  }

  return null;
}

async function attachShippingBillNoLinks(companyId, inputs) {
  const list = Array.isArray(inputs) ? [...inputs] : [];
  for (let i = 0; i < list.length; i += 1) {
    const linkId = await resolveShippingBillNoLinkForDgft(companyId, list[i]);
    if (linkId) {
      list[i] = { ...list[i], shippingBillNoId: String(linkId) };
    }
  }
  return list;
}

function parseFrontendDgftBillsFromRequest(req) {
  const q = req.query || {};
  const body = req.body || {};

  let raw = null;
  if (Array.isArray(body.bills)) raw = body.bills;
  else if (Array.isArray(q.bills)) raw = q.bills;
  else raw = parseBillsJsonParam(body.bills ?? q.bills);

  if (!raw && (q.sbNo || q.sbNumber || body.sbNo || body.sbNumber)) {
    raw = [
      {
        port: q.port ?? q.portCode ?? q.sbLocation ?? body.port ?? body.sbLocation,
        sbNumber: q.sbNumber ?? q.sbNo ?? body.sbNumber ?? body.sbNo,
        sbDate: q.sbDate ?? body.sbDate,
      },
    ];
  }

  if (!raw || !Array.isArray(raw)) return [];
  return raw.map(mapFrontendDgftBill).filter((b) => b.port && b.sbNumber && b.sbDate);
}

/**
 * POST /process-dgft-shipping-bill
 * Saves to dgftprocess. Links shippingBillNo when sbNo (and triple) exists in shippingbillno.
 * Body: { bills: [{ sbNo, sbDate, sbLocation }], fetchUsing?: "selenium"|"dricat" }
 */
async function processDgftShippingBill(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const params = { ...(req.query || {}), ...(req.body || {}) };
  let inputs = parseFrontendDgftBillsFromRequest(req);
  if (!inputs.length) {
    return res.status(400).json({
      success: false,
      message:
        "Provide bills in body: { bills: [{ sbNo, sbDate, sbLocation }] }.",
    });
  }

  inputs = await attachShippingBillNoLinks(companyId, inputs);
  const linkedCount = inputs.filter((b) => b.shippingBillNoId).length;

  let fetchUsing = "selenium";
  try {
    fetchUsing = resolveDgftFetchEngine(params);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Invalid fetchUsing value.",
    });
  }

  const auth = await resolveDgftAuth(companyId, params);
  if (!auth) {
    return res.status(400).json({
      success: false,
      message:
        "DGFT credentials missing: call POST /api/company/admin/configure/dgft/add-id-pass with id and password, or set DGFT_USERNAME and DGFT_PASSWORD.",
    });
  }

  const persistOptions = {
    Model: DgftProcess,
    existingDocsByInputKey: await loadExistingDgftDocsByInputKey(companyId, [DgftProcess]),
  };

  try {
    if (fetchUsing === "dricat") {
      const dricatMeta = {
        batchId: new mongoose.Types.ObjectId().toString(),
        dayKey: new Date().toISOString().slice(0, 10),
        s3Bucket: "",
        s3PdfKeyPrefix: "",
        outputDir: "",
        pdfDir: "",
        resultJsonPath: "",
      };
      let workingCookies = await loginDricatCookies(companyId, auth, params);
      const rows = [];
      for (let i = 0; i < inputs.length; i += 1) {
        const input = inputs[i] || {};
        try {
          const rowData = await fetchDgftData({
            companyId: String(companyId),
            sbNumber: input.sbNumber,
            sbDate: input.sbDate,
            portName: input.port,
            cookies: workingCookies,
          });
          workingCookies = Array.isArray(rowData?.cookies) ? rowData.cookies : workingCookies;
          const rowErrorMessage =
            rowData?.ok === true
              ? ""
              : String(
                  rowData?.body?.message ||
                    rowData?.message ||
                    (typeof rowData?.status === "string" ? rowData.status : "") ||
                    "DGFT dricat fetch failed."
                );
          const rowStatus =
            rowData?.ok === true
              ? "success"
              : /no brc number found/i.test(rowErrorMessage)
                ? "No BRC number found"
                : "error";
          const dricatRow = {
            inputIndex: i,
            input,
            iecNo: rowData?.iecNo || "",
            iecNumber:
              rowData?.iecNumber != null && Number.isFinite(Number(rowData.iecNumber))
                ? Number(rowData.iecNumber)
                : null,
            tableRows: Array.isArray(rowData?.tableRows) ? rowData.tableRows : [],
            brcResponse: rowData?.brcResponse || null,
            ok: rowData?.ok === true,
            errorMessage: rowErrorMessage,
          };
          rows.push(dricatRow);
          await persistDgftRow(
            companyId,
            dricatMeta,
            {
              input,
              status: rowStatus,
              errorMessage: rowErrorMessage,
              scrapedData: buildDricatScrapedData(companyId, dricatMeta.batchId, dricatRow),
            },
            i,
            persistOptions
          );
        } catch (error) {
          const rowErrorMessage = error instanceof Error ? error.message : String(error);
          const dricatRow = {
            inputIndex: i,
            input,
            ok: false,
            errorMessage: rowErrorMessage,
            tableRows: [],
            brcResponse: null,
          };
          rows.push(dricatRow);
          await persistDgftRow(
            companyId,
            dricatMeta,
            {
              input,
              status: "error",
              errorMessage: rowErrorMessage,
              scrapedData: buildDricatScrapedData(companyId, dricatMeta.batchId, dricatRow),
            },
            i,
            persistOptions
          );
        }
      }

      return res.status(200).json({
        success: true,
        message: "DGFT process completed; rows saved to dgftprocess.",
        data: {
          collection: "dgftprocess",
          fetchUsing,
          batchId: dricatMeta.batchId,
          dayKey: dricatMeta.dayKey,
          pickedCount: inputs.length,
          linkedToShippingBillNoCount: linkedCount,
          successCount: rows.filter((r) => r.ok).length,
          errorCount: rows.filter((r) => !r.ok).length,
          rows,
        },
      });
    }

    const data = await runDgftScrapeChunked({
      companyId,
      inputs,
      auth,
      body: params,
      persistCompanyId: companyId,
      persistModel: DgftProcess,
      persistOptions,
    });

    return res.status(200).json({
      success: true,
      message: `DGFT process completed for ${inputs.length} bill(s); saved to dgftprocess.`,
      data: {
        collection: "dgftprocess",
        fetchUsing,
        pickedCount: inputs.length,
        linkedToShippingBillNoCount: linkedCount,
        ...data,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "DGFT process failed.",
    });
  }
}

/**
 * GET /get-count-of-unfetched-dgft-shipping-bills
 * Summary counts from `shippingbillno` vs dgftprocess/dgftbatch (sbNo match).
 */
async function getCountOfUnfetchedDgftShippingBills(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const registered = await loadUniqueShippingBillsFromShippingBillNo(companyId);
  const { sbNos: fetchedSbNos } = await loadSuccessfulDgftSbNos(companyId, [
    DgftProcess,
    DgftBatch,
  ]);
  const attemptedSbNos = await loadAttemptedDgftSbNos(companyId, [DgftProcess, DgftBatch]);
  const failedSbNos = await loadFailedDgftSbNos(companyId, [DgftProcess, DgftBatch]);

  const dgftMarkedRegistered = registered.filter((it) => isDgftMarkedTrue(it.dgft));

  const fetchedRegistered = registered.filter((it) => {
    const sbNo = normalizeSbNoForMatch(it.sbNo);
    return sbNo && fetchedSbNos.has(sbNo);
  });

  const dgftMarkedNotFetched = dgftMarkedRegistered.filter((it) => {
    const sbNo = normalizeSbNoForMatch(it.sbNo);
    return sbNo && !fetchedSbNos.has(sbNo) && !attemptedSbNos.has(sbNo);
  });

  const dgftMarkedUnfetched = dgftMarkedRegistered.filter((it) => {
    const sbNo = normalizeSbNoForMatch(it.sbNo);
    return sbNo && !fetchedSbNos.has(sbNo) && failedSbNos.has(sbNo);
  });

  const uniqueFromRows = (rows) =>
    new Set(rows.map((it) => normalizeSbNoForMatch(it.sbNo)).filter(Boolean)).size;

  return res.status(200).json({
    success: true,
    totalShippingBillNo: registered.length,
    totalShippingBillNoUnique: uniqueFromRows(registered),
    totalFetchedShippingBill: fetchedRegistered.length,
    totalFetchedShippingBillUnique: uniqueFromRows(fetchedRegistered),
    filterDgftSbNo: dgftMarkedRegistered.length,
    filterDgftSbNoUnique: uniqueFromRows(dgftMarkedRegistered),
    filterDgftSbNoNotFetched: dgftMarkedNotFetched.length,
    filterDgftSbNoNotFetchedUnique: uniqueFromRows(dgftMarkedNotFetched),
    filterDgftSbNofetchederror: dgftMarkedUnfetched.length,
    filterDgftSbNofetchederrorUnique: uniqueFromRows(dgftMarkedUnfetched),
  });
}

module.exports = {
  processDgft,
  processRandomTenDgft,
  processAllDgftMarkedShippingBills,
  runProcessAllDgftMarkedForCompany,
  listDgftProcessInputs,
  listDgftProcessDays,
  getDgftProcessDayDetail,
  searchDgftBySbNo,
  getDgftProcessTableRowsById,
  getCountOfUnfetchedDgftShippingBills,
  processDgftShippingBill,
};
