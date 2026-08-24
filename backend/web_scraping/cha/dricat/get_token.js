const fetch = require("node-fetch");

const EXT_LOGIN_URL = "https://foservices.icegate.gov.in/identity/ext-login";

function isInvalidCredentialsResponse(data) {
  if (!data || typeof data !== "object") return false;
  const errorCode = Number(data.errorCode);
  if (errorCode === 409) return true;
  const errors = Array.isArray(data.errors) ? data.errors : [];
  return errors.some((entry) => /invalid\s*credentials/i.test(String(entry || "")));
}

function throwExtLoginError(httpStatus, data) {
  const message = isInvalidCredentialsResponse(data)
    ? "Invalid Credentials"
    : Array.isArray(data?.errors) && data.errors.length
      ? String(data.errors[0]).trim()
      : `ext-login failed: HTTP ${httpStatus}`;

  const err = new Error(message);
  err.status = isInvalidCredentialsResponse(data) ? 401 : httpStatus || 400;
  err.body = {
    success: false,
    message,
    errorCode: data?.errorCode,
    errors: data?.errors,
  };
  throw err;
}

/**
 * POST /identity/ext-login with the browser-captured body (encrypted password).
 *
 * @param {{ icegateId: string, password: string, usertype?: string }} requestBody
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<object>} Parsed JSON response (sessionId, token, etc.)
 */
async function extLoginWithRequestBody(requestBody, options = {}) {
  if (!requestBody || typeof requestBody !== "object") {
    throw new Error("extLoginWithRequestBody: requestBody is required.");
  }
  const icegateId = String(requestBody.icegateId || "").trim();
  const password = String(requestBody.password || "").trim();
  if (!icegateId || !password) {
    throw new Error("extLoginWithRequestBody: icegateId and password are required in requestBody.");
  }

  const body = {
    icegateId,
    password,
    usertype: String(requestBody.usertype || "external").trim() || "external",
  };

  const timeoutMs = options.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(EXT_LOGIN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Origin: "https://foservices.icegate.gov.in",
        Referer: "https://foservices.icegate.gov.in/",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok || isInvalidCredentialsResponse(data)) {
      throwExtLoginError(res.status, data);
    }

    if (!data.sessionId || !data.token) {
      throwExtLoginError(res.status, data);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  EXT_LOGIN_URL,
  extLoginWithRequestBody,
};
