const {
  normalizePdfGmailFetchCredBody,
  sanitizePdfSection,
  savePdfGmailCred,
  getPdfGmailCred,
} = require("#utils/pdfGmailFetchCred");
const { loadConfigure } = require("#utils/configure");
const {
  startGmailOAuthForCompany,
  verifyOAuthState,
  exchangeGmailOAuthCode,
  buildOAuthCallbackHtml,
  getFrontendOrigin,
} = require("#fetch_utils/gmail");

async function createGmailCredential(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const payload = normalizePdfGmailFetchCredBody(req.body);

    if (!payload.clientId || !payload.clientSecret) {
      return res.status(400).json({
        success: false,
        message: "clientId and clientSecret are required.",
      });
    }

    if (!payload.fromLabelName || !payload.toLabelName) {
      return res.status(400).json({
        success: false,
        message: "fromlabelname and tolabelname are required.",
      });
    }

    const existing = await getPdfGmailCred(companyId);
    const doc = await savePdfGmailCred(companyId, payload);

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? "Gmail credentials updated." : "Gmail credentials created.",
      pdf: sanitizePdfSection(doc.pdf || { gmail: payload }, { updatedAt: doc.updatedAt }),
    });
  } catch (error) {
    return next(error);
  }
}

async function getGmailCredential(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const doc = await loadConfigure(companyId);
    const pdf = sanitizePdfSection(doc?.pdf || {});

    return res.status(200).json({
      success: true,
      pdf,
    });
  } catch (error) {
    return next(error);
  }
}

/** GET: start Gmail OAuth — returns Google verification URL for the frontend. */
async function getGmailRefreshToken(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const started = await startGmailOAuthForCompany(companyId);

    return res.status(200).json({
      success: true,
      message: started.message,
      authUrl: started.authUrl,
      verificationUrl: started.verificationUrl,
      state: started.state,
      redirectUri: started.redirectUri,
      callbackMode: started.callbackMode,
      oauthPort: started.oauthPort,
      scopes: started.scopes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|must be saved|clientId and clientSecret/i.test(message)) {
      return res.status(400).json({ success: false, message });
    }
    return next(error);
  }
}

/** GET: Google OAuth redirect — saves refresh token and returns token.json to frontend. */
async function gmailOAuthCallback(req, res, next) {
  try {
    const oauthError = String(req.query.error || "").trim();
    if (oauthError) {
      const description = String(req.query.error_description || oauthError);
      if (req.query.format === "json") {
        return res.status(400).json({ success: false, message: description });
      }
      return res.status(400).send(`Gmail authorization failed: ${description}`);
    }

    const code = req.query.code;
    const statePayload = verifyOAuthState(req.query.state);
    const result = await exchangeGmailOAuthCode({
      companyId: statePayload.companyId,
      code,
    });

    if (req.query.format === "json") {
      return res.status(200).json({
        success: true,
        message: "Gmail refresh token saved.",
        token: result.tokenJson,
        pdf: result.pdf,
      });
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(
      buildOAuthCallbackHtml(result, getFrontendOrigin())
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (req.query.format === "json") {
      return res.status(400).json({ success: false, message });
    }
    return res.status(400).send(`Gmail authorization failed: ${message}`);
  }
}

/**
 * POST: complete OAuth when redirect_uri is the frontend (send code + state from URL).
 */
async function completeGmailOAuth(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const body = req.body || {};
    const code = body.code ?? req.query.code;
    const state = body.state ?? req.query.state;

    const statePayload = verifyOAuthState(state);
    if (String(statePayload.companyId) !== String(companyId)) {
      return res.status(403).json({
        success: false,
        message: "OAuth state does not match the logged-in company.",
      });
    }

    const result = await exchangeGmailOAuthCode({ companyId, code });

    return res.status(200).json({
      success: true,
      message: "Gmail refresh token saved.",
      token: result.tokenJson,
      pdf: result.pdf,
      redirectUri: result.redirectUri,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, message });
  }
}

module.exports = {
  createGmailCredential,
  getGmailCredential,
  getGmailRefreshToken,
  gmailOAuthCallback,
  completeGmailOAuth,
};
