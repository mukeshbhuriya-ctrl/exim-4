const BASE_URL = "https://foservices.icegate.gov.in/";
const PUBLIC_PAGE_URL = `${BASE_URL}#/public-enquiries/document-status/ds-shipping-bill`;
const SHIPPING_BILL_API_URL = `${BASE_URL}enquiry/publicEnquiries/SBTrack_Ices_action_Public`;
const REQUEST_TIMEOUT_MS = 30_000;

const GATEWAY_RESPONSE_SECTION = "gatewayEgmStatusModel";

const SELECTED_RESPONSE_SECTIONS = [
  "sbDetailsModel",
  "currentStatusModel",
  "egmStatusModel",
  "drawbackQueryDetailsModel",
  GATEWAY_RESPONSE_SECTION,
];

/** Same column order / labels as `extractResultsTable` in `shipping_bill/main.js` (orderedCombined). */
const SHIPPING_BILL_COMBINED_COLS = [
  "SB_NO",
  "IEC",
  "CHA No.",
  "Job No.",
  "Job Date",
  "Port of Discharge",
  "Total Package",
  "Gross Weight (Kg)",
  "FOB(INR)",
  "Total Cess (INR)",
  "Drawback",
  "STR",
  "Total (DBK+STR)",
  "CIN NO.",
  "CIN DT.",
  "Reward Flag",
  "Current Que",
  "LEO Date",
  "EP Copy Print Status",
  "DBK Scroll No",
  "Scroll Date",
  "EGM Integration Status",
  "EGM No.",
  "EGM Date",
  "Container No.",
  "Seal No.",
  "Error Message",
  "Query No.",
  "Query Date",
  "Query Text",
  "Pending With",
  "Officer Name",
  "Reply Date",
  "Gateway Port",
  "Gateway EGM No.",
  "Gateway EGM Date",
  "Gateway Site Id",
  "AWB No.",
];

/** Maps ICEGATE JSON property names → same display keys as `main.js` mappings. */
const SB_DETAILS_API_TO_COMBINED = {
  iec: "IEC",
  chaNo: "CHA No.",
  jobNo: "Job No.",
  jobDate: "Job Date",
  portOfDischarge: "Port of Discharge",
  totalPackage: "Total Package",
  grossWeight: "Gross Weight (Kg)",
  fob: "FOB(INR)",
  totalCess: "Total Cess (INR)",
  drawback: "Drawback",
  str: "STR",
  total: "Total (DBK+STR)",
  cinNo: "CIN NO.",
  cinDate: "CIN DT.",
  rewardFlag: "Reward Flag",
};

const CURRENT_STATUS_API_TO_COMBINED = {
  currQueue: "Current Que",
  leoDate: "LEO Date",
  epCopy: "EP Copy Print Status",
  custScrollNo: "DBK Scroll No",
  scrollDate: "Scroll Date",
  egmFiled: "EGM Integration Status",
};

const EGM_STATUS_API_TO_COMBINED = {
  egmNo: "EGM No.",
  egmDate: "EGM Date",
  containerNo: "Container No.",
  sealNo: "Seal No.",
  errorMsg: "Error Message",
};

const DRAWBACK_QUERY_API_TO_COMBINED = {
  queryNo: "Query No.",
  queryDate: "Query Date",
  queryText: "Query Text",
  pendingWith: "Pending With",
  officerName: "Officer Name",
  replyDate: "Reply Date",
};

const GATEWAY_API_TO_COMBINED = {
  awbNo: "AWB No.",
  custGatewayPort: "Gateway Port",
  custGatewayEgmNo: "Gateway EGM No.",
  custGatewayEgmDate: "Gateway EGM Date",
  gatewaySiteId: "Gateway Site Id",
  errorCode: "Error Message",
};

const SECTION_FIRST_ROW_MAPPINGS = [
  ["sbDetailsModel", SB_DETAILS_API_TO_COMBINED],
  ["currentStatusModel", CURRENT_STATUS_API_TO_COMBINED],
  ["egmStatusModel", EGM_STATUS_API_TO_COMBINED],
  ["drawbackQueryDetailsModel", DRAWBACK_QUERY_API_TO_COMBINED],
  [GATEWAY_RESPONSE_SECTION, GATEWAY_API_TO_COMBINED],
];

/**
 * Stored `scrapedData` section labels (after sb.js normalize) → ICEGATE API field names on row index 0.
 * Used by report `POST /columns` so template picker lists all keys even when sample doc omits sections.
 */
const SHIPPING_SECTION_FIELD_CATALOG = {
  "Shipping Bill Details": Object.keys(SB_DETAILS_API_TO_COMBINED),
  "Current Status": [
    "sbLoc",
    "wareNm",
    "currQueue",
    "currStatus",
    "appraisalDate",
    "appraisalAccId",
    "appraisalAccDate",
    "examMarkId",
    "markDate",
    "examInspId",
    "examDate",
    "examSupId",
    "dbkAccId",
    "dbkAccDate",
    "dbkSupId",
    "dbkSupDate",
    "depbSupId",
    "depbSupDate",
    "depbLicId",
    "depbLicDate",
    "sampleDrawn",
    "testReport",
    "leoDate",
    "epCopy",
    "readyToPr",
    "custScrollNo",
    "scrollDate",
    "egmFiled",
  ],
  "LEGM Status": Object.keys(EGM_STATUS_API_TO_COMBINED),
  "Drawback Query Details": Object.keys(DRAWBACK_QUERY_API_TO_COMBINED),
  "Gateway EGM Status Enquiry": Object.keys(GATEWAY_API_TO_COMBINED),
};

const SHIPPING_REPORT_TOP_LEVEL_KEYS = [
  "sb.status",
  "sb.sbNo",
  "sb.sbDate",
  "sb.sbLocation",
  "sb.errorMessage",
  "sb.id",
  "sb.dayKey",
  "sb.batchId",
  "sb.inputIndex",
  "sb.shippingBillNoId",
  "sb.createdAt",
  "sb.updatedAt",
  "sb.matchSource",
  "sb.scrapedData.sbNo",
  "sb.scrapedData.sbDate",
  "sb.scrapedData.sbDateNormalized",
  "sb.scrapedData.sbLocation",
];

/** Report / template column keys: `sb.{Section}.0.{apiField}` */
function buildShippingReportColumnCatalog() {
  const keys = new Set(SHIPPING_REPORT_TOP_LEVEL_KEYS);
  for (const [sectionLabel, fields] of Object.entries(SHIPPING_SECTION_FIELD_CATALOG)) {
    for (const field of fields) {
      const name = String(field ?? "").trim();
      if (name) keys.add(`sb.${sectionLabel}.0.${name}`);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  origin: BASE_URL.replace(/\/$/, ""),
  referer: PUBLIC_PAGE_URL,
};

function textOrEmpty(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeSbDateValue(value) {
  const text = textOrEmpty(value);
  if (!text) return "";
  if (/^\d{8}$/.test(text)) return text;

  const monthMap = {
    JAN: 1,
    FEB: 2,
    MAR: 3,
    APR: 4,
    MAY: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    NOV: 11,
    DEC: 12,
  };
  const dmy = /^(\d{1,2})-([A-Z]{3})-(\d{2}|\d{4})$/i.exec(text);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = monthMap[String(dmy[2]).toUpperCase()] || 0;
    let yy = Number(dmy[3]);
    if (String(dmy[3]).length === 2) yy += yy >= 70 ? 1900 : 2000;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yy}${String(mm).padStart(2, "0")}${String(dd).padStart(2, "0")}`;
    }
  }

  const asDate = new Date(text);
  if (Number.isNaN(asDate.getTime())) return text;
  const yyyy = asDate.getFullYear();
  const mm = String(asDate.getMonth() + 1).padStart(2, "0");
  const dd = String(asDate.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function validateRequestInputs(location, sbNo, sbDate) {
  const missing = [];
  if (!location) missing.push("location");
  if (!sbNo) missing.push("sbNo");
  if (!sbDate) missing.push("sbDate");
  if (missing.length) {
    throw new Error(`Missing required values: ${missing.join(", ")}`);
  }
  if (!/^\d{8}$/.test(sbDate)) {
    throw new Error("sbDate must be in yyyymmdd format, for example 20260414.");
  }
}

function buildRequestPayload({ location, sbNo, sbDate }) {
  const payload = {
    location: textOrEmpty(location).toUpperCase(),
    sbNo: textOrEmpty(sbNo),
    sbDate: normalizeSbDateValue(sbDate),
  };
  validateRequestInputs(payload.location, payload.sbNo, payload.sbDate);
  return payload;
}

/**
 * ICEGATE JSON section → same array-of-plain-objects shape as Selenium table rows in `formatScrapeSuccess` (main.js).
 */
function sectionToRowsArray(sectionValue) {
  if (sectionValue == null) return [];
  if (Array.isArray(sectionValue)) {
    return sectionValue.map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return { ...item };
      }
      return { value: item };
    });
  }
  if (typeof sectionValue === "object") {
    return [{ ...sectionValue }];
  }
  return [{ value: sectionValue }];
}

/**
 * Matches `formatScrapeSuccess` from `shipping_bill/main.js` so `normalizeScrapedDataSectionsForStorage` (sb.js) writes the same `scrapedData` keys: `rows`, `queueRows`, etc. → "Shipping Bill Details", "Current Status", …
 */
function buildSeleniumCompatibleSuccessData(requestPayload, responseData) {
  return {
    sbNo: textOrEmpty(requestPayload?.sbNo),
    sbDate: textOrEmpty(requestPayload?.sbDate),
    sbDateNormalized: textOrEmpty(requestPayload?.sbDate),
    sbLocation: textOrEmpty(requestPayload?.location),
    rows: sectionToRowsArray(responseData?.sbDetailsModel),
    queueRows: sectionToRowsArray(responseData?.currentStatusModel),
    egmRows: sectionToRowsArray(responseData?.egmStatusModel),
    drawbackQueryRows: sectionToRowsArray(responseData?.drawbackQueryDetailsModel),
    gatewayExportRows: sectionToRowsArray(responseData?.[GATEWAY_RESPONSE_SECTION]),
    timing: null,
  };
}

function flattenRecord(record, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(record || {})) {
    const flatKey = prefix ? `${prefix}.${key}` : String(key);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenRecord(value, flatKey));
    } else if (Array.isArray(value)) {
      out[flatKey] = JSON.stringify(value);
    } else {
      out[flatKey] = value;
    }
  }
  return out;
}

function firstSectionRow(responseData, sectionName) {
  const v = responseData?.[sectionName];
  if (Array.isArray(v)) {
    const first = v[0];
    return first && typeof first === "object" && !Array.isArray(first) ? first : {};
  }
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  return {};
}

function sectionArrayLength(responseData, sectionName) {
  const v = responseData?.[sectionName];
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object" && !Array.isArray(v)) return 1;
  return 0;
}

/** Rows after the first use the same `section_N.field` shape as before (not in main.js combined row). */
function appendAdditionalSectionRows(output, sectionName, value) {
  if (!Array.isArray(value) || value.length <= 1) return;
  for (let i = 1; i < value.length; i += 1) {
    const item = value[i];
    const itemPrefix = `${sectionName}_${i + 1}`;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      Object.assign(output, flattenRecord(item, itemPrefix));
    } else if (Array.isArray(item)) {
      output[`${itemPrefix}.value`] = JSON.stringify(item);
    } else {
      output[`${itemPrefix}.value`] = item;
    }
  }
}

/**
 * Aligns ICEGATE API JSON with the flat `orderedCombined` keys from `shipping_bill/main.js`.
 * Mapped fields use the same names as Selenium scrape; unmapped API-only fields stay as `section_1.key`.
 */
function buildMainStyleShippingBillFields(responseData, requestPayload) {
  const combined = {};
  for (const col of SHIPPING_BILL_COMBINED_COLS) combined[col] = "";

  combined.SB_NO = textOrEmpty(requestPayload?.sbNo);
  combined.Location = textOrEmpty(requestPayload?.location)?.toUpperCase();
  combined.SB_DT = textOrEmpty(requestPayload?.sbDate);

  const mappingRuns = [
    [firstSectionRow(responseData, "sbDetailsModel"), SB_DETAILS_API_TO_COMBINED],
    [firstSectionRow(responseData, "currentStatusModel"), CURRENT_STATUS_API_TO_COMBINED],
    [firstSectionRow(responseData, "egmStatusModel"), EGM_STATUS_API_TO_COMBINED],
    [firstSectionRow(responseData, "drawbackQueryDetailsModel"), DRAWBACK_QUERY_API_TO_COMBINED],
    [firstSectionRow(responseData, GATEWAY_RESPONSE_SECTION), GATEWAY_API_TO_COMBINED],
  ];

  for (const [src, mapping] of mappingRuns) {
    for (const [srcKey, targetKey] of Object.entries(mapping)) {
      const value = textOrEmpty(src[srcKey]);
      if (value) combined[targetKey] = value;
    }
  }

  const orderedKeys = [
    "SB_NO",
    "Location",
    "SB_DT",
    ...SHIPPING_BILL_COMBINED_COLS.filter((c) => c !== "SB_NO"),
  ];
  const out = {};
  for (const key of orderedKeys) out[key] = combined[key] ?? "";

  for (const sectionName of SELECTED_RESPONSE_SECTIONS) {
    out[`${sectionName}_count`] = sectionArrayLength(responseData, sectionName);
  }

  for (const [sectionName, mapping] of SECTION_FIRST_ROW_MAPPINGS) {
    const row = firstSectionRow(responseData, sectionName);
    const mappedKeys = new Set(Object.keys(mapping));
    for (const [key, val] of Object.entries(row || {})) {
      if (mappedKeys.has(key)) continue;
      const prefix = `${sectionName}_1.${key}`;
      if (val && typeof val === "object" && !Array.isArray(val)) {
        Object.assign(out, flattenRecord(val, prefix));
      } else if (Array.isArray(val)) {
        out[prefix] = JSON.stringify(val);
      } else {
        out[prefix] = val;
      }
    }
  }

  for (const sectionName of SELECTED_RESPONSE_SECTIONS) {
    const v = responseData[sectionName];
    appendAdditionalSectionRows(out, sectionName, Array.isArray(v) ? v : null);
  }

  return out;
}

function extractErrorMessage(httpStatus, responseData) {
  const parts = [];
  if (httpStatus !== null && httpStatus !== undefined && httpStatus !== "") {
    parts.push(`HTTP ${httpStatus}`);
  }

  if (responseData && typeof responseData === "object") {
    if (responseData.errorCode !== null && responseData.errorCode !== undefined && responseData.errorCode !== "") {
      parts.push(`errorCode=${responseData.errorCode}`);
    }
    const maybeErrors = responseData.errors;
    if (Array.isArray(maybeErrors)) {
      for (const err of maybeErrors) {
        const msg = textOrEmpty(err);
        if (msg) parts.push(msg);
      }
    } else {
      const msg = textOrEmpty(maybeErrors);
      if (msg) parts.push(msg);
    }
    for (const key of ["error", "message", "request_error", "raw_text"]) {
      const msg = textOrEmpty(responseData[key]);
      if (msg) parts.push(msg);
    }
  } else {
    const msg = textOrEmpty(responseData);
    if (msg) parts.push(msg);
  }

  return [...new Set(parts)].join(" | ") || "Unknown error";
}

function buildOutputJson({ responseData, responseStatus, requestPayload, extraFields = {} }) {
  const output = {
    http_status: responseStatus ?? "",
    input_location: textOrEmpty(requestPayload?.location),
    input_sbNo: textOrEmpty(requestPayload?.sbNo),
    input_sbDate: textOrEmpty(requestPayload?.sbDate),
    ...extraFields,
  };

  if (!responseData || typeof responseData !== "object" || Array.isArray(responseData)) {
    output["response.value"] = responseData ?? "";
    return output;
  }
  if (responseData.errorCode !== null && responseData.errorCode !== undefined && responseData.errorCode !== "") {
    output.api_error_code = responseData.errorCode;
  }

  Object.assign(output, buildMainStyleShippingBillFields(responseData, requestPayload));
  return output;
}

function parseSetCookie(line) {
  const parts = String(line || "")
    .split(";")
    .map((s) => s.trim());
  if (!parts.length || !parts[0].includes("=")) return null;
  const [name, ...valueParts] = parts[0].split("=");
  const value = valueParts.join("=");
  if (!name) return null;

  const out = {
    name,
    value,
    path: "/",
    secure: false,
  };
  for (const attr of parts.slice(1)) {
    const [key, ...rest] = attr.split("=");
    const k = String(key || "").toLowerCase();
    const v = rest.join("=");
    if (k === "path") out.path = v || "/";
    if (k === "domain") out.domain = v || "";
    if (k === "secure") out.secure = true;
    if (k === "samesite") out.sameSite = (v || "").toLowerCase();
    if (k === "httponly") out.httpOnly = true;
  }
  return out;
}

function mergeCookies(existingRecords, setCookieHeaders) {
  const map = new Map();
  for (const rec of existingRecords || []) {
    const key = `${rec.domain || ""}|${rec.path || "/"}|${rec.name || ""}`;
    if (rec?.name) map.set(key, { ...rec });
  }

  for (const raw of setCookieHeaders || []) {
    const parsed = parseSetCookie(raw);
    if (!parsed) continue;
    const key = `${parsed.domain || ""}|${parsed.path || "/"}|${parsed.name}`;
    const previous = map.get(key) || {};
    map.set(key, {
      ...previous,
      ...parsed,
      hostOnly: previous.hostOnly ?? !(parsed.domain || "").startsWith("."),
      session: true,
    });
  }
  return [...map.values()].sort((a, b) => {
    const ka = `${a.domain || ""}|${a.path || "/"}|${a.name || ""}`;
    const kb = `${b.domain || ""}|${b.path || "/"}|${b.name || ""}`;
    return ka.localeCompare(kb);
  });
}

function buildCookieHeader(cookieRecords) {
  return (cookieRecords || [])
    .filter((c) => c?.name && c.value !== null && c.value !== undefined)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function refreshCookies(cookieRecords) {
  const cookieHeader = buildCookieHeader(cookieRecords);
  const response = await fetchWithTimeout(
    BASE_URL,
    {
      method: "GET",
      headers: {
        ...DEFAULT_HEADERS,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
    },
    REQUEST_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new Error(`Cookie refresh failed with HTTP ${response.status}`);
  }
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const merged = mergeCookies(cookieRecords, setCookie);
  return { httpStatus: response.status, cookieRecords: merged };
}

async function callShippingBillApi(cookieRecords, payload) {
  const cookieHeader = buildCookieHeader(cookieRecords);
  const response = await fetchWithTimeout(
    SHIPPING_BILL_API_URL,
    {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        "content-type": "application/json",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      body: JSON.stringify(payload),
    },
    REQUEST_TIMEOUT_MS
  );

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  let responseData;
  if (contentType.includes("application/json")) {
    try {
      responseData = await response.json();
    } catch {
      responseData = { raw_text: await response.text() };
    }
  } else {
    responseData = { raw_text: await response.text() };
  }
  return { response, responseData };
}

function responseHasError(response, responseData) {
  if (!response.ok) return true;
  if (responseData && typeof responseData === "object" && responseData.errors) return true;
  return false;
}

async function processShippingBillRequest(input, options = {}) {
  const {
    initialCookies = [],
    maxAttempts = 2,
    autoRefreshCookiesOnRetry = true,
  } = options;

  const requestPayload = buildRequestPayload(input || {});
  let cookieRecords = Array.isArray(initialCookies)
    ? initialCookies.filter((x) => x && typeof x === "object")
    : [];

  try {
    const firstRefresh = await refreshCookies(cookieRecords);
    cookieRecords = firstRefresh.cookieRecords;
  } catch {
    // Continue with existing cookies and try API call.
  }

  let attemptCount = 0;
  let cookieRefreshCount = 0;
  let lastResponseStatus = "";
  let lastResponseData = {};
  let lastErrorMessage = "";
  const safeMaxAttempts = Math.max(1, Number(maxAttempts) || 1);

  for (let attempt = 1; attempt <= safeMaxAttempts; attempt += 1) {
    attemptCount = attempt;
    try {
      const { response, responseData } = await callShippingBillApi(cookieRecords, requestPayload);
      lastResponseStatus = response.status;
      lastResponseData = responseData;

      if (!responseHasError(response, responseData)) {
        return {
          ok: true,
          data: buildSeleniumCompatibleSuccessData(requestPayload, responseData),
        };
      }

      lastErrorMessage = extractErrorMessage(response.status, responseData);
    } catch (error) {
      lastResponseStatus = "";
      lastResponseData = { request_error: String(error?.message || error) };
      lastErrorMessage = String(error?.message || error);
    }

    if (attempt < safeMaxAttempts && autoRefreshCookiesOnRetry) {
      try {
        const refreshed = await refreshCookies(cookieRecords);
        cookieRecords = refreshed.cookieRecords;
        cookieRefreshCount += 1;
      } catch (refreshError) {
        lastErrorMessage = `${lastErrorMessage} | cookie refresh failed: ${
          refreshError?.message || refreshError
        }`;
        break;
      }
    }
  }

  return {
    ok: false,
    data: buildOutputJson({
      responseData: lastResponseData,
      responseStatus: lastResponseStatus,
      requestPayload,
      extraFields: {
        process_status: "error",
        error_message: lastErrorMessage || "Unknown error",
        attempt_count: attemptCount,
        cookie_refresh_count: cookieRefreshCount,
      },
    }),
  };
}

function createShippingBillHandler(options = {}) {
  return async function shippingBillHandler(req, res) {
    try {
      const input = req?.body || {};
      const result = await processShippingBillRequest(input, options);
      return res.status(result.ok ? 200 : 400).json({
        success: result.ok,
        data: result.data,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: String(error?.message || error),
      });
    }
  };
}

module.exports = {
  processShippingBillRequest,
  createShippingBillHandler,
  buildShippingReportColumnCatalog,
  SHIPPING_SECTION_FIELD_CATALOG,
  GATEWAY_RESPONSE_SECTION,
};
