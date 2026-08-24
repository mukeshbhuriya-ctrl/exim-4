const { getChaConfigure } = require("#utils/cha");
const { icegateExtLoginForChaSection } = require("../../../../web_scraping/cha/dricat/login_flow_without_otp");
const { icegateLoginAndGetCookies } = require("../../../../web_scraping/cha/login_token");
const {
  fetchGstinEnquiryForAllGstins,
  resolveRoleIdFromLogin,
  resolveAuthIecForEnquiry,
  extractPanFromGstin,
} = require("../../../../web_scraping/cha/dricat/get_cha_data");
const { getChaOtpGmailAccessSession } = require("#fetch_utils/gmail");
const {
  saveGstEnquiryResultsToChaData,
  listChaDataForCompany,
  normalizeSbMonthAndYear,
  getCurrentSbMonthAndYear,
} = require("#utils/chaData");

function maskValue(value, head = 4, tail = 4) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (s.length <= head + tail) return "*".repeat(s.length);
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function logChaWithoutOtp(step, details) {
  console.log(`[CHA without-OTP] ${step}`, details);
}

function summarizeGstEnquiryResults(results) {
  return (results || []).map((row) => {
    const response = row.response;
    let recordCount = null;
    if (Array.isArray(response)) {
      recordCount = response.length;
    } else if (response && typeof response === "object" && Array.isArray(response.data)) {
      recordCount = response.data.length;
    }

    return {
      gstin: row.gstin,
      success: row.success !== false,
      recordCount,
      error: row.error ?? null,
      httpStatus: row.status ?? null,
    };
  });
}

/**
 * `sbMonthAndYear` / `month` from query or body (e.g. MAY-2026). Defaults to current month.
 * @returns {{ sbMonthAndYear: string, provided: boolean, invalid: boolean }}
 */
function resolveSbMonthAndYearFromRequest(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const q = req.query || {};
  const monthRaw = [
    body.sbMonthAndYear,
    body.month,
    q.sbMonthAndYear,
    q.month,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find(Boolean);

  if (!monthRaw) {
    return {
      sbMonthAndYear: getCurrentSbMonthAndYear(),
      provided: false,
      invalid: false,
    };
  }

  const normalized = normalizeSbMonthAndYear(monthRaw);
  return {
    sbMonthAndYear: normalized || getCurrentSbMonthAndYear(),
    provided: true,
    invalid: !normalized,
  };
}

/**
 * Loads CHA credentials from Mongo for this company, runs ICEGATE Selenium login for one section,
 * resolves email OTP via Gmail (`otpcred`) when the OTP page appears, then returns cookies and sessionStorage.
 */
async function startCurrentProcess(req, res, next) {
  try {
    const configureDoc = await getChaConfigure(req.companyId);
    const sections = configureDoc?.cha?.sections;
    if (!Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({
        success: false,
        message: "CHA credentials are not configured. Save sections under POST /api/company/admin/configure/cha/credential.",
      });
    }

    const sectionIndex = Math.max(
      0,
      Math.min(
        sections.length - 1,
        Number.parseInt(String(req.query.sectionIndex ?? "0"), 10) || 0
      )
    );
    const section = sections[sectionIndex];
    if (!section || !section.email || !section.password) {
      return res.status(400).json({
        success: false,
        message: `Invalid CHA section at index ${sectionIndex}.`,
      });
    }

    const rawOtp =
      configureDoc.cha?.otpcred &&
      typeof configureDoc.cha.otpcred === "object" &&
      String(configureDoc.cha.otpcred.provider || "").trim()
        ? configureDoc.cha.otpcred
        : null;

    const otpcred = rawOtp
      ? {
          provider: String(rawOtp.provider || ""),
          payload: {
            labelsName: String(
              rawOtp.payload?.labelsName || rawOtp.payload?.filterName || rawOtp.payload?.name || ""
            ),
            clientId: String(rawOtp.payload?.clientId || ""),
            clientSecret: String(rawOtp.payload?.clientSecret || ""),
            redirectUri: String(rawOtp.payload?.redirectUri || ""),
            refreshToken: String(rawOtp.payload?.refreshToken || ""),
          },
        }
      : null;

    if (!otpcred || String(otpcred.provider).toLowerCase() !== "gmail") {
      return res.status(400).json({
        success: false,
        message:
          "Gmail OTP credentials are required for this flow. Save them under POST /api/company/admin/configure/cha/otp/credential.",
      });
    }
    const p = otpcred.payload;
    if (!p.labelsName || !p.clientId || !p.clientSecret || !p.refreshToken) {
      return res.status(400).json({
        success: false,
        message: "otpcred.payload must include labelsName, clientId, clientSecret, and refreshToken.",
      });
    }

    const gmailSession = await getChaOtpGmailAccessSession(otpcred);

    const gmailAuth = {
      accessToken: gmailSession.accessToken,
      labelsName: gmailSession.labelsName,
      refreshAccessToken: gmailSession.refreshAccessToken,
    };

    const { cookies, cookieHeader, sessionStorage, loginOtpSinceMs, otpResult } =
      await icegateLoginAndGetCookies(section.email, section.password, {
        gmailAuth,
        otpcred,
      });

    const includeCookies = String(req.query.includeCookies || "").toLowerCase() === "true";
    const sessionStorageKeys = Object.keys(sessionStorage || {});
    return res.status(200).json({
      success: true,
      message: "ICEGATE login (and OTP if required) finished.",
      sectionIndex,
      icegateId: section.email,
      gstNumbers: Array.isArray(section.gstNumbers) ? section.gstNumbers : [],
      cookiesCount: cookies.length,
      sessionStorageCount: sessionStorageKeys.length,
      loginOtpSinceMs,
      otpResult: otpResult || null,
      cookieHeader,
      sessionStorage: sessionStorage || {},
      ...(includeCookies ? { cookies } : {}),
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Process one CHA config section: ext-login + GST enquiry + save to chadata.
 */
async function processOneChaSectionWithoutOtp(
  companyId,
  section,
  sectionIndex,
  { sbMonthAndYear, apiTimeoutMs, roleIdOverride, extLoginCaptureTimeoutMs }
) {
  if (!section || !section.email) {
    return {
      success: false,
      sectionIndex,
      icegateId: section?.email || "",
      message: `Invalid CHA section at index ${sectionIndex}.`,
    };
  }

  const encryptedPassword = String(section.encryptedPassword || "").trim();
  const plainPassword = String(section.password || "").trim();
  if (!encryptedPassword && !plainPassword) {
    return {
      success: false,
      sectionIndex,
      icegateId: section.email,
      message:
        `CHA section at index ${sectionIndex} has no encryptedPassword or plain password. ` +
        "Save credentials via POST /api/company/admin/configure/cha/credential.",
    };
  }

  const gstNumbers = Array.isArray(section.gstNumbers)
    ? section.gstNumbers.map((g) => String(g || "").trim()).filter(Boolean)
    : [];
  if (!gstNumbers.length) {
    return {
      success: false,
      sectionIndex,
      icegateId: section.email,
      message: `No gstNumbers on CHA section at index ${sectionIndex}. Add GSTINs under POST /api/company/admin/configure/cha/credential.`,
    };
  }

  // Locked after a previous wrong-password failure — skip login, only notify.
  if (section.passwordIsWrong === true) {
    logChaWithoutOtp("section skipped (passwordIsWrong)", {
      companyId: String(companyId),
      sectionIndex,
      icegateId: section.email,
    });
    const skipError = new Error(
      "Invalid Credentials — passwordIsWrong=true; update CHA password in Configure."
    );
    skipError.status = 401;
    const { fireWrongPasswordAlert } = require("#utils/passwordAlert");
    fireWrongPasswordAlert({
      companyId,
      portal: "cha",
      accountId: section.email,
      error: skipError,
      knownWrong: true,
    });
    return {
      success: false,
      skipped: true,
      reason: "password_is_wrong",
      sectionIndex,
      icegateId: section.email,
      message:
        "CHA password is marked wrong (passwordIsWrong=true). Skipped login; alert email sent. Update password in Configure → CHA.",
    };
  }

  const captureTimeoutMs = Number.isFinite(extLoginCaptureTimeoutMs)
    ? extLoginCaptureTimeoutMs
    : apiTimeoutMs;

  logChaWithoutOtp("section start", {
    companyId: String(companyId),
    sectionIndex,
    icegateId: section.email,
    hasEncryptedPassword: Boolean(encryptedPassword),
    pan: String(section.pan || "").trim() || null,
    panFromGstin: extractPanFromGstin(gstNumbers[0]) || null,
    configuredIec: String(section.iec || "").trim() || null,
    gstNumbers,
    sbMonthAndYear,
    apiTimeoutMs,
    extLoginCaptureTimeoutMs: captureTimeoutMs,
    roleIdOverride: roleIdOverride ?? null,
  });

  let extLoginResult;
  try {
    extLoginResult = await icegateExtLoginForChaSection(section, {
      timeoutMs: captureTimeoutMs,
      captureTimeoutMs,
      apiTimeoutMs,
    });
  } catch (error) {
    logChaWithoutOtp("ext-login failed", {
      companyId: String(companyId),
      sectionIndex,
      icegateId: section.email,
      hasEncryptedPassword: Boolean(encryptedPassword),
      message: error instanceof Error ? error.message : String(error),
    });
    const { fireWrongPasswordAlert } = require("#utils/passwordAlert");
    fireWrongPasswordAlert({
      companyId,
      portal: "cha",
      accountId: section.email,
      error,
    });
    return {
      success: false,
      sectionIndex,
      icegateId: section.email,
      message: error instanceof Error ? error.message : "ICEGATE ext-login failed.",
    };
  }

  const { extLoginResponse, capturedViaSelenium } = extLoginResult;

  // Login succeeded — clear any previous wrong-password lock for this section.
  try {
    const { clearChaSectionPasswordIsWrong } = require("#utils/configure");
    await clearChaSectionPasswordIsWrong(companyId, section.email);
  } catch (clearErr) {
    console.warn(
      "[cha] clear passwordIsWrong failed:",
      clearErr instanceof Error ? clearErr.message : clearErr
    );
  }

  const approvedRoleIds = Array.isArray(extLoginResponse?.approvedRoles?.userRoles)
    ? extLoginResponse.approvedRoles.userRoles.map((role) => role?.roleId).filter((id) => id != null)
    : [];

  logChaWithoutOtp("ext-login ok", {
    companyId: String(companyId),
    sectionIndex,
    icegateId: extLoginResponse.icegateId || section.email,
    loginMethod: capturedViaSelenium ? "selenium" : "stored-encrypted-password",
    sessionId: maskValue(extLoginResponse.sessionId),
    tokenLength: String(extLoginResponse.token || "").length,
    lastVisitedRole: extLoginResponse.lastVisitedRole ?? null,
    approvedRoleIds,
  });

  const roleId = resolveRoleIdFromLogin(
    extLoginResponse,
    roleIdOverride != null ? Number(roleIdOverride) : undefined
  );

  const icegateId = extLoginResponse.icegateId || section.email;
  const pan = String(section.pan || "").trim();

  let iecInfo;
  try {
    iecInfo = await resolveAuthIecForEnquiry(
      {
        sessionId: extLoginResponse.sessionId,
        token: extLoginResponse.token,
        icegateId,
        pan,
        iec: String(section.iec || "").trim(),
      },
      {
        sectionIec: String(section.iec || "").trim(),
        pan,
        gstNumbers,
        loginResponse: extLoginResponse,
        timeoutMs: apiTimeoutMs,
      }
    );
  } catch (error) {
    logChaWithoutOtp("iec resolve failed", {
      companyId: String(companyId),
      sectionIndex,
      icegateId,
      pan: pan || null,
      gstNumbers,
      message: error instanceof Error ? error.message : String(error),
      body: error?.body ?? null,
    });
    return {
      success: false,
      sectionIndex,
      icegateId,
      message:
        error instanceof Error
          ? `Failed to resolve IEC via get-iec: ${error.message}`
          : "Failed to resolve IEC via get-iec.",
    };
  }

  logChaWithoutOtp("iec resolved", {
    companyId: String(companyId),
    sectionIndex,
    icegateId,
    panUsed: iecInfo.panUsed || pan || null,
    iec: iecInfo.iec,
    iecName: iecInfo.iecName || null,
    source: iecInfo.source,
  });

  logChaWithoutOtp("roleId resolved", {
    companyId: String(companyId),
    sectionIndex,
    icegateId,
    iec: iecInfo.iec,
    roleId,
    roleIdOverride: roleIdOverride ?? null,
    roleIdSource:
      roleIdOverride != null && Number.isFinite(Number(roleIdOverride))
        ? "override"
        : extLoginResponse?.lastVisitedRole != null
          ? "lastVisitedRole"
          : "approvedRoles[0]",
  });

  const auth = {
    sessionId: extLoginResponse.sessionId,
    token: extLoginResponse.token,
    roleId,
    icegateId,
    pan: iecInfo.panUsed || pan || extractPanFromGstin(gstNumbers[0]) || "",
    iec: iecInfo.iec,
    iecName: iecInfo.iecName || "",
  };

  logChaWithoutOtp("gst enquiry start", {
    companyId: String(companyId),
    sectionIndex,
    icegateId: auth.icegateId,
    pan: auth.pan,
    iec: auth.iec,
    roleId: auth.roleId,
    sessionId: maskValue(auth.sessionId),
    gstinCount: gstNumbers.length,
    gstNumbers,
    sbMonthAndYear,
  });

  const enquiryResult = await fetchGstinEnquiryForAllGstins(
    auth,
    gstNumbers,
    {
      sbMonthAndYear,
      timeoutMs: apiTimeoutMs,
    }
  );

  logChaWithoutOtp("gst enquiry done", {
    companyId: String(companyId),
    sectionIndex,
    icegateId: enquiryResult.icegateId,
    iec: enquiryResult.iec,
    roleId: enquiryResult.roleId,
    sbMonthAndYear: enquiryResult.sbMonthAndYear,
    results: summarizeGstEnquiryResults(enquiryResult.results),
  });

  const chaDataSaved = await saveGstEnquiryResultsToChaData(companyId, enquiryResult, {
    sectionIndex,
  });

  logChaWithoutOtp("cha data saved", {
    companyId: String(companyId),
    sectionIndex,
    icegateId,
    iec: iecInfo.iec,
    sbMonthAndYear,
    chaDataSaved,
  });

  return {
    success: true,
    sectionIndex,
    icegateId,
    iec: iecInfo.iec,
    iecName: iecInfo.iecName || "",
    iecSource: iecInfo.source,
    gstNumbers,
    extLogin: extLoginResponse,
    gstEnquiry: enquiryResult,
    chaDataSaved,
  };
}

function resolveChaSectionIndexes(req, sectionsLength) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const q = req.query || {};
  const raw = q.sectionIndex ?? body.sectionIndex;

  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const idx = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= sectionsLength) {
      return { indexes: [], invalid: true };
    }
    return { indexes: [idx], singleOnly: true };
  }

  return {
    indexes: Array.from({ length: sectionsLength }, (_, i) => i),
    singleOnly: false,
  };
}

function formatChaSectionError(error, sectionIndex) {
  if (error && error.status && error.body) {
    const payload =
      typeof error.body === "object" && error.body !== null
        ? error.body
        : { message: error.message };
    return {
      success: false,
      sectionIndex,
      gstin: error.gstin || null,
      message: error.message || payload.message || "CHA section process failed.",
      ...payload,
    };
  }
  return {
    success: false,
    sectionIndex,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function runChaFetchWithoutOtpForCompany(companyId, options = {}) {
  const monthRaw = options.sbMonthAndYear || options.month;
  const sbMonthAndYear = monthRaw
    ? normalizeSbMonthAndYear(monthRaw) || getCurrentSbMonthAndYear()
    : getCurrentSbMonthAndYear();

  if (monthRaw && !normalizeSbMonthAndYear(monthRaw)) {
    return {
      success: false,
      message: "Invalid sbMonthAndYear. Use format MON-YYYY (e.g. MAY-2026).",
    };
  }

  const configureDoc = await getChaConfigure(companyId);
  const sections = configureDoc?.cha?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    return {
      success: false,
      message:
        "CHA credentials are not configured. Save sections under POST /api/company/admin/configure/cha/credential.",
    };
  }

  let indexes;
  if (options.sectionIndex != null && String(options.sectionIndex).trim() !== "") {
    const idx = Number.parseInt(String(options.sectionIndex), 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= sections.length) {
      return {
        success: false,
        message: `sectionIndex must be between 0 and ${sections.length - 1}.`,
      };
    }
    indexes = [idx];
  } else {
    indexes = Array.from({ length: sections.length }, (_, i) => i);
  }

  const apiTimeoutMs = Number.parseInt(String(options.apiTimeoutMs ?? "60000"), 10);
  const timeoutMs = Number.isFinite(apiTimeoutMs) ? apiTimeoutMs : 60_000;
  const extLoginCaptureTimeoutMs = Number.parseInt(
    String(options.extLoginCaptureTimeoutMs ?? options.captureTimeoutMs ?? timeoutMs),
    10
  );
  const captureTimeoutMs = Number.isFinite(extLoginCaptureTimeoutMs)
    ? extLoginCaptureTimeoutMs
    : timeoutMs;
  const roleIdOverride =
    options.roleId != null ? Number(options.roleId) : undefined;

  const accounts = [];
  const errors = [];

  for (const sectionIndex of indexes) {
    const section = sections[sectionIndex];
    try {
      const result = await processOneChaSectionWithoutOtp(
        companyId,
        section,
        sectionIndex,
        {
          sbMonthAndYear,
          apiTimeoutMs: timeoutMs,
          extLoginCaptureTimeoutMs: captureTimeoutMs,
          roleIdOverride,
        }
      );
      if (result.success) {
        accounts.push(result);
      } else {
        errors.push(result);
      }
    } catch (error) {
      errors.push(formatChaSectionError(error, sectionIndex));
    }
  }

  const processedSections = accounts.length;
  const failedSections = errors.length;
  const allOk = failedSections === 0;

  return {
    success: allOk,
    message: allOk
      ? `CHA data fetched and saved for ${processedSections} account(s).`
      : processedSections > 0
        ? `CHA data saved for ${processedSections} account(s); ${failedSections} failed.`
        : "CHA fetch failed for all configured accounts.",
    sbMonthAndYear,
    totalSections: indexes.length,
    processedSections,
    failedSections,
    accounts: accounts.map((a) => ({
      sectionIndex: a.sectionIndex,
      icegateId: a.icegateId,
      gstNumbers: a.gstNumbers,
      chaDataSaved: a.chaDataSaved,
      gstEnquirySummary: {
        gstinCount: a.gstEnquiry?.results?.length ?? 0,
      },
    })),
    errors,
  };
}

/**
 * ICEGATE ext-login using plain password (Selenium capture, no OTP), then GSTIN enquiry per GST.
 * Processes all configured CHA accounts by default; pass sectionIndex to run one account only.
 */
async function startCurrentProcessWithoutOtp(req, res, next) {
  try {
    const monthResolved = resolveSbMonthAndYearFromRequest(req);
    if (monthResolved.invalid) {
      return res.status(400).json({
        success: false,
        message: "Invalid sbMonthAndYear. Use format MON-YYYY (e.g. MAY-2026).",
      });
    }

    const configureDoc = await getChaConfigure(req.companyId);
    const sections = configureDoc?.cha?.sections;
    if (!Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({
        success: false,
        message: "CHA credentials are not configured. Save sections under POST /api/company/admin/configure/cha/credential.",
      });
    }

    const { indexes, invalid, singleOnly } = resolveChaSectionIndexes(req, sections.length);
    if (invalid) {
      return res.status(400).json({
        success: false,
        message: `sectionIndex must be between 0 and ${sections.length - 1}.`,
      });
    }

    const apiTimeoutMs = Number.parseInt(String(req.query.apiTimeoutMs ?? "60000"), 10);
    const timeoutMs = Number.isFinite(apiTimeoutMs) ? apiTimeoutMs : 60_000;
    const extLoginCaptureTimeoutMs = Number.parseInt(
      String(
        req.query.extLoginCaptureTimeoutMs ??
          req.body?.extLoginCaptureTimeoutMs ??
          timeoutMs
      ),
      10
    );
    const captureTimeoutMs = Number.isFinite(extLoginCaptureTimeoutMs)
      ? extLoginCaptureTimeoutMs
      : timeoutMs;
    const roleIdOverride =
      req.query.roleId != null ? Number(req.query.roleId) : undefined;

    logChaWithoutOtp("request", {
      companyId: String(req.companyId),
      sbMonthAndYear: monthResolved.sbMonthAndYear,
      monthProvided: monthResolved.provided,
      sectionIndexes: indexes,
      singleOnly,
      apiTimeoutMs: timeoutMs,
      extLoginCaptureTimeoutMs: captureTimeoutMs,
      roleIdOverride: roleIdOverride ?? null,
      totalConfiguredSections: sections.length,
    });

    const accounts = [];
    const errors = [];

    for (const sectionIndex of indexes) {
      const section = sections[sectionIndex];
      try {
        const result = await processOneChaSectionWithoutOtp(
          req.companyId,
          section,
          sectionIndex,
          {
            sbMonthAndYear: monthResolved.sbMonthAndYear,
            apiTimeoutMs: timeoutMs,
            extLoginCaptureTimeoutMs: captureTimeoutMs,
            roleIdOverride,
          }
        );
        if (result.success) {
          accounts.push(result);
        } else {
          errors.push(result);
        }
      } catch (error) {
        const formatted = formatChaSectionError(error, sectionIndex);
        logChaWithoutOtp("section failed", {
          companyId: String(req.companyId),
          sectionIndex,
          message: formatted.message,
          gstin: formatted.gstin ?? null,
        });
        errors.push(formatted);
      }
    }

    const processedSections = accounts.length;
    const failedSections = errors.length;
    const allOk = failedSections === 0;
    const sbMonthAndYear = monthResolved.sbMonthAndYear;

    logChaWithoutOtp("request finished", {
      companyId: String(req.companyId),
      sbMonthAndYear,
      processedSections,
      failedSections,
      success: allOk,
    });

    if (singleOnly && accounts.length === 1) {
      const one = accounts[0];
      return res.status(200).json({
        success: true,
        sbMonthAndYear,
        sectionIndex: one.sectionIndex,
        extLogin: one.extLogin,
        gstEnquiry: one.gstEnquiry,
        chaDataSaved: one.chaDataSaved,
      });
    }

    if (singleOnly && errors.length === 1) {
      const err = errors[0];
      const status = err.gstin ? 502 : 400;
      return res.status(status).json({
        success: false,
        sectionIndex: err.sectionIndex,
        gstin: err.gstin || undefined,
        message: err.message,
      });
    }

    return res.status(allOk ? 200 : processedSections > 0 ? 207 : 400).json({
      success: allOk,
      message: allOk
        ? `CHA data fetched and saved for ${processedSections} account(s).`
        : processedSections > 0
          ? `CHA data saved for ${processedSections} account(s); ${failedSections} failed.`
          : "CHA fetch failed for all configured accounts.",
      sbMonthAndYear,
      totalSections: indexes.length,
      processedSections,
      failedSections,
      accounts: accounts.map((a) => ({
        sectionIndex: a.sectionIndex,
        icegateId: a.icegateId,
        gstNumbers: a.gstNumbers,
        chaDataSaved: a.chaDataSaved,
        gstEnquirySummary: {
          gstinCount: a.gstEnquiry?.results?.length ?? 0,
        },
      })),
      errors,
    });
  } catch (error) {
    if (error && error.status && error.body) {
      const payload =
        typeof error.body === "object" && error.body !== null ? error.body : { message: error.message };
      return res.status(error.status).json(
        error.gstin
          ? { success: false, gstin: error.gstin, message: error.message, ...payload }
          : { success: false, message: error.message || payload.message, ...payload }
      );
    }
    return next(error);
  }
}

/**
 * GET saved CHA GST enquiry rows from `chadata` (default: current sbMonthAndYear).
 * Query: `sbMonthAndYear` or `month` (e.g. MAY-2026), optional `gstin`.
 */
async function getChaData(req, res, next) {
  try {
    const monthResolved = resolveSbMonthAndYearFromRequest(req);
    if (monthResolved.invalid) {
      return res.status(400).json({
        success: false,
        message: "Invalid month. Use format MON-YYYY (e.g. MAY-2026).",
      });
    }
    const sbMonthAndYear = monthResolved.sbMonthAndYear;

    const gstin =
      typeof req.query.gstin === "string" && req.query.gstin.trim()
        ? req.query.gstin.trim().toUpperCase()
        : undefined;

    const rows = await listChaDataForCompany(req.companyId, {
      sbMonthAndYear,
      gstin,
    });

    return res.status(200).json({
      success: true,
      sbMonthAndYear,
      gstin: gstin || null,
      count: rows.length,
      rows,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  startCurrentProcess,
  startCurrentProcessWithoutOtp,
  runChaFetchWithoutOtpForCompany,
  getChaData,
};
