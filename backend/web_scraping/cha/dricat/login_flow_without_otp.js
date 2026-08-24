const { captureExtLoginRequestBody } = require("./get_req_body");
const { extLoginWithRequestBody } = require("./get_token");

/**
 * POST /identity/ext-login using a previously captured encrypted password (no Selenium).
 *
 * @param {string} icegateId
 * @param {string} encryptedPassword
 * @param {object} [options]
 * @returns {Promise<{ extLoginResponse: object, requestBody: object, capturedViaSelenium: boolean }>}
 */
async function icegateExtLoginWithEncryptedPassword(icegateId, encryptedPassword, options = {}) {
  const email = String(icegateId || "").trim();
  const password = String(encryptedPassword || "").trim();
  if (!email || !password) {
    throw new Error("icegateExtLoginWithEncryptedPassword: icegateId and encryptedPassword are required.");
  }

  const requestBody = {
    icegateId: email,
    password,
    usertype: String(options.usertype || "external").trim() || "external",
  };

  console.log("[CHA without-OTP] ext-login stored encrypted password", {
    icegateId: email,
    encryptedPasswordLength: password.length,
  });

  const extLoginResponse = await extLoginWithRequestBody(requestBody, {
    timeoutMs: options.apiTimeoutMs ?? options.timeoutMs,
  });

  console.log("[CHA without-OTP] ext-login api ok", {
    icegateId: extLoginResponse?.icegateId || email,
    loginMethod: "stored-encrypted-password",
    sessionId: String(extLoginResponse?.sessionId || "").slice(0, 4) + "…",
    tokenLength: String(extLoginResponse?.token || "").length,
    lastVisitedRole: extLoginResponse?.lastVisitedRole ?? null,
  });

  return { extLoginResponse, requestBody, capturedViaSelenium: false };
}

/**
 * 1) Selenium: fill plain password on ICEGATE login and capture encrypted ext-login body.
 * 2) HTTP POST: call /identity/ext-login and return sessionId + token response.
 *
 * @param {string} icegateId
 * @param {string} password - plain ICEGATE password from configure.cha.sections
 * @param {object} [options]
 * @returns {Promise<{ extLoginResponse: object, requestBody: object, capturedViaSelenium: boolean }>}
 */
async function icegateExtLoginWithoutOtp(icegateId, password, options = {}) {
  console.log("[CHA without-OTP] ext-login selenium start", {
    icegateId,
    timeoutMs: options.timeoutMs,
    captureTimeoutMs: options.captureTimeoutMs ?? options.extLoginCaptureTimeoutMs,
  });

  const requestBody = await captureExtLoginRequestBody(icegateId, password, {
    gridUrl: options.gridUrl,
    timeoutMs: options.timeoutMs,
    captureTimeoutMs: options.captureTimeoutMs ?? options.extLoginCaptureTimeoutMs,
  });

  console.log("[CHA without-OTP] ext-login selenium captured", {
    icegateId: requestBody?.icegateId || icegateId,
    usertype: requestBody?.usertype || "external",
    passwordCaptured: Boolean(requestBody?.password),
  });

  const extLoginResponse = await extLoginWithRequestBody(requestBody, {
    timeoutMs: options.apiTimeoutMs ?? options.timeoutMs,
  });

  console.log("[CHA without-OTP] ext-login api ok", {
    icegateId: extLoginResponse?.icegateId || icegateId,
    loginMethod: "selenium",
    sessionId: String(extLoginResponse?.sessionId || "").slice(0, 4) + "…",
    tokenLength: String(extLoginResponse?.token || "").length,
    lastVisitedRole: extLoginResponse?.lastVisitedRole ?? null,
  });

  return { extLoginResponse, requestBody, capturedViaSelenium: true };
}

/**
 * Prefer stored encryptedPassword (email + encrypted ext-login password).
 * Falls back to Selenium + plain password when encrypted password is missing.
 *
 * @param {{ email?: string, password?: string, encryptedPassword?: string }} section
 * @param {object} [options]
 */
async function icegateExtLoginForChaSection(section, options = {}) {
  const icegateId = String(section?.email || section?.icegateId || "").trim();
  const encryptedPassword = String(section?.encryptedPassword || "").trim();
  const plainPassword = String(section?.password || "").trim();

  if (!icegateId) {
    throw new Error("icegateExtLoginForChaSection: section email (icegateId) is required.");
  }

  if (encryptedPassword) {
    return icegateExtLoginWithEncryptedPassword(icegateId, encryptedPassword, options);
  }

  if (!plainPassword) {
    throw new Error(
      "CHA section has no encryptedPassword. Save credentials via POST /api/company/admin/configure/cha/credential to capture it, or provide a plain password."
    );
  }

  console.log("[CHA without-OTP] encryptedPassword missing; falling back to Selenium", {
    icegateId,
  });
  return icegateExtLoginWithoutOtp(icegateId, plainPassword, options);
}

module.exports = {
  icegateExtLoginWithEncryptedPassword,
  icegateExtLoginWithoutOtp,
  icegateExtLoginForChaSection,
};
