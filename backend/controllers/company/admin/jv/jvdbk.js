const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { JvDbkFormat } = require("#utils/jvDbkFormat");
const { JvDbkProcess } = require("#utils/jvDbkProcess");
const { JvSalesData } = require("../process/sales/jvsalesdata");
const { JvPdfData, ensureJvPdfDataIndexes } = require("../process/pdf/jvpdfdata");
const { buildMergedRows, buildJvMergeSummary } = require("./jvMerge");

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function toText(value) {
  return String(value ?? "").trim();
}

function isAutoPlaceholder(value) {
  return toText(value).toLowerCase() === "auto added by software";
}

function defaultExpressionForHeader(headerName) {
  const h = toText(headerName).toUpperCase();
  if (h === "SAL_AMOUNT") return "total_dbk_amt";
  if (h === "ASSIGNMENT") return "SB No";
  if (h === "SHORT_TEXT") return "inv<space>DTD<space>date";
  if (h === "BUSINESS_AREA") return "jvsalesdata.data.business_area";
  return "";
}

function getValueByPath(source, dottedPath) {
  const path = toText(dottedPath);
  if (!path) return undefined;
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  let cur = source;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function getMergedField(merged, key) {
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) return undefined;
  const k = toText(key);
  if (!k) return undefined;
  if (Object.prototype.hasOwnProperty.call(merged, k)) return merged[k];
  const lower = k.toLowerCase();
  for (const p of Object.keys(merged)) {
    if (toText(p).toLowerCase() === lower) return merged[p];
  }
  return undefined;
}

function normalizePostingAccounts(body = {}) {
  const src = Array.isArray(body?.postingAccounts)
    ? body.postingAccounts
    : Array.isArray(defaultJvDbkConfig?.postingAccounts)
      ? defaultJvDbkConfig.postingAccounts
      : [];

  return src
    .map((it) => ({
      POSTING_KEY: toText(it?.POSTING_KEY),
      ACCOUNT_NO: toText(it?.ACCOUNT_NO),
    }))
    .filter((it) => it.POSTING_KEY || it.ACCOUNT_NO);
}

function normalizeRoundMode(value) {
  const mode = toText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (mode === "roundup") return "round_up";
  if (mode === "rounddown") return "round_down";
  if (mode === "round" || mode === "round_up" || mode === "round_down") return mode;
  return "";
}

function applyRoundMode(value, roundMode) {
  const mode = normalizeRoundMode(roundMode);
  if (!mode) return value;
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return value;
  const num = Number(text);
  if (!Number.isFinite(num)) return value;
  if (mode === "round_up") return Math.ceil(num);
  if (mode === "round_down") return Math.floor(num);
  return Math.round(num);
}

function normalizeArrayHeaderMappingItem(it) {
  const headerName = toText(it?.headerName);
  if (!headerName) return null;
  const renameHeader = toText(it?.renameHeader);
  const round = normalizeRoundMode(it?.round ?? it?.roundMode);

  const hvt = toText(it?.headerValueType).toLowerCase();
  if (hvt === "default_value") {
    return {
      headerName,
      headerValueType: "default_value",
      defaultValue: String(it?.defaultValue ?? ""),
      renameHeader,
      round,
    };
  }
  if (hvt === "current_date") {
    return {
      headerName,
      headerValueType: "current_date",
      defaultValue: toText(it?.defaultValue),
      renameHeader,
      round,
    };
  }

  const expression = (() => {
    const fallback = defaultExpressionForHeader(it?.headerName);
    const picked =
      toText(it?.sourceColumn) ||
      toText(it?.sourceKey) ||
      toText(it?.mapFrom) ||
      "";
    if (!picked || isAutoPlaceholder(picked)) return fallback || picked;
    return picked;
  })();

  return {
    headerName,
    headerValueType: "",
    defaultValue: "",
    expression,
    renameHeader,
    round,
  };
}

function normalizeHeaderRules(body = {}) {
  const raw =
    body?.headerMappings ??
    body?.headers ??
    body?.mapping ??
    defaultJvDbkConfig?.headerMappings ??
    [];

  if (Array.isArray(raw)) {
    return raw.map(normalizeArrayHeaderMappingItem).filter(Boolean);
  }

  if (isPlainObject(raw)) {
    return Object.entries(raw)
      .map(([k, v]) => ({
        headerName: toText(k),
        headerValueType: "",
        defaultValue: "",
        expression: toText(v),
        renameHeader: "",
        round: "",
      }))
      .filter((it) => it.headerName);
  }

  return [];
}

/** SHORT_TEXT date part as DD-MM-YY (e.g. 01-02-26). */
function formatJvShortTextDate(value) {
  const text = toText(value);
  if (!text) return "";

  const ddMmYy = text.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (ddMmYy) return text;

  const ddMmYyyy = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ddMmYyyy) {
    return `${ddMmYyyy[1]}-${ddMmYyyy[2]}-${ddMmYyyy[3].slice(-2)}`;
  }

  const ddMmYyyySlash = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddMmYyyySlash) {
    return `${ddMmYyyySlash[1]}-${ddMmYyyySlash[2]}-${ddMmYyyySlash[3].slice(-2)}`;
  }

  const yyyyMmDd = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyyMmDd) {
    return `${yyyyMmDd[2]}-${yyyyMmDd[3]}-${yyyyMmDd[1].slice(-2)}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const d = String(parsed.getDate()).padStart(2, "0");
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const y = String(parsed.getFullYear()).slice(-2);
    return `${d}-${m}-${y}`;
  }

  return text;
}

function normalizeShortTextExpression(expression) {
  const expr = toText(expression);
  if (!expr || expr === "inv<space>date") return "inv<space>DTD<space>date";
  return expr;
}

function resolveExpressionToken(part, merged) {
  const key = toText(part);
  if (!key) return "";

  const fromMerged = getMergedField(merged, key);
  if (fromMerged !== undefined) {
    return key.toLowerCase() === "date" ? formatJvShortTextDate(fromMerged) : toText(fromMerged);
  }

  if (key.includes(".")) {
    const byPath = getValueByPath(merged, key);
    if (byPath !== undefined) {
      const last = key.split(".").pop()?.toLowerCase() ?? "";
      return last === "date" ? formatJvShortTextDate(byPath) : toText(byPath);
    }
  }

  return key;
}

function resolveExpression(expression, merged) {
  const expr = toText(expression);
  if (!expr) return "";

  if (expr.includes(".")) {
    const byPath = getValueByPath(merged, expr);
    if (byPath !== undefined && byPath !== null && String(byPath).trim() !== "") return byPath;
    return "";
  }

  if (expr.includes("<space>")) {
    return expr
      .split("<space>")
      .map((part) => resolveExpressionToken(part, merged))
      .join(" ")
      .trim();
  }

  const fromMerged = getMergedField(merged, expr);
  if (fromMerged !== undefined && fromMerged !== null && String(fromMerged).trim() !== "") {
    return fromMerged;
  }

  const pdfData = merged?.jvpdfdata?.data;
  if (pdfData && typeof pdfData === "object") {
    const fromPdf = getMergedField(pdfData, expr);
    if (fromPdf !== undefined && fromPdf !== null && String(fromPdf).trim() !== "") {
      return fromPdf;
    }
  }

  return "";
}

/** Local calendar date DD.MM.YYYY for `headerValueType: "current_date"`. */
function formatJvCurrentDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${d}.${m}.${y}`;
}

function resolveHeaderCellValue(rule, merged, currentDateStr) {
  const hvt = toText(rule.headerValueType).toLowerCase();
  if (hvt === "default_value") {
    return String(rule.defaultValue ?? "");
  }
  if (hvt === "current_date") {
    return currentDateStr;
  }
  if (toText(rule.headerName).toUpperCase() === "SHORT_TEXT") {
    return resolveExpression(
      normalizeShortTextExpression(
        rule.expression || defaultExpressionForHeader("SHORT_TEXT")
      ),
      merged
    );
  }
  return resolveExpression(rule.expression, merged);
}

function buildJvRows(mergedRows, postingAccounts, headerRules) {
  const rows = [];
  const currentDateStr = formatJvCurrentDate();
  for (const merged of mergedRows) {
    for (const posting of postingAccounts) {
      const row = {};
      for (const rule of headerRules) {
        const value = applyRoundMode(
          resolveHeaderCellValue(rule, merged, currentDateStr),
          rule.round
        );
        if (toText(rule.headerName).toUpperCase() === "SAL_AMOUNT") {
          const num = Number(String(value ?? "").replace(/,/g, "").trim());
          row[rule.headerName] = Number.isFinite(num)
            ? normalizeRoundMode(rule.round)
              ? num
              : num.toFixed(2)
            : value;
        } else {
          row[rule.headerName] = value;
        }
      }
      if (posting.POSTING_KEY) row.POSTING_KEY = posting.POSTING_KEY;
      if (posting.ACCOUNT_NO) row.ACCOUNT_NO = posting.ACCOUNT_NO;
      rows.push(row);
    }
  }
  return rows;
}

function buildDefaultFirstRow(headerRules, defaultFirstRow, currentDateStr) {
  if (!isPlainObject(defaultFirstRow)) return null;
  const row = {};
  for (const rule of headerRules || []) {
    const headerName = toText(rule?.headerName);
    if (!headerName) continue;
    const raw = Object.prototype.hasOwnProperty.call(defaultFirstRow, headerName)
      ? defaultFirstRow[headerName]
      : "";
    const text = String(raw ?? "");
    row[headerName] = toText(text).toLowerCase() === "current_date" ? currentDateStr : text;
  }
  return isBlankJvExportRow(row) ? null : row;
}

function isBlankJvExportRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return true;
  for (const [key, value] of Object.entries(row)) {
    if (toText(key).toLowerCase() === "inv") continue;
    if (toText(value)) return false;
  }
  return true;
}

function rowsForJvExport(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !isBlankJvExportRow(row));
}

function exportJvDbkWorkbookBuffer(sheetsByDayKey) {
  const wb = xlsx.utils.book_new();
  for (const [dayKey, rows] of Object.entries(sheetsByDayKey || {})) {
    const exportRows = rowsForJvExport(rows);
    const ws = exportRows.length
      ? xlsx.utils.json_to_sheet(exportRows, { origin: "A2" })
      : xlsx.utils.aoa_to_sheet([[]]);
    const name =
      String(dayKey)
        .slice(0, 31)
        .replace(/[:\\/?*[\]]/g, "-")
        .trim() || "Sheet";
    xlsx.utils.book_append_sheet(wb, ws, name);
  }
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}

function renameHeadersInRows(rows, headerRules) {
  const renameMap = new Map();
  for (const rule of headerRules || []) {
    const from = toText(rule?.headerName);
    const to = toText(rule?.renameHeader);
    if (from && to) renameMap.set(from, to);
  }
  if (!renameMap.size) return rows;

  return (rows || []).map((row) => {
    const renamed = {};
    for (const [key, value] of Object.entries(row || {})) {
      renamed[renameMap.get(key) || key] = value;
    }
    return renamed;
  });
}

function toDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function parseDayKeysFromRequest(req) {
  const body = req?.body && typeof req.body === "object" ? req.body : {};
  const query = req?.query && typeof req.query === "object" ? req.query : {};

  const rawList = body.ids ?? body.dayKeys ?? body.dates ?? query.ids ?? query.dayKeys ?? query.dates;
  if (Array.isArray(rawList)) {
    const out = [...new Set(rawList.map((v) => toText(v)).filter(Boolean))];
    if (out.length) return out;
  }

  const rawSingle = body.id ?? query.id;
  const singleText = toText(rawSingle);
  if (!singleText) return [];
  if (singleText.includes(",")) {
    return [...new Set(singleText.split(",").map((v) => toText(v)).filter(Boolean))];
  }
  return [singleText];
}

/**
 * Merges request body with per-company `jvdbkformat` (when present) and file default.
 * Request body wins when it explicitly supplies posting accounts or header mapping keys.
 */
function buildEffectiveJvDbkBody(b, stored) {
  const body = b && typeof b === "object" ? b : {};
  const hasPosting = Array.isArray(body.postingAccounts) && body.postingAccounts.length > 0;
  const hasHeaderKey =
    Object.prototype.hasOwnProperty.call(body, "headerMappings") ||
    Object.prototype.hasOwnProperty.call(body, "headers") ||
    Object.prototype.hasOwnProperty.call(body, "mapping");

  const postingAccounts = hasPosting
    ? body.postingAccounts
    : Array.isArray(stored?.postingAccounts) && stored.postingAccounts.length
      ? stored.postingAccounts
      : defaultJvDbkConfig.postingAccounts;

  const headerMappings = hasHeaderKey
    ? body.headerMappings ?? body.headers ?? body.mapping
    : stored?.headerMappings != null
      ? stored.headerMappings
      : defaultJvDbkConfig.headerMappings;
  const defaultFirstRow =
    body.defaultFirstRow && typeof body.defaultFirstRow === "object" && !Array.isArray(body.defaultFirstRow)
      ? body.defaultFirstRow
      : stored?.defaultFirstRow && typeof stored.defaultFirstRow === "object" && !Array.isArray(stored.defaultFirstRow)
        ? stored.defaultFirstRow
        : {};

  return { postingAccounts, headerMappings, defaultFirstRow };
}

async function getJvDbkFormat(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const doc = await JvDbkFormat.findOne({ companyId }).lean();
  if (!doc) {
    return res.status(200).json({
      success: true,
      source: "blank",
      data: {
        postingAccounts: [],
        headerMappings: [],
        defaultFirstRow: {},
      },
    });
  }

  return res.status(200).json({
    success: true,
    source: "database",
    data: {
      postingAccounts: doc.postingAccounts || [],
      headerMappings: doc.headerMappings != null ? doc.headerMappings : [],
      defaultFirstRow:
        doc.defaultFirstRow && typeof doc.defaultFirstRow === "object"
          ? doc.defaultFirstRow
          : {},
    },
    updatedAt: doc.updatedAt || null,
  });
}

async function postJvDbkFormat(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const b = req.body && typeof req.body === "object" ? req.body : {};
    const postingAccounts = Array.isArray(b.postingAccounts)
      ? b.postingAccounts
      : defaultJvDbkConfig.postingAccounts || [];
    const headerMappings = b.headerMappings ?? b.headers ?? b.mapping;
    const defaultFirstRow =
      b.defaultFirstRow && typeof b.defaultFirstRow === "object" && !Array.isArray(b.defaultFirstRow)
        ? b.defaultFirstRow
        : {};
    if (
      headerMappings == null ||
      (!Array.isArray(headerMappings) && !isPlainObject(headerMappings))
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Body must include `headerMappings` (array) or a header map object, like jv-dbk.json. `postingAccounts` is optional and defaults from server file when omitted.",
      });
    }

    const saved = await JvDbkFormat.findOneAndUpdate(
      { companyId },
      {
        $set: {
          postingAccounts,
          headerMappings,
          defaultFirstRow,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return res.status(200).json({
      success: true,
      message: "JV DBK format saved. Saving again replaces the company format.",
      data: {
        postingAccounts: saved.postingAccounts || [],
        headerMappings: saved.headerMappings,
        defaultFirstRow:
          saved.defaultFirstRow && typeof saved.defaultFirstRow === "object"
            ? saved.defaultFirstRow
            : {},
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function runProcessJvDbkForCompany(companyId, body = {}) {
  if (!companyId) {
    return {
      success: false,
      statusCode: 401,
      message: "Company admin access is required.",
    };
  }

  const stored = await JvDbkFormat.findOne({ companyId }).lean();
  const effective = buildEffectiveJvDbkBody(body, stored);
  const postingAccounts = normalizePostingAccounts(effective);
  const headerRules = normalizeHeaderRules(effective);

  const [salesDocs, pdfDocs] = await Promise.all([
    JvSalesData.find({
      companyId,
      $or: [
        { "data.jv_droback": { $exists: false } },
        { "data.jv_droback": { $ne: "complete" } },
      ],
    })
      .sort({ createdAt: 1 })
      .lean(),
    ensureJvPdfDataIndexes().then(() =>
      JvPdfData.find({ companyId }).sort({ createdAt: 1 }).lean()
    ),
  ]);

  const mergedRows = buildMergedRows(salesDocs, pdfDocs);
  const mergeSummary = buildJvMergeSummary(salesDocs, pdfDocs, mergedRows, postingAccounts);
  console.log("[JV DBK] merge summary", mergeSummary);

  const generatedRows = buildJvRows(mergedRows, postingAccounts, headerRules);
  const currentDateStr = formatJvCurrentDate();
  const firstRow = buildDefaultFirstRow(
    headerRules,
    effective.defaultFirstRow || {},
    currentDateStr
  );
  const rows = renameHeadersInRows(
    firstRow ? [firstRow, ...generatedRows] : generatedRows,
    headerRules
  );
  const dayKey = toDayKey();
  const matchedInvList = [...new Set(mergedRows.map((r) => toText(r.inv)).filter(Boolean))];

  await JvDbkProcess.updateOne(
    { companyId, dayKey },
    {
      $set: {
        companyId,
        dayKey,
        rows,
        matchedInvs: matchedInvList,
        source: {
          postingAccounts,
          headerRules,
        },
        summary: {
          mergedCount: mergedRows.length,
          generatedRowsCount: rows.length,
          postingAccountsCount: postingAccounts.length,
          ...mergeSummary,
        },
      },
    },
    { upsert: true }
  );

  if (matchedInvList.length) {
    await JvSalesData.updateMany(
      { companyId, inv: { $in: matchedInvList } },
      { $set: { "data.jv_droback": "complete" } }
    );
  }

  const data = {
    dayKey,
    ...mergeSummary,
    mergedCount: mergedRows.length,
    postingAccountsCount: postingAccounts.length,
    generatedRowsCount: rows.length,
    rows,
  };

  return {
    success: true,
    message:
      `JV DBK processed: ${mergeSummary.mergedCount} sales↔PDF merge(s) × ` +
      `${mergeSummary.postingAccountsCount} posting account(s) = ${rows.length} generated row(s).`,
    summary: {
      ...mergeSummary,
      dayKey,
      mergedCount: mergedRows.length,
      generatedRowsCount: rows.length,
      postingAccountsCount: postingAccounts.length,
    },
    data,
  };
}

async function processJvDbk(req, res, next) {
  try {
    const result = await runProcessJvDbkForCompany(req.companyId, req.body || {});
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    return next(error);
  }
}

async function getJvDbkDates(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const rows = await JvDbkProcess.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(String(companyId)) } },
      {
        $group: {
          _id: "$dayKey",
          count: { $sum: 1 },
          generatedRowsCount: { $sum: { $ifNull: ["$summary.generatedRowsCount", 0] } },
          createdAt: { $max: "$createdAt" },
          sapNo: { $first: "$sapNo" },
        },
      },
      { $sort: { _id: -1 } },
      {
        $project: {
          _id: 0,
          id: "$_id",
          dayKey: "$_id",
          count: 1,
          generatedRowsCount: 1,
          createdAt: 1,
          sapNo: { $ifNull: ["$sapNo", ""] },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      count: rows.length,
      rows,
    });
  } catch (error) {
    return next(error);
  }
}

async function getJvDbkDateWiseData(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }
    const dayKeys = parseDayKeysFromRequest(req);
    if (!dayKeys.length) {
      return res.status(400).json({
        success: false,
        message: "Pass `id` (single) or `ids` (array/comma-separated dayKey values).",
      });
    }

    const docs = await JvDbkProcess.find({
      companyId,
      dayKey: { $in: dayKeys },
    }).lean();
    if (!docs.length) {
      return res.status(404).json({
        success: false,
        message: "No JV DBK process document found for provided day key(s).",
      });
    }

    if (dayKeys.length === 1) {
      const dayKey = dayKeys[0];
      const doc = docs.find((d) => toText(d.dayKey) === dayKey) || docs[0];
      return res.status(200).json({
        success: true,
        id: dayKey,
        dayKey,
        sapNo: toText(doc.sapNo),
        count: Array.isArray(doc.rows) ? doc.rows.length : 0,
        row: {
          id: String(doc._id),
          dayKey: doc.dayKey,
          sapNo: toText(doc.sapNo),
          source: doc.source || {},
          summary: doc.summary || {},
          matchedInvs: Array.isArray(doc.matchedInvs) ? doc.matchedInvs : [],
          rows: Array.isArray(doc.rows) ? doc.rows : [],
          createdAt: doc.createdAt || null,
          updatedAt: doc.updatedAt || null,
        },
      });
    }

    const docMap = new Map(docs.map((d) => [toText(d.dayKey), d]));
    const rows = dayKeys
      .map((dayKey) => {
        const doc = docMap.get(dayKey);
        if (!doc) return null;
        return {
          id: String(doc._id),
          dayKey: doc.dayKey,
          sapNo: toText(doc.sapNo),
          count: Array.isArray(doc.rows) ? doc.rows.length : 0,
          source: doc.source || {},
          summary: doc.summary || {},
          matchedInvs: Array.isArray(doc.matchedInvs) ? doc.matchedInvs : [],
          rows: Array.isArray(doc.rows) ? doc.rows : [],
          createdAt: doc.createdAt || null,
          updatedAt: doc.updatedAt || null,
        };
      })
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      requestedDayKeys: dayKeys,
      foundCount: rows.length,
      rows,
    });
  } catch (error) {
    return next(error);
  }
}

async function getJvDbkDateWiseDataIntoExcel(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, message: "Company admin access is required." });
    }

    const dayKeys = parseDayKeysFromRequest(req);
    if (!dayKeys.length) {
      return res.status(400).json({
        success: false,
        message: "Pass `id` (single) or `ids` (array/comma-separated dayKey values).",
      });
    }

    const docs = await JvDbkProcess.find({
      companyId,
      dayKey: { $in: dayKeys },
    }).lean();

    if (!docs.length) {
      return res.status(404).json({
        success: false,
        message: "No JV DBK process document found for provided day key(s).",
      });
    }

    const docMap = new Map(docs.map((d) => [toText(d.dayKey), d]));
    const sheets = {};
    for (const dayKey of dayKeys) {
      const doc = docMap.get(dayKey);
      if (!doc) continue;
      sheets[dayKey] = Array.isArray(doc.rows) ? doc.rows : [];
    }

    if (!Object.keys(sheets).length) {
      return res.status(404).json({
        success: false,
        message: "No JV DBK rows found for provided day key(s).",
      });
    }

    const buffer = exportJvDbkWorkbookBuffer(sheets);
    const filename =
      dayKeys.length === 1
        ? `jv-dbk-${dayKeys[0]}.xlsx`
        : `jv-dbk-${dayKeys[0]}-to-${dayKeys[dayKeys.length - 1]}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
}

function resolveCompanyIdFromRequest(req) {
  const body = req?.body && typeof req.body === "object" ? req.body : {};
  const query = req?.query && typeof req.query === "object" ? req.query : {};
  return String(
    body.companyId ??
      body.companyid ??
      body.company_id ??
      query.companyId ??
      query.companyid ??
      query.company_id ??
      ""
  ).trim();
}

function resolveJvDayKeyFromRequest(req) {
  const body = req?.body && typeof req.body === "object" ? req.body : {};
  const query = req?.query && typeof req.query === "object" ? req.query : {};
  return toText(
    body.jvdaykey ??
      body.jvDayKey ??
      body.jv_day_key ??
      body.dayKey ??
      body.daykey ??
      body.date ??
      body.id ??
      query.jvdaykey ??
      query.jvDayKey ??
      query.jv_day_key ??
      query.dayKey ??
      query.daykey ??
      query.date ??
      query.id ??
      ""
  );
}

function resolveSapNoFromRequest(req) {
  const body = req?.body && typeof req.body === "object" ? req.body : {};
  const query = req?.query && typeof req.query === "object" ? req.query : {};
  return toText(
    body.sapNo ??
      body.sapno ??
      body.sap_no ??
      body.SAP_NO ??
      query.sapNo ??
      query.sapno ??
      query.sap_no ??
      query.SAP_NO ??
      ""
  );
}

/**
 * POST /api/company/admin/jv/get-jv-dbk-date-wise-data-into-excel-for-sap
 * Body/query: companyId + date (dayKey) — returns JV DBK Excel for SAP integration.
 */
async function getJvDbkDateWiseDataIntoExcelForSap(req, res, next) {
  try {
    const companyId = resolveCompanyIdFromRequest(req);
    const dayKey = resolveJvDayKeyFromRequest(req);

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "Provide `companyId` in the request body or query.",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid companyId.",
      });
    }
    if (!dayKey) {
      return res.status(400).json({
        success: false,
        message: "Provide `date` (dayKey) in the request body or query.",
      });
    }

    const doc = await JvDbkProcess.findOne({ companyId, dayKey }).lean();
    if (!doc) {
      return res.status(404).json({
        success: false,
        companyId,
        dayKey,
        message: "No JV DBK process document found for this company and date.",
      });
    }

    const rows = Array.isArray(doc.rows) ? doc.rows : [];
    const buffer = exportJvDbkWorkbookBuffer({ [dayKey]: rows });
    const filename = `jv-dbk-${dayKey}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/company/admin/jv/add-sap-no-in-to-jv-dbk
 * Body/query: companyId, jvdaykey (dayKey), sapNo — stores SAP number on jvdbkprocess.
 */
async function addSapNoInToJvDbk(req, res, next) {
  try {
    const companyId = resolveCompanyIdFromRequest(req);
    const dayKey = resolveJvDayKeyFromRequest(req);
    const sapNo = resolveSapNoFromRequest(req);

    if (!companyId || !dayKey || !sapNo) {
      return res.status(400).json({
        success: false,
        message: "Provide `companyId`, `jvdaykey` (dayKey), and `sapNo`.",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid companyId.",
      });
    }

    const doc = await JvDbkProcess.findOneAndUpdate(
      { companyId, dayKey },
      { $set: { sapNo } },
      { new: true }
    ).lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        companyId,
        dayKey,
        message: "No JV DBK process document found for this company and jvdaykey.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "SAP number saved on JV DBK process document.",
      companyId,
      dayKey,
      sapNo: toText(doc.sapNo),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getJvDbkFormat,
  postJvDbkFormat,
  runProcessJvDbkForCompany,
  processJvDbk,
  getJvDbkDates,
  getJvDbkDateWiseData,
  getJvDbkDateWiseDataIntoExcel,
  getJvDbkDateWiseDataIntoExcelForSap,
  addSapNoInToJvDbk,
};