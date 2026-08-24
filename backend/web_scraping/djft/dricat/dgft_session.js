const { fetchCsrfAndScreenId } = require("./backup_csrfandscreenid");
const { fetchcookie } = require("./token_scraping");
const {
  getStoredDgftSession,
  saveDgftSession,
  clearDgftSession,
  isDgftPasswordWrong,
  setDgftPasswordIsWrong,
} = require("#utils/configure");
const { fireWrongPasswordAlert } = require("#utils/passwordAlert");

function stripQuotes(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function isSessionHttpError(error) {
  const message = String(error?.message || "");
  return (
    /fetchCsrfAndScreenId failed with HTTP (403|401)/i.test(message) ||
    /Could not find _csrf token/i.test(message)
  );
}

/**
 * Returns true when stored cookies can still reach /CP/index.jsp and return CSRF.
 */
async function validateDgftSession(cookies) {
  if (!Array.isArray(cookies) || !cookies.length) {
    return { valid: false, reason: "missing_cookies" };
  }

  try {
    const csrfData = await fetchCsrfAndScreenId({ cookie: cookies });
    if (!stripQuotes(csrfData?.csrfToken)) {
      return { valid: false, reason: "missing_csrf" };
    }
    return {
      valid: true,
      cookies,
      csrfToken: stripQuotes(csrfData.csrfToken),
      csrfHeaderName: stripQuotes(csrfData.csrfHeaderName) || "X-CSRF-TOKEN",
      screenId: stripQuotes(csrfData.screenId),
    };
  } catch (error) {
    return {
      valid: false,
      reason: isSessionHttpError(error) ? "http_auth_error" : "csrf_fetch_failed",
      error,
    };
  }
}

async function loginAndBuildSession(options = {}) {
  const username = stripQuotes(options.username);
  const password = String(options.password ?? "");
  if (!username || !password) {
    throw new Error("DGFT credentials are required (username and password).");
  }

  const { cookies } = await fetchcookie({
    username,
    password,
    maxLoginRetries: options.maxLoginRetries,
    seleniumGridUrl: options.seleniumGridUrl,
  }).catch((error) => {
    fireWrongPasswordAlert({
      companyId: options.companyId,
      portal: "dgft",
      accountId: username,
      error,
    });
    throw error;
  });

  if (!Array.isArray(cookies) || !cookies.length) {
    throw new Error("DGFT login did not return cookies.");
  }

  const validated = await validateDgftSession(cookies);
  if (!validated.valid) {
    throw new Error("DGFT login succeeded but session validation failed.");
  }

  // Successful login clears wrong-password lock.
  if (options.companyId) {
    try {
      await setDgftPasswordIsWrong(options.companyId, false);
    } catch (clearErr) {
      console.warn(
        "[dgft] clear passwordIsWrong failed:",
        clearErr instanceof Error ? clearErr.message : clearErr
      );
    }
  }

  return {
    cookies: validated.cookies,
    csrfToken: validated.csrfToken,
    csrfHeaderName: validated.csrfHeaderName,
    screenId: validated.screenId,
    fromCache: false,
    refreshed: true,
  };
}

/**
 * Use stored cookies/csrf from `configure.dgft` when valid; otherwise Selenium login + save.
 *
 * @param {object} options
 * @param {string|import('mongoose').Types.ObjectId} [options.companyId]
 * @param {string} options.username
 * @param {string} options.password
 * @param {boolean} [options.forceRefresh]
 */
async function resolveDgftSession(options = {}) {
  const companyId = options.companyId;
  const username = stripQuotes(options.username);
  const password = String(options.password ?? "");
  const forceRefresh = options.forceRefresh === true;

  if (!username || !password) {
    throw new Error("DGFT credentials are required (username and password).");
  }

  // Locked after a previous wrong-password failure — skip login (unless forceRefresh
  // from Configure verify after the user updated the password).
  if (companyId && !forceRefresh && (await isDgftPasswordWrong(companyId))) {
    const skipError = new Error(
      "Invalid id pass — passwordIsWrong=true; update DGFT password in Configure."
    );
    fireWrongPasswordAlert({
      companyId,
      portal: "dgft",
      accountId: username,
      error: skipError,
      knownWrong: true,
    });
    throw skipError;
  }

  if (!forceRefresh && companyId) {
    const stored = await getStoredDgftSession(companyId);
    const storedCookies = Array.isArray(stored?.cookies) ? stored.cookies : [];

    if (storedCookies.length) {
      const validated = await validateDgftSession(storedCookies);
      if (validated.valid) {
        const session = {
          cookies: validated.cookies,
          csrfToken: validated.csrfToken,
          csrfHeaderName: validated.csrfHeaderName,
          screenId: validated.screenId,
          fromCache: true,
          refreshed: false,
        };
        await saveDgftSession(companyId, session);
        return session;
      }

      await clearDgftSession(companyId);
    }
  }

  const session = await loginAndBuildSession(options);

  if (companyId) {
    await saveDgftSession(companyId, session);
  }

  return session;
}

/**
 * Re-fetch CSRF from /CP/index.jsp using the current cookies (tokens go stale quickly).
 */
async function refreshDgftSessionCsrf(session, companyId) {
  const cookies = Array.isArray(session?.cookies) ? session.cookies : [];
  if (!cookies.length) {
    throw new Error("DGFT cookies are required to refresh CSRF.");
  }

  const fresh = await fetchCsrfAndScreenId({ cookie: cookies });
  const refreshed = {
    ...session,
    cookies,
    csrfToken: stripQuotes(fresh.csrfToken),
    csrfHeaderName: stripQuotes(fresh.csrfHeaderName) || "X-CSRF-TOKEN",
    screenId: stripQuotes(session.screenId) || stripQuotes(fresh.screenId),
  };

  if (!refreshed.csrfToken) {
    throw new Error("Could not refresh DGFT CSRF token.");
  }

  if (companyId) {
    await saveDgftSession(companyId, refreshed);
  }

  return refreshed;
}

/**
 * Resolve login session, then always refresh CSRF immediately before an API call.
 */
async function resolveDgftSessionForApi(options = {}) {
  const session = await resolveDgftSession(options);
  return refreshDgftSessionCsrf(session, options.companyId);
}

module.exports = {
  validateDgftSession,
  loginAndBuildSession,
  resolveDgftSession,
  refreshDgftSessionCsrf,
  resolveDgftSessionForApi,
  clearDgftSession,
};
