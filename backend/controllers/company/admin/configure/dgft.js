const { verifyDgftLogin } = require("../../../../web_scraping/djft/main");
const {
  getStoredDgftCredentials,
  upsertDgftCredentials,
} = require("#utils/dgftCredentials");
const {
  sanitizeDgftCred,
  getDgftPasswordAlertEmails,
  saveDgftPasswordAlertEmails,
} = require("#utils/configure");
const { resolveDgftSession } = require("../../../../web_scraping/djft/dricat/dgft_session");
const { normalizeEmailList, fireWrongPasswordAlert } = require("#utils/passwordAlert");

/**
 * POST /api/company/admin/configure/dgft/get-id-pass
 * Returns DGFT credentials for this company from `configure.dgft`, else from env.
 */
async function getDgftIdPass(req, res) {
  if (!req.companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const stored = await getStoredDgftCredentials(req.companyId);
  if (stored) {
    return res.status(200).json({
      success: true,
      dgft: sanitizeDgftCred(stored),
      configured: true,
      source: "database",
    });
  }

  const id = String(process.env.DGFT_USERNAME ?? process.env.DGFT_USER_ID ?? "").trim();
  const password = String(process.env.DGFT_PASSWORD ?? "").trim();

  return res.status(200).json({
    success: true,
    dgft: sanitizeDgftCred({ username: id, password }),
    configured: Boolean(id && password),
    source: id && password ? "environment" : "none",
  });
}

/**
 * POST /api/company/admin/configure/dgft/add-id-pass
 * Body: { id, password } — verifies against DGFT, then stores in `configure.dgft` for this company.
 */
async function postVerifyDgftLogin(req, res) {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const body = req.body || {};
  const id = body.id ?? body.username ?? body.userId ?? "";
  const password = body.password ?? "";

  if (!String(id).trim() || !String(password).length) {
    return res.status(400).json({
      success: false,
      message: "Provide `id` and `password` for DGFT (or `username` instead of id).",
    });
  }

  try {
    await verifyDgftLogin({
      username: String(id).trim(),
      password: String(password),
      maxLoginRetries: body.maxLoginRetries,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "DGFT login verification failed.";
    const lower = msg.toLowerCase();
    const isAuth =
      lower.includes("invalid username") ||
      lower.includes("password") ||
      lower.includes("login failed") ||
      lower.includes("invalid id pass") ||
      lower.includes("required");
    fireWrongPasswordAlert({
      companyId,
      portal: "dgft",
      accountId: String(id).trim(),
      error,
    });
    return res.status(isAuth ? 401 : 502).json({
      success: false,
      message: msg,
    });
  }

  try {
    await upsertDgftCredentials(companyId, String(id).trim(), String(password));
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "DGFT login succeeded but saving credentials to the database failed.",
    });
  }

  let sessionSaved = false;
  try {
    await resolveDgftSession({
      companyId,
      username: String(id).trim(),
      password: String(password),
      maxLoginRetries: body.maxLoginRetries,
      forceRefresh: true,
    });
    sessionSaved = true;
  } catch (error) {
    console.warn(
      "[dgft] credentials saved but session scrape failed:",
      error instanceof Error ? error.message : error
    );
  }

  return res.status(200).json({
    success: true,
    message: sessionSaved
      ? "DGFT login succeeded; credentials and session saved for this company."
      : "DGFT login succeeded; credentials saved (session scrape failed — will retry on next DGFT request).",
    sessionSaved,
  });
}

/**
 * GET password alert emails for DGFT wrong-password notifications.
 */
async function getDgftPasswordAlertEmailsHandler(req, res) {
  if (!req.companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const emails = await getDgftPasswordAlertEmails(req.companyId);
  return res.status(200).json({
    success: true,
    emails,
    count: emails.length,
  });
}

/**
 * POST password alert emails for DGFT wrong-password notifications.
 */
async function saveDgftPasswordAlertEmailsHandler(req, res) {
  if (!req.companyId) {
    return res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
  }

  const raw = req.body?.emails ?? req.body?.passwordAlertEmails ?? [];
  const emails = normalizeEmailList(raw);
  const saved = await saveDgftPasswordAlertEmails(req.companyId, emails);

  return res.status(200).json({
    success: true,
    message: "DGFT password alert emails saved.",
    emails: saved,
    count: saved.length,
  });
}

module.exports = {
  getDgftIdPass,
  postVerifyDgftLogin,
  getDgftPasswordAlertEmailsHandler,
  saveDgftPasswordAlertEmailsHandler,
};
