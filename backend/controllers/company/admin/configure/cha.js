const {
  normalizeChaBody,
  normalizeGmailOtpBody,
  sanitizeChaCredential,
  sanitizeChaOtpcred,
  saveChaSections,
  saveChaOtpcred,
  getChaConfigure,
  enrichChaSectionsWithEncryptedPasswords,
} = require("#utils/cha");
const {
  getChaPasswordAlertEmails,
  saveChaPasswordAlertEmails,
} = require("#utils/configure");
const { normalizeEmailList, fireWrongPasswordAlert } = require("#utils/passwordAlert");

function resolveChaSeleniumTimeouts(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const q = req.query || {};
  const raw =
    body.captureTimeoutMs ??
    body.seleniumTimeoutMs ??
    q.captureTimeoutMs ??
    q.seleniumTimeoutMs ??
    "120000";
  const ms = Number.parseInt(String(raw), 10);
  return Number.isFinite(ms) && ms > 0 ? ms : 120_000;
}

async function getcredential(req, res, next) {
  try {
    const doc = await getChaConfigure(req.companyId);

    return res.status(200).json({
      success: true,
      cha: sanitizeChaCredential(doc),
    });
  } catch (error) {
    return next(error);
  }
}

async function createcredential(req, res, next) {
  try {
    const payload = normalizeChaBody(req.body);

    if (!payload.sections.length) {
      return res.status(400).json({
        success: false,
        message:
          "At least one section with email, password, and optional pan, iec, and gstNumbers is required.",
      });
    }

    const timeoutMs = resolveChaSeleniumTimeouts(req);
    let sectionsToSave;

    try {
      sectionsToSave = await enrichChaSectionsWithEncryptedPasswords(payload.sections, {
        timeoutMs,
        captureTimeoutMs: timeoutMs,
      });
    } catch (error) {
      for (const section of payload.sections) {
        fireWrongPasswordAlert({
          companyId: req.companyId,
          portal: "cha",
          accountId: section.email,
          error,
        });
      }
      return res.status(502).json({
        success: false,
        message:
          error instanceof Error
            ? `Could not capture encrypted ICEGATE password via Selenium: ${error.message}`
            : "Could not capture encrypted ICEGATE password via Selenium.",
      });
    }

    const existing = await getChaConfigure(req.companyId);
    // Successful encrypt/save means credentials are valid — clear wrong-password locks.
    const sectionsWithFlag = sectionsToSave.map((section) => ({
      ...section,
      passwordIsWrong: false,
    }));
    const doc = await saveChaSections(req.companyId, sectionsWithFlag);

    return res.status(existing?.cha?.sections?.length ? 200 : 201).json({
      success: true,
      message: existing?.cha?.sections?.length
        ? "CHA credentials replaced. Encrypted ICEGATE password(s) captured and saved."
        : "CHA credentials created. Encrypted ICEGATE password(s) captured and saved.",
      cha: sanitizeChaCredential(doc),
    });
  } catch (error) {
    return next(error);
  }
}

async function postGmailOtp(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const otpBody = normalizeGmailOtpBody(req.body);
    if (otpBody.provider !== "gmail") {
      return res.status(400).json({
        success: false,
        message: "`provider` must be `gmail`.",
      });
    }

    const { clientId, clientSecret } = otpBody.payload;
    if (!clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        message: "`provider`, `clientId`, and `clientSecret` are required.",
      });
    }

    const doc = await saveChaOtpcred(companyId, otpBody);
    const sanitized = sanitizeChaCredential(doc);
    const otpcred = sanitized?.otpcred || { provider: "", payload: {} };

    return res.status(200).json({
      success: true,
      message: "Gmail OTP configuration saved.",
      provider: String(otpcred.provider || ""),
      payload: otpcred.payload || {},
      cha: sanitized,
    });
  } catch (error) {
    return next(error);
  }
}

async function getGmailOtp(req, res, next) {
  try {
    const doc = await getChaConfigure(req.companyId);
    const otpcred = sanitizeChaOtpcred(doc?.cha?.otpcred);

    return res.status(200).json({
      otpcred,
    });
  } catch (error) {
    return next(error);
  }
}

async function getPasswordAlertEmails(req, res, next) {
  try {
    const emails = await getChaPasswordAlertEmails(req.companyId);
    return res.status(200).json({
      success: true,
      emails,
      count: emails.length,
    });
  } catch (error) {
    return next(error);
  }
}

async function savePasswordAlertEmails(req, res, next) {
  try {
    const raw = req.body?.emails ?? req.body?.passwordAlertEmails ?? [];
    const emails = normalizeEmailList(raw);
    const saved = await saveChaPasswordAlertEmails(req.companyId, emails);
    return res.status(200).json({
      success: true,
      message: "CHA password alert emails saved.",
      emails: saved,
      count: saved.length,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createcredential,
  getcredential,
  getGmailOtp,
  postGmailOtp,
  getPasswordAlertEmails,
  savePasswordAlertEmails,
};
