const crypto = require("node:crypto");
const http = require("node:http");
const { URL } = require("node:url");
const { OAuth2Client } = require("google-auth-library");
const {
  getPdfGmailCred,
  sanitizePdfSection,
  updatePdfGmailRefreshToken,
} = require("#utils/pdfGmailFetchCred");
const { resolveGmailOAuthRedirectUri } = require("#utils/configure");

const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const DEFAULT_GMAIL_SCOPES = GMAIL_SCOPES;
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const TOKEN_URI = "https://oauth2.googleapis.com/token";

/** @type {Map<number, { server: import('node:http').Server, redirectUri: string }>} */
const oauthServersByPort = new Map();
/** @type {Map<number, Promise<{ port: number, redirectUri: string, listening: boolean, mode: string }>>} */
const oauthServerReadyByPort = new Map();

function pickOAuthField(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function normalizeGmailOAuthConfig(input = {}) {
  const payload =
    input.payload && typeof input.payload === "object" ? input.payload : input;

  const redirectUri = pickOAuthField(payload, ["redirectUri", "redirect_uri"]);

  return {
    clientId: pickOAuthField(payload, ["clientId", "client_id"]),
    clientSecret: pickOAuthField(payload, ["clientSecret", "client_secret"]),
    refreshToken: pickOAuthField(payload, ["refreshToken", "refresh_token"]),
    redirectUri: redirectUri || undefined,
  };
}

async function getGmailOAuthCredentials(config) {
  const { clientId, clientSecret, refreshToken, redirectUri } =
    normalizeGmailOAuthConfig(config);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "getGmailOAuthCredentials: clientId, clientSecret, and refreshToken are required."
    );
  }

  const client = new OAuth2Client(clientId, clientSecret, redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  await client.getAccessToken();

  const creds = client.credentials;
  if (!creds.access_token) {
    throw new Error(
      "getGmailOAuthCredentials: failed to obtain access_token after refresh."
    );
  }

  return creds;
}

async function createGmailOAuthClient(config) {
  const normalized = normalizeGmailOAuthConfig(config);
  const { clientId, clientSecret, refreshToken, redirectUri } = normalized;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "createGmailOAuthClient: clientId, clientSecret, and refreshToken are required."
    );
  }

  const client = new OAuth2Client(clientId, clientSecret, redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  await client.getAccessToken();

  if (!client.credentials.access_token) {
    throw new Error(
      "createGmailOAuthClient: failed to obtain access_token after refresh."
    );
  }

  return { client, config: normalized };
}

async function createGmailAccessSession(config) {
  const normalized = normalizeGmailOAuthConfig(config);
  const credentials = await getGmailOAuthCredentials(normalized);

  return {
    accessToken: credentials.access_token,
    credentials,
    config: normalized,
    refreshAccessToken: async () => {
      const refreshed = await getGmailOAuthCredentials(normalized);
      return refreshed.access_token;
    },
  };
}

async function getCompanyPdfGmailAccessSession(companyId) {
  if (!companyId) {
    throw new Error("getCompanyPdfGmailAccessSession: companyId is required.");
  }

  const cred = await getPdfGmailCred(companyId);
  if (!cred) {
    throw new Error(
      "Gmail credentials are not configured. Save them via POST /api/company/admin/configure/pdf/create-gmail-credential."
    );
  }

  const fromLabelName = String(cred.fromLabelName || "").trim();
  const toLabelName = String(cred.toLabelName || "").trim();
  if (!fromLabelName || !toLabelName) {
    throw new Error("fromlabelname and tolabelname are required in Gmail credentials.");
  }

  const refreshToken = String(cred.refreshToken || "").trim();
  if (!refreshToken) {
    throw new Error(
      "Gmail refresh token is pending. Complete OAuth authorization before fetching mailbox PDFs."
    );
  }

  const session = await createGmailAccessSession({ ...cred, refreshToken });

  return {
    ...session,
    fromLabelName,
    toLabelName,
  };
}

async function getChaOtpGmailAccessSession(otpPayload) {
  const payload =
    otpPayload?.payload && typeof otpPayload.payload === "object"
      ? otpPayload.payload
      : otpPayload;

  const labelsName = pickOAuthField(payload, [
    "labelsName",
    "filterName",
    "name",
    "fromLabelName",
    "fromlabelname",
  ]);

  if (!labelsName) {
    throw new Error("getChaOtpGmailAccessSession: labelsName is required.");
  }

  const session = await createGmailAccessSession(payload);

  return {
    ...session,
    labelsName,
  };
}

function getJwtSecret() {
  return String(process.env.JWT_SECRET || "gmail-oauth-state-secret").trim();
}

function getFrontendOrigin() {
  const raw = String(process.env.CORS_ORIGIN || "http://localhost:4000").trim();
  return raw.split(/[,;\s]+/).map((part) => part.trim()).filter(Boolean)[0] || "http://localhost:4000";
}

function signOAuthState(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", getJwtSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifyOAuthState(state) {
  const raw = String(state || "").trim();
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) {
    throw new Error("Invalid OAuth state.");
  }

  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", getJwtSecret())
    .update(body)
    .digest("base64url");

  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("Invalid OAuth state signature.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid OAuth state payload.");
  }

  if (!payload?.companyId) {
    throw new Error("OAuth state is missing companyId.");
  }

  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || Date.now() > exp) {
    throw new Error("OAuth state has expired. Start authorization again.");
  }

  return payload;
}

function createOAuthState(companyId) {
  return signOAuthState({
    companyId: String(companyId),
    nonce: crypto.randomBytes(16).toString("hex"),
    exp: Date.now() + OAUTH_STATE_TTL_MS,
  });
}

async function loadCompanyGmailOAuthClient(companyId) {
  const cred = await getPdfGmailCred(companyId);
  if (!cred) {
    throw new Error(
      "Gmail credentials not found. Save clientId and clientSecret via POST /api/company/admin/configure/pdf/create-gmail-credential first."
    );
  }

  const clientId = String(cred.clientId || "").trim();
  const clientSecret = String(cred.clientSecret || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("clientId and clientSecret must be saved before Gmail OAuth.");
  }

  const redirectUri = resolveGmailOAuthRedirectUri(cred.redirectUri);
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);

  return { cred, client, clientId, clientSecret, redirectUri };
}

function buildGmailAuthUrl(client, state, redirectUri) {
  return client.generateAuthUrl({
    access_type: "offline",
    scope: GMAIL_SCOPES,
    prompt: "consent",
    include_granted_scopes: true,
    redirect_uri: redirectUri,
    state,
  });
}

function expiryIsoFromTokens(tokens) {
  const expiryMs = Number(tokens?.expiry_date);
  if (Number.isFinite(expiryMs) && expiryMs > 0) {
    return new Date(expiryMs).toISOString();
  }
  return null;
}

function buildTokenJson(tokens, clientId, clientSecret) {
  return {
    token: tokens.access_token || "",
    refresh_token: tokens.refresh_token || "",
    token_uri: TOKEN_URI,
    client_id: clientId,
    client_secret: clientSecret,
    scopes: tokens.scope ? String(tokens.scope).split(" ") : GMAIL_SCOPES,
    universe_domain: "googleapis.com",
    account: "",
    expiry: expiryIsoFromTokens(tokens),
  };
}

async function exchangeGmailOAuthCode({ companyId, code }) {
  const authCode = String(code || "").trim();
  if (!authCode) {
    throw new Error("Authorization code is required.");
  }

  const { client, clientId, clientSecret, cred, redirectUri } =
    await loadCompanyGmailOAuthClient(companyId);
  const { tokens } = await client.getToken({
    code: authCode,
    redirect_uri: redirectUri,
  });

  const refreshToken =
    String(tokens.refresh_token || "").trim() ||
    String(cred.refreshToken || "").trim();

  if (!refreshToken) {
    throw new Error(
      "Google did not return a refresh_token. Revoke app access in Google Account settings and try again with prompt=consent."
    );
  }

  const doc = await updatePdfGmailRefreshToken(companyId, refreshToken);

  const tokenJson = buildTokenJson(tokens, clientId, clientSecret);

  return {
    tokenJson,
    pdf: sanitizePdfSection(doc?.pdf || {}),
    refreshToken,
    redirectUri,
  };
}

function getGmailOAuthPort() {
  const port = Number(process.env.GMAIL_OAUTH_PORT || "1010");
  return Number.isFinite(port) && port > 0 ? port : 1010;
}

function getGmailOAuthRedirectUri(storedRedirectUri) {
  return resolveGmailOAuthRedirectUri(storedRedirectUri);
}

function isBackendLocalRedirectUri(redirectUri) {
  try {
    const u = new URL(redirectUri);
    const host = u.hostname.toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1";
    const path = u.pathname || "/";
    return isLocal && path === "/";
  } catch {
    return false;
  }
}

function parseLocalRedirectUri(redirectUri) {
  const u = new URL(redirectUri);
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  const host = u.hostname.toLowerCase() === "localhost" ? "localhost" : "127.0.0.1";
  return { port, host, redirectUri };
}

function buildOAuthCallbackHtml(result, frontendOrigin) {
  const payload = JSON.stringify({
    type: "GMAIL_OAUTH_SUCCESS",
    success: true,
    token: result.tokenJson,
    pdf: result.pdf,
    redirectUri: result.redirectUri,
  });
  const origin = JSON.stringify(frontendOrigin);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Gmail connected</title></head>
<body>
<p>Gmail authorization complete. This window will close automatically.</p>
<script>
(function () {
  var payload = ${payload};
  var origin = ${origin};
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(payload, origin);
    window.close();
    return;
  }
  document.body.innerHTML = "<p>Gmail connected successfully. Return to the application.</p>";
})();
</script>
</body>
</html>`;
}

async function handleOAuthLocalRequest(req, res) {
  const port = Number(req.socket.localPort);
  const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  const params = requestUrl.searchParams;

  const oauthError = params.get("error");
  if (oauthError) {
    const description = params.get("error_description") || oauthError;
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<p>Gmail authorization failed: ${description}</p>`);
    return;
  }

  const code = params.get("code");
  const state = params.get("state");

  if (!code || !state) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<p>Gmail OAuth callback is ready on this port.</p>");
    return;
  }

  const statePayload = verifyOAuthState(state);
  const result = await exchangeGmailOAuthCode({
    companyId: statePayload.companyId,
    code,
  });

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(buildOAuthCallbackHtml(result, getFrontendOrigin()));
}

function ensureGmailOAuthLocalServer(redirectUriInput) {
  const redirectUri = getGmailOAuthRedirectUri(redirectUriInput);

  if (!isBackendLocalRedirectUri(redirectUri)) {
    return Promise.resolve({
      port: null,
      redirectUri,
      listening: false,
      mode: "frontend",
    });
  }

  const { port, host } = parseLocalRedirectUri(redirectUri);

  if (oauthServerReadyByPort.has(port)) {
    return oauthServerReadyByPort.get(port);
  }

  const ready = new Promise((resolve, reject) => {
    if (oauthServersByPort.has(port)) {
      resolve({
        port,
        redirectUri: oauthServersByPort.get(port).redirectUri,
        listening: true,
        mode: "backend",
      });
      return;
    }

    const server = http.createServer((req, res) => {
      handleOAuthLocalRequest(req, res).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        }
        res.end(`<p>Gmail authorization failed: ${message}</p>`);
      });
    });

    server.listen(port, host, () => {
      oauthServersByPort.set(port, { server, redirectUri });
      console.log(`Gmail OAuth callback listening at ${redirectUri}`);
      resolve({ port, redirectUri, listening: true, mode: "backend" });
    });

    server.on("error", (error) => {
      oauthServerReadyByPort.delete(port);
      if (error?.code === "EADDRINUSE") {
        reject(
          new Error(
            `Gmail OAuth port ${port} is in use. Stop other apps on this port or use a different redirect_uri registered in Google Cloud.`
          )
        );
        return;
      }
      reject(error);
    });
  });

  oauthServerReadyByPort.set(port, ready);
  return ready;
}

async function startGmailOAuthForCompany(companyId) {
  const { client, redirectUri } = await loadCompanyGmailOAuthClient(companyId);
  const listener = await ensureGmailOAuthLocalServer(redirectUri);
  const state = createOAuthState(companyId);
  const authUrl = buildGmailAuthUrl(client, state, redirectUri);
  const callbackMode = isBackendLocalRedirectUri(redirectUri) ? "backend" : "frontend";

  return {
    authUrl,
    verificationUrl: authUrl,
    state,
    redirectUri,
    callbackMode,
    oauthPort: listener.port,
    scopes: GMAIL_SCOPES,
    message:
      callbackMode === "frontend"
        ? "Google will redirect to your frontend redirect_uri. Complete OAuth via POST /complete-gmail-oauth with code and state."
        : "Open verificationUrl in the browser. Google will redirect to the backend OAuth listener.",
  };
}

module.exports = {
  DEFAULT_GMAIL_SCOPES,
  GMAIL_SCOPES,
  normalizeGmailOAuthConfig,
  getGmailOAuthCredentials,
  createGmailOAuthClient,
  createGmailAccessSession,
  getCompanyPdfGmailAccessSession,
  getChaOtpGmailAccessSession,
  getFrontendOrigin,
  createOAuthState,
  verifyOAuthState,
  startGmailOAuthForCompany,
  exchangeGmailOAuthCode,
  buildTokenJson,
  buildOAuthCallbackHtml,
  getGmailOAuthPort,
  getGmailOAuthRedirectUri,
  isBackendLocalRedirectUri,
  ensureGmailOAuthLocalServer,
};
