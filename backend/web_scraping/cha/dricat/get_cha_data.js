const fetch = require("node-fetch");

const GSTIN_ENQUIRY_URL =
  "https://foservices.icegate.gov.in/enquiry/icelogin/result-gstinenquiry";

const GET_IEC_URL =
  "https://foservices.icegate.gov.in/enquiry/enquiryatices/get-iec";

const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function maskValue(value, head = 4, tail = 4) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (s.length <= head + tail) return "*".repeat(s.length);
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function logGstinEnquiry(step, details) {
  console.log(`[CHA GST enquiry] ${step}`, details);
}

/**
 * @param {Date} [refDate]
 * @returns {string} e.g. "MAY-2026"
 */
function getCurrentSbMonthAndYear(refDate = new Date()) {
  const d = refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? refDate : new Date();
  return `${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * @param {object} auth
 * @param {string} auth.sessionId
 * @param {string} auth.token
 * @param {number} auth.roleId
 * @param {string} auth.icegateId - ICEGATE login username
 * @param {string} [auth.iec] - resolved Import Export Code for GST enquiry
 * @param {string} gstin
 * @param {object} [options]
 * @param {string} [options.sbMonthAndYear]
 * @param {number} [options.timeoutMs]
 */
function buildGstinEnquiryBody(auth, gstin, sbMonthAndYear) {
  const icegateId = String(auth.icegateId || "").trim();
  const iec = String(auth.iec || "").trim();
  const gst = String(gstin || "").trim();
  if (!icegateId || !gst) {
    throw new Error("buildGstinEnquiryBody: icegateId and gstin are required.");
  }
  if (!iec) {
    throw new Error(
      "buildGstinEnquiryBody: iec is required. Resolve it via get-iec before GST enquiry."
    );
  }

  return {
    icegateId,
    roleId: Number(auth.roleId),
    iec,
    gstin: gst,
    sbMonthAndYear: sbMonthAndYear || getCurrentSbMonthAndYear(),
  };
}

/**
 * ICEGATE authenticated enquiry headers (browser-style; token is raw JWT, not "Bearer …").
 * @param {{ sessionId: string, token: string }} auth
 */
function buildIcegateAuthHeaders(auth) {
  const sessionId = String(auth.sessionId || "").trim();
  const token = String(auth.token || "").trim();
  if (!sessionId || !token) {
    throw new Error("buildGstinEnquiryHeaders: sessionId and token are required.");
  }

  return {
    ADRUM: "isAjax:true",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US",
    Authorization: token,
    "Content-Type": "application/json",
    Referer: "https://foservices.icegate.gov.in/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    channel: "browser",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    session_id: sessionId,
  };
}

const buildGstinEnquiryHeaders = buildIcegateAuthHeaders;

function normalizeIecValue(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s) && s.length <= 10) {
    return s.padStart(10, "0");
  }
  return s;
}

function isLikelyPan(value) {
  return /^[A-Z]{5}\d{4}[A-Z]$/i.test(String(value || "").trim());
}

/** GSTIN: 2-digit state + 10-char PAN + entity + Z + checksum */
function extractPanFromGstin(gstin) {
  const gst = String(gstin || "").trim().toUpperCase();
  if (gst.length !== 15) return "";
  const pan = gst.slice(2, 12);
  return isLikelyPan(pan) ? pan : "";
}

function buildPanCandidates(auth, options = {}) {
  const icegateId = String(auth.icegateId || "").trim();
  const seen = new Set();
  const candidates = [];

  function add(pan) {
    const p = String(pan || "").trim().toUpperCase();
    if (!p || seen.has(p)) return;
    seen.add(p);
    candidates.push(p);
  }

  add(options.pan);
  add(auth.pan);
  for (const gstin of Array.isArray(options.gstNumbers) ? options.gstNumbers : []) {
    add(extractPanFromGstin(gstin));
  }
  if (isLikelyPan(icegateId)) add(icegateId);
  add(icegateId);

  return candidates;
}

function extractIecFromLoginResponse(loginResponse) {
  if (!loginResponse || typeof loginResponse !== "object") return "";

  const direct = [
    loginResponse.iec,
    loginResponse.iecNo,
    loginResponse.iecNumber,
    loginResponse.iecCode,
  ];
  for (const value of direct) {
    const iec = normalizeIecValue(value);
    if (iec) return iec;
  }

  const roles = loginResponse.approvedRoles?.userRoles;
  if (Array.isArray(roles)) {
    for (const role of roles) {
      const iec = normalizeIecValue(role?.iec ?? role?.iecNo ?? role?.iecNumber ?? role?.iecCode);
      if (iec) return iec;
    }
  }

  return "";
}

function pickBestIecRow(rows) {
  const valid = (rows || []).filter((row) => row && String(row.iec ?? "").trim());
  if (!valid.length) return null;

  const numericTenDigit = valid.find((row) => /^\d{10}$/.test(normalizeIecValue(row.iec)));
  return numericTenDigit || valid[0];
}

function parseGetIecResponse(response) {
  const rows = Array.isArray(response) ? response : [];
  const match = pickBestIecRow(rows);
  if (!match) return null;

  return {
    iec: normalizeIecValue(match.iec),
    iecName: String(match.iecName || "").trim(),
    rows,
  };
}

/**
 * POST /enquiry/enquiryatices/get-iec — resolve IEC from icegateId + pan.
 *
 * @param {{ sessionId: string, token: string, icegateId: string }} auth
 * @param {object} [options]
 * @param {string} [options.pan] - defaults to icegateId
 * @param {number} [options.timeoutMs]
 */
async function fetchIecFromIcegate(auth, options = {}) {
  const icegateId = String(auth.icegateId || "").trim();
  const pan = String(options.pan || auth.pan || icegateId).trim();
  if (!icegateId || !pan) {
    throw new Error("fetchIecFromIcegate: icegateId and pan are required.");
  }

  const requestBody = { icegateId, pan };
  const timeoutMs = options.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  logGstinEnquiry("get-iec request", {
    icegateId,
    pan,
    sessionId: maskValue(auth.sessionId),
    tokenLength: String(auth.token || "").length,
  });

  try {
    const res = await fetch(GET_IEC_URL, {
      method: "POST",
      headers: buildIcegateAuthHeaders(auth),
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const text = await res.text();
    let response;
    try {
      response = text ? JSON.parse(text) : null;
    } catch {
      response = text;
    }

    if (!res.ok) {
      logGstinEnquiry("get-iec response failed", {
        icegateId,
        pan,
        httpStatus: res.status,
        body: response,
      });
      const err = new Error(`get-iec failed: HTTP ${res.status}`);
      err.status = res.status;
      err.requestBody = requestBody;
      err.body = response;
      throw err;
    }

    const parsed = parseGetIecResponse(response);
    if (!parsed?.iec) {
      logGstinEnquiry("get-iec empty", {
        icegateId,
        pan,
        body: response,
      });
      const err = new Error("get-iec returned no IEC for the given icegateId/pan.");
      err.status = 404;
      err.requestBody = requestBody;
      err.body = response;
      throw err;
    }

    logGstinEnquiry("get-iec response ok", {
      icegateId,
      pan,
      iec: parsed.iec,
      iecName: parsed.iecName || null,
      rowCount: parsed.rows.length,
    });

    return {
      ...parsed,
      requestBody,
      response,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve IEC for GST enquiry: section override, ext-login fields, then get-iec (try PAN candidates).
 */
async function resolveAuthIecForEnquiry(auth, options = {}) {
  const configuredIec = normalizeIecValue(options.sectionIec || auth.iec || "");
  if (configuredIec) {
    return {
      iec: configuredIec,
      iecName: String(options.sectionIecName || auth.iecName || "").trim(),
      source: String(options.sectionIec || "").trim() ? "section" : "auth",
    };
  }

  const fromLogin = extractIecFromLoginResponse(options.loginResponse);
  if (fromLogin) {
    logGstinEnquiry("iec from ext-login", {
      icegateId: String(auth.icegateId || "").trim(),
      iec: fromLogin,
    });
    return {
      iec: fromLogin,
      iecName: "",
      source: "ext-login",
    };
  }

  const panCandidates = buildPanCandidates(auth, options);
  logGstinEnquiry("get-iec pan candidates", {
    icegateId: String(auth.icegateId || "").trim(),
    panCandidates,
  });

  let lastError = null;
  for (const pan of panCandidates) {
    try {
      const fetched = await fetchIecFromIcegate(auth, {
        pan,
        timeoutMs: options.timeoutMs,
      });
      return {
        iec: fetched.iec,
        iecName: fetched.iecName,
        source: "get-iec",
        panUsed: pan,
        rows: fetched.rows,
        requestBody: fetched.requestBody,
        response: fetched.response,
      };
    } catch (err) {
      lastError = err;
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : "Could not resolve IEC from get-iec for any PAN candidate.";
  const err = new Error(message);
  if (lastError?.status) err.status = lastError.status;
  if (lastError?.body) err.body = lastError.body;
  throw err;
}

/**
 * POST result-gstinenquiry for one GSTIN.
 *
 * @param {{ sessionId: string, token: string, roleId: number, icegateId: string }} auth
 * @param {string} gstin
 * @param {object} [options]
 * @returns {Promise<{ gstin: string, requestBody: object, response: unknown }>}
 */
async function fetchGstinEnquiry(auth, gstin, options = {}) {
  const requestBody = buildGstinEnquiryBody(auth, gstin, options.sbMonthAndYear);

  logGstinEnquiry("request", {
    gstin,
    iec: requestBody.iec,
    icegateId: requestBody.icegateId,
    roleId: requestBody.roleId,
    sbMonthAndYear: requestBody.sbMonthAndYear,
    sessionId: maskValue(auth.sessionId),
    tokenLength: String(auth.token || "").length,
  });

  const timeoutMs = options.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GSTIN_ENQUIRY_URL, {
      method: "POST",
      headers: buildGstinEnquiryHeaders(auth),
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const text = await res.text();
    let response;
    try {
      response = text ? JSON.parse(text) : null;
    } catch {
      response = text;
    }

    if (!res.ok) {
      logGstinEnquiry("response failed", {
        gstin,
        iec: requestBody.iec,
        roleId: requestBody.roleId,
        httpStatus: res.status,
      });
      const err = new Error(`GSTIN enquiry failed for ${gstin}: HTTP ${res.status}`);
      err.status = res.status;
      err.gstin = gstin;
      err.requestBody = requestBody;
      err.body = response;
      throw err;
    }

    logGstinEnquiry("response ok", {
      gstin,
      iec: requestBody.iec,
      roleId: requestBody.roleId,
      httpStatus: res.status,
      responseType: Array.isArray(response) ? "array" : typeof response,
      recordCount: Array.isArray(response)
        ? response.length
        : response && typeof response === "object" && Array.isArray(response.data)
          ? response.data.length
          : null,
    });

    return { gstin, requestBody, response };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs GSTIN enquiry for every GST number in the list (sequential).
 *
 * @param {{ sessionId: string, token: string, roleId: number, icegateId: string }} auth
 * @param {string[]} gstNumbers
 * @param {object} [options]
 * @returns {Promise<{ sbMonthAndYear: string, icegateId: string, roleId: number, results: Array<{ gstin: string, requestBody: object, response: unknown }> }>}
 */
async function fetchGstinEnquiryForAllGstins(auth, gstNumbers, options = {}) {
  const list = Array.isArray(gstNumbers)
    ? [...new Set(gstNumbers.map((g) => String(g || "").trim()).filter(Boolean))]
    : [];

  if (!list.length) {
    throw new Error("fetchGstinEnquiryForAllGstins: at least one gstin is required.");
  }

  const sbMonthAndYear = options.sbMonthAndYear || getCurrentSbMonthAndYear();
  const results = [];

  logGstinEnquiry("batch start", {
    icegateId: String(auth.icegateId || "").trim(),
    iec: String(auth.iec || "").trim() || null,
    roleId: Number(auth.roleId),
    sessionId: maskValue(auth.sessionId),
    tokenLength: String(auth.token || "").length,
    gstinCount: list.length,
    gstins: list,
    sbMonthAndYear,
  });

  for (const gstin of list) {
    try {
      const row = await fetchGstinEnquiry(auth, gstin, { ...options, sbMonthAndYear });
      results.push({ ...row, success: true });
    } catch (err) {
      results.push({
        gstin,
        success: false,
        requestBody: err.requestBody || buildGstinEnquiryBody(auth, gstin, sbMonthAndYear),
        error: err.message,
        status: err.status ?? null,
        response: err.body ?? null,
      });
    }
  }

  logGstinEnquiry("batch done", {
    icegateId: String(auth.icegateId || "").trim(),
    iec: String(auth.iec || "").trim() || null,
    roleId: Number(auth.roleId),
    sbMonthAndYear,
    successCount: results.filter((row) => row.success !== false).length,
    failedCount: results.filter((row) => row.success === false).length,
  });

  return {
    sbMonthAndYear,
    icegateId: String(auth.icegateId || "").trim(),
    iec: String(auth.iec || "").trim(),
    roleId: Number(auth.roleId),
    results,
  };
}

/**
 * Resolves roleId from ext-login response when not passed explicitly.
 * @param {object} loginResponse
 * @param {number} [overrideRoleId]
 */
function resolveRoleIdFromLogin(loginResponse, overrideRoleId) {
  if (overrideRoleId != null && Number.isFinite(Number(overrideRoleId))) {
    console.log("[CHA without-OTP] resolveRoleIdFromLogin", {
      roleId: Number(overrideRoleId),
      source: "override",
    });
    return Number(overrideRoleId);
  }
  if (loginResponse?.lastVisitedRole != null && Number.isFinite(Number(loginResponse.lastVisitedRole))) {
    console.log("[CHA without-OTP] resolveRoleIdFromLogin", {
      roleId: Number(loginResponse.lastVisitedRole),
      source: "lastVisitedRole",
    });
    return Number(loginResponse.lastVisitedRole);
  }
  const roles = loginResponse?.approvedRoles?.userRoles;
  if (Array.isArray(roles) && roles.length > 0 && roles[0]?.roleId != null) {
    console.log("[CHA without-OTP] resolveRoleIdFromLogin", {
      roleId: Number(roles[0].roleId),
      source: "approvedRoles[0]",
      approvedRoleIds: roles.map((role) => role?.roleId).filter((id) => id != null),
    });
    return Number(roles[0].roleId);
  }
  throw new Error("resolveRoleIdFromLogin: roleId not found in login response.");
}

module.exports = {
  GSTIN_ENQUIRY_URL,
  GET_IEC_URL,
  getCurrentSbMonthAndYear,
  buildGstinEnquiryBody,
  buildIcegateAuthHeaders,
  buildGstinEnquiryHeaders,
  fetchIecFromIcegate,
  resolveAuthIecForEnquiry,
  extractPanFromGstin,
  buildPanCandidates,
  fetchGstinEnquiry,
  fetchGstinEnquiryForAllGstins,
  resolveRoleIdFromLogin,
};
