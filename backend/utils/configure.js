const mongoose = require("mongoose");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function normalizePasswordAlertEmails(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]+/)
      : [];

  const emails = raw
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => EMAIL_RE.test(item));

  return [...new Set(emails)];
}

const chaSectionSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    encryptedPassword: { type: String, default: "" },
    /** Optional PAN for get-iec; defaults to `email` (icegateId) when omitted. */
    pan: { type: String, default: "", trim: true },
    /** Optional IEC override; when omitted, resolved via get-iec after login. */
    iec: { type: String, default: "", trim: true },
    gstNumbers: { type: [String], default: () => [] },
    /** When true, automation skips CHA login and only sends wrong-password mail. */
    passwordIsWrong: { type: Boolean, default: false },
  },
  { _id: false }
);

const gmailOtpPayloadSchema = new mongoose.Schema(
  {
    labelsName: { type: String, default: "" },
    clientId: { type: String, default: "" },
    clientSecret: { type: String, default: "" },
    redirectUri: { type: String, default: "" },
    refreshToken: { type: String, default: "" },
  },
  { _id: false }
);

const configureSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
      index: true,
    },
    pdf: {
      provider: {
        type: String,
        enum: ["", "gmail", "outlook"],
        default: "",
        trim: true,
      },
      gmail: {
        clientId: { type: String, default: "", trim: true },
        clientSecret: { type: String, default: "" },
        redirectUri: { type: String, default: "http://localhost:1010/" },
        refreshToken: { type: String, default: null },
        fromLabelName: { type: String, default: "", trim: true },
        toLabelName: { type: String, default: "", trim: true },
      },
      outlook: {
        tenantId: { type: String, default: "", trim: true },
        clientId: { type: String, default: "", trim: true },
        clientSecret: { type: String, default: "" },
        mailboxEmail: { type: String, default: "", trim: true },
        fromFolderName: { type: String, default: "", trim: true },
        toFolderName: { type: String, default: "", trim: true },
        // Legacy delegated-OAuth fields (unused with client-credentials flow)
        redirectUri: { type: String, default: "" },
        refreshToken: { type: String, default: null },
        tokenCache: { type: String, default: null },
        accountEmail: { type: String, default: "", trim: true },
        accountHomeAccountId: { type: String, default: "", trim: true },
      },
    },
    cha: {
      sections: { type: [chaSectionSchema], default: () => [] },
      passwordAlertEmails: { type: [String], default: () => [] },
      otpcred: {
        provider: { type: String, default: "" },
        payload: { type: gmailOtpPayloadSchema, default: () => ({}) },
      },
    },
    dgft: {
      username: { type: String, default: "", trim: true },
      password: { type: String, default: "" },
      passwordAlertEmails: { type: [String], default: () => [] },
      /** When true, automation skips DGFT login and only sends wrong-password mail. */
      passwordIsWrong: { type: Boolean, default: false },
      cookies: { type: mongoose.Schema.Types.Mixed, default: null },
      csrfToken: { type: String, default: "" },
      csrfHeaderName: { type: String, default: "X-CSRF-TOKEN" },
      screenId: { type: String, default: "" },
      sessionUpdatedAt: { type: Date, default: null },
    },
    sales: {
      sap: {
        id: { type: String, default: "", trim: true },
        password: { type: String, default: "" },
        sapConnection: { type: String, default: "", trim: true },
        reportTcode: { type: String, default: "", trim: true },
        uploadTcode: { type: String, default: "", trim: true },
      },
    },
    automation: {
      sales: {
        enabled: { type: Boolean, default: false },
        dataStartFrom: { type: String, default: "", trim: true },
        monthStartEffectiveDays: { type: Number, default: 0 },
        monthEndEffectiveDays: { type: Number, default: 0 },
      },
      pdf: {
        enabled: { type: Boolean, default: false },
      },
      jv: {
        enabled: { type: Boolean, default: false },
      },
    },
  },
  {
    collection: "configure",
    timestamps: true,
  }
);

const Configure =
  mongoose.models.Configure || mongoose.model("Configure", configureSchema);

function pickString(body, keys) {
  if (!body || typeof body !== "object") return "";
  for (const key of keys) {
    const value = body[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function formatRefreshTokenForResponse(value) {
  const token = value == null ? "" : String(value).trim();
  return token || "pending";
}

function normalizeCookieArray(cookies) {
  if (!Array.isArray(cookies)) return [];
  return cookies
    .map((cookie) => {
      if (!cookie || typeof cookie !== "object") return null;
      const name = String(cookie.name ?? "").trim();
      if (!name) return null;
      return {
        name,
        value: String(cookie.value ?? ""),
        domain: cookie.domain ? String(cookie.domain) : "www.dgft.gov.in",
        path: cookie.path ? String(cookie.path) : "/",
      };
    })
    .filter(Boolean);
}

async function getConfigureDoc(companyId, { lean = true } = {}) {
  if (!companyId) return null;
  const query = Configure.findOne({ companyId });
  return lean ? query.lean() : query;
}

async function ensureConfigureDoc(companyId) {
  let doc = await Configure.findOne({ companyId });
  if (!doc) {
    doc = await Configure.create({ companyId });
  }
  return doc;
}

async function loadConfigure(companyId) {
  if (!companyId) return null;
  return getConfigureDoc(companyId);
}

const LEGACY_CREDENTIAL_COLLECTIONS = ["pdfdatafetchcred", "dgftcredentials", "cha"];

/**
 * One-time: merge any rows still in legacy collections into `configure`, then drop them.
 */
async function migrateAndDropLegacyCredentialCollections() {
  const db = mongoose.connection?.db;
  if (!db) return { migratedCompanies: 0, dropped: [] };

  let migratedCompanies = 0;

  const legacyPdfDocs = await db.collection("pdfdatafetchcred").find({}).toArray();
  for (const legacy of legacyPdfDocs) {
    if (!legacy?.companyId) continue;
    await Configure.findOneAndUpdate(
      { companyId: legacy.companyId },
      {
        $set: {
          companyId: legacy.companyId,
          "pdf.gmail.clientId": String(legacy.clientId || ""),
          "pdf.gmail.clientSecret": String(legacy.clientSecret || ""),
          "pdf.gmail.refreshToken": legacy.refreshToken ?? null,
          "pdf.gmail.fromLabelName": String(legacy.fromLabelName || ""),
          "pdf.gmail.toLabelName": String(legacy.toLabelName || ""),
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    migratedCompanies += 1;
  }

  const legacyDgftDocs = await db.collection("dgftcredentials").find({}).toArray();
  for (const legacy of legacyDgftDocs) {
    if (!legacy?.companyId) continue;
    await Configure.findOneAndUpdate(
      { companyId: legacy.companyId },
      {
        $set: {
          companyId: legacy.companyId,
          "dgft.username": String(legacy.username || ""),
          "dgft.password": String(legacy.password || ""),
          "dgft.cookies": legacy.cookies ?? null,
          "dgft.csrfToken": String(legacy.csrfToken || ""),
          "dgft.csrfHeaderName": String(legacy.csrfHeaderName || "X-CSRF-TOKEN"),
          "dgft.screenId": String(legacy.screenId || ""),
          "dgft.sessionUpdatedAt": legacy.sessionUpdatedAt || null,
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    migratedCompanies += 1;
  }

  const legacyChaDocs = await db.collection("cha").find({}).toArray();
  for (const legacy of legacyChaDocs) {
    if (!legacy?.companyId) continue;
    await Configure.findOneAndUpdate(
      { companyId: legacy.companyId },
      {
        $set: {
          companyId: legacy.companyId,
          "cha.sections": Array.isArray(legacy.sections) ? legacy.sections : [],
          "cha.otpcred":
            legacy.otpcred && typeof legacy.otpcred === "object"
              ? legacy.otpcred
              : legacy.gmailOtp && typeof legacy.gmailOtp === "object"
                ? legacy.gmailOtp
                : { provider: "", payload: {} },
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    migratedCompanies += 1;
  }

  const dropped = [];
  for (const name of LEGACY_CREDENTIAL_COLLECTIONS) {
    try {
      const exists = await db.listCollections({ name }).hasNext();
      if (!exists) continue;
      await db.collection(name).drop();
      dropped.push(name);
    } catch (error) {
      console.warn(`[configure] Could not drop legacy collection "${name}":`, error);
    }
  }

  if (migratedCompanies > 0 || dropped.length > 0) {
    console.log(
      `[configure] Legacy credential migration complete (touched ${migratedCompanies} row(s), dropped: ${dropped.join(", ") || "none"})`
    );
  }

  return { migratedCompanies, dropped };
}

// --- PDF / Gmail ---

const DEFAULT_GMAIL_REDIRECT_URI = "http://localhost:1010/";
const DEFAULT_OUTLOOK_REDIRECT_URI = "http://localhost:1011/";

const PDF_MAILBOX_PROVIDERS = ["gmail", "outlook"];

function normalizeRedirectUri(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_GMAIL_REDIRECT_URI;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("redirect_uri must be a valid http or https URL.");
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("redirect_uri must use http or https.");
  }

  if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/";
    return parsed.toString();
  }

  return parsed.toString();
}

function resolveGmailOAuthRedirectUri(storedRedirectUri) {
  const fromCred = String(storedRedirectUri || "").trim();
  if (fromCred) return normalizeRedirectUri(fromCred);

  const fromEnv = String(process.env.GMAIL_OAUTH_REDIRECT_URI || "").trim();
  if (fromEnv) return normalizeRedirectUri(fromEnv);

  const port = Number(process.env.GMAIL_OAUTH_PORT || "1010");
  if (Number.isFinite(port) && port > 0) {
    return `http://localhost:${port}/`;
  }

  return DEFAULT_GMAIL_REDIRECT_URI;
}

function normalizePdfGmailBody(body = {}) {
  const refreshTokenRaw = pickString(body, ["refreshToken", "refresh_token"]);
  const redirectRaw = pickString(body, ["redirectUri", "redirect_uri"]);
  return {
    clientId: pickString(body, ["clientId", "client_id"]),
    clientSecret: pickString(body, ["clientSecret", "client_secret"]),
    redirectUri: resolveGmailOAuthRedirectUri(redirectRaw || undefined),
    refreshToken: refreshTokenRaw || null,
    fromLabelName: pickString(body, ["fromLabelName", "fromlabelname", "from_label_name"]),
    toLabelName: pickString(body, ["toLabelName", "tolabelname", "to_label_name"]),
  };
}

function sanitizePdfGmailCred(gmail = {}, meta = {}) {
  return {
    clientId: String(gmail.clientId || ""),
    clientSecret: String(gmail.clientSecret || ""),
    redirectUri: resolveGmailOAuthRedirectUri(gmail.redirectUri),
    refreshToken: formatRefreshTokenForResponse(gmail.refreshToken),
    fromLabelName: String(gmail.fromLabelName || ""),
    toLabelName: String(gmail.toLabelName || ""),
    ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
  };
}

function resolveOutlookOAuthRedirectUri(storedRedirectUri) {
  const fromCred = String(storedRedirectUri || "").trim();
  if (fromCred) return normalizeRedirectUri(fromCred);

  const fromEnv = String(process.env.OUTLOOK_OAUTH_REDIRECT_URI || "").trim();
  if (fromEnv) return normalizeRedirectUri(fromEnv);

  const port = Number(process.env.OUTLOOK_OAUTH_PORT || "1011");
  if (Number.isFinite(port) && port > 0) {
    return `http://localhost:${port}/`;
  }

  return DEFAULT_OUTLOOK_REDIRECT_URI;
}

function normalizePdfOutlookBody(body = {}) {
  const mailboxEmail = pickString(body, [
    "mailboxEmail",
    "mailbox_email",
    "accountEmail",
    "account_email",
  ]);
  return {
    tenantId: pickString(body, ["tenantId", "tenant_id"]),
    clientId: pickString(body, ["clientId", "client_id"]),
    clientSecret: pickString(body, ["clientSecret", "client_secret"]),
    mailboxEmail,
    fromFolderName: pickString(body, [
      "fromFolderName",
      "fromfoldername",
      "from_folder_name",
    ]),
    toFolderName: pickString(body, ["toFolderName", "tofoldername", "to_folder_name"]),
  };
}

function sanitizePdfOutlookCred(outlook = {}, meta = {}) {
  const mailboxEmail = String(
    outlook.mailboxEmail || outlook.accountEmail || ""
  ).trim();
  return {
    tenantId: String(outlook.tenantId || ""),
    clientId: String(outlook.clientId || ""),
    clientSecret: String(outlook.clientSecret || ""),
    mailboxEmail,
    fromFolderName: String(outlook.fromFolderName || ""),
    toFolderName: String(outlook.toFolderName || ""),
    ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
  };
}

function normalizePdfMailboxProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return PDF_MAILBOX_PROVIDERS.includes(provider) ? provider : "";
}

function isGmailMailboxReady(gmail = {}) {
  return Boolean(
    String(gmail.clientId || "").trim() &&
      String(gmail.clientSecret || "").trim() &&
      String(gmail.fromLabelName || "").trim() &&
      String(gmail.toLabelName || "").trim() &&
      String(gmail.refreshToken || "").trim()
  );
}

function isOutlookMailboxReady(outlook = {}) {
  const mailboxEmail = String(
    outlook.mailboxEmail || outlook.accountEmail || ""
  ).trim();
  return Boolean(
    String(outlook.tenantId || "").trim() &&
      String(outlook.clientId || "").trim() &&
      String(outlook.clientSecret || "").trim() &&
      mailboxEmail &&
      String(outlook.fromFolderName || "").trim() &&
      String(outlook.toFolderName || "").trim()
  );
}

function sanitizePdfSection(pdf = {}, meta = {}) {
  return {
    provider: normalizePdfMailboxProvider(pdf.provider),
    gmail: sanitizePdfGmailCred(pdf.gmail || {}, meta),
    outlook: sanitizePdfOutlookCred(pdf.outlook || {}, meta),
  };
}

async function getPdfGmailCred(companyId) {
  const doc = await loadConfigure(companyId);
  if (!doc?.pdf?.gmail) return null;
  const gmail = doc.pdf.gmail;
  if (
    !gmail.clientId &&
    !gmail.clientSecret &&
    !gmail.fromLabelName &&
    !gmail.toLabelName &&
    gmail.refreshToken == null
  ) {
    return null;
  }
  return {
    ...gmail,
    companyId: doc.companyId,
    _id: doc._id,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function savePdfGmailCred(companyId, payload) {
  await ensureConfigureDoc(companyId);
  const doc = await Configure.findOneAndUpdate(
    { companyId },
    {
      $set: {
        "pdf.gmail.clientId": payload.clientId,
        "pdf.gmail.clientSecret": payload.clientSecret,
        "pdf.gmail.redirectUri": payload.redirectUri,
        "pdf.gmail.refreshToken": payload.refreshToken,
        "pdf.gmail.fromLabelName": payload.fromLabelName,
        "pdf.gmail.toLabelName": payload.toLabelName,
      },
    },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
  return doc;
}

async function updatePdfGmailRefreshToken(companyId, refreshToken) {
  await ensureConfigureDoc(companyId);
  return Configure.findOneAndUpdate(
    { companyId },
    { $set: { "pdf.gmail.refreshToken": refreshToken } },
    { returnDocument: "after" }
  );
}

async function getPdfOutlookCred(companyId) {
  const doc = await loadConfigure(companyId);
  if (!doc?.pdf?.outlook) return null;
  const outlook = doc.pdf.outlook;
  const mailboxEmail = String(
    outlook.mailboxEmail || outlook.accountEmail || ""
  ).trim();
  if (
    !outlook.tenantId &&
    !outlook.clientId &&
    !outlook.clientSecret &&
    !mailboxEmail &&
    !outlook.fromFolderName &&
    !outlook.toFolderName
  ) {
    return null;
  }
  return {
    ...outlook,
    mailboxEmail: mailboxEmail || outlook.mailboxEmail || "",
    companyId: doc.companyId,
    _id: doc._id,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function savePdfOutlookCred(companyId, payload) {
  await ensureConfigureDoc(companyId);
  const doc = await Configure.findOneAndUpdate(
    { companyId },
    {
      $set: {
        "pdf.outlook.tenantId": payload.tenantId,
        "pdf.outlook.clientId": payload.clientId,
        "pdf.outlook.clientSecret": payload.clientSecret,
        "pdf.outlook.mailboxEmail": payload.mailboxEmail,
        "pdf.outlook.fromFolderName": payload.fromFolderName,
        "pdf.outlook.toFolderName": payload.toFolderName,
      },
    },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
  return doc;
}

async function updatePdfOutlookOAuthTokens(companyId, tokens = {}) {
  await ensureConfigureDoc(companyId);
  const update = {};
  if (tokens.refreshToken != null) {
    update["pdf.outlook.refreshToken"] = tokens.refreshToken;
  }
  if (tokens.tokenCache != null) {
    update["pdf.outlook.tokenCache"] = tokens.tokenCache;
  }
  if (tokens.accountEmail != null) {
    update["pdf.outlook.accountEmail"] = tokens.accountEmail;
  }
  if (tokens.accountHomeAccountId != null) {
    update["pdf.outlook.accountHomeAccountId"] = tokens.accountHomeAccountId;
  }
  return Configure.findOneAndUpdate(
    { companyId },
    { $set: update },
    { returnDocument: "after" }
  );
}

async function getPdfMailboxProvider(companyId) {
  const doc = await loadConfigure(companyId);
  const provider = normalizePdfMailboxProvider(doc?.pdf?.provider);
  if (provider) return provider;

  if (isGmailMailboxReady(doc?.pdf?.gmail || {})) return "gmail";
  if (isOutlookMailboxReady(doc?.pdf?.outlook || {})) return "outlook";
  return "";
}

async function setPdfMailboxProvider(companyId, providerInput) {
  const provider = normalizePdfMailboxProvider(providerInput);
  if (!provider) {
    throw new Error("provider must be `gmail` or `outlook`.");
  }

  const doc = await loadConfigure(companyId);
  const pdf = doc?.pdf || {};

  if (provider === "gmail" && !isGmailMailboxReady(pdf.gmail || {})) {
    throw new Error(
      "Gmail is not fully configured. Save credentials, complete OAuth, and set from/to labels before selecting Gmail."
    );
  }

  if (provider === "outlook" && !isOutlookMailboxReady(pdf.outlook || {})) {
    throw new Error(
      "Outlook is not fully configured. Save tenantId, clientId, clientSecret, mailboxEmail, and from/to folders before selecting Outlook."
    );
  }

  await ensureConfigureDoc(companyId);
  return Configure.findOneAndUpdate(
    { companyId },
    { $set: { "pdf.provider": provider } },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
}

async function getPdfMailboxStatus(companyId) {
  const doc = await loadConfigure(companyId);
  const pdf = doc?.pdf || {};
  const gmail = pdf.gmail || {};
  const outlook = pdf.outlook || {};

  return {
    provider: await getPdfMailboxProvider(companyId),
    gmail: {
      ...sanitizePdfGmailCred(gmail, { updatedAt: doc?.updatedAt }),
      ready: isGmailMailboxReady(gmail),
    },
    outlook: {
      ...sanitizePdfOutlookCred(outlook, { updatedAt: doc?.updatedAt }),
      ready: isOutlookMailboxReady(outlook),
    },
  };
}

// --- DGFT ---

async function getStoredDgftCredentials(companyId) {
  const doc = await loadConfigure(companyId);
  const username = String(doc?.dgft?.username ?? "").trim();
  const password = String(doc?.dgft?.password ?? "");
  if (!username || !password) return null;
  return {
    username,
    password,
    passwordIsWrong: Boolean(doc?.dgft?.passwordIsWrong),
  };
}

async function getStoredDgftSession(companyId) {
  const doc = await loadConfigure(companyId);
  if (!doc?.dgft) return null;

  const cookies = normalizeCookieArray(doc.dgft.cookies);
  const csrfToken = String(doc.dgft.csrfToken ?? "").trim();
  if (!cookies.length && !csrfToken) return null;

  return {
    username: String(doc.dgft.username ?? "").trim(),
    password: String(doc.dgft.password ?? ""),
    cookies,
    csrfToken,
    csrfHeaderName:
      String(doc.dgft.csrfHeaderName ?? "X-CSRF-TOKEN").trim() || "X-CSRF-TOKEN",
    screenId: String(doc.dgft.screenId ?? "").trim(),
    sessionUpdatedAt: doc.dgft.sessionUpdatedAt || null,
  };
}

async function upsertDgftCredentials(companyId, username, password) {
  const u = String(username ?? "").trim();
  const p = String(password ?? "");
  if (!companyId || !u || !p) {
    throw new Error("companyId, username, and password are required to store DGFT credentials.");
  }
  await ensureConfigureDoc(companyId);
  await Configure.findOneAndUpdate(
    { companyId },
    {
      $set: {
        "dgft.username": u,
        "dgft.password": p,
        // Successful verify/save clears the wrong-password lock.
        "dgft.passwordIsWrong": false,
      },
    },
    { upsert: true }
  );
}

async function setDgftPasswordIsWrong(companyId, value = true) {
  if (!companyId) return;
  await ensureConfigureDoc(companyId);
  await Configure.findOneAndUpdate(
    { companyId },
    { $set: { "dgft.passwordIsWrong": Boolean(value) } },
    { upsert: true }
  );
}

async function isDgftPasswordWrong(companyId) {
  if (!companyId) return false;
  const doc = await loadConfigure(companyId);
  return Boolean(doc?.dgft?.passwordIsWrong);
}

async function saveDgftSession(companyId, session = {}) {
  if (!companyId) return null;

  const cookies = normalizeCookieArray(session.cookies);
  const csrfToken = String(session.csrfToken ?? "").trim();
  const csrfHeaderName =
    String(session.csrfHeaderName ?? "X-CSRF-TOKEN").trim() || "X-CSRF-TOKEN";
  const screenId = String(session.screenId ?? "").trim();

  await ensureConfigureDoc(companyId);
  return Configure.findOneAndUpdate(
    { companyId },
    {
      $set: {
        "dgft.cookies": cookies,
        "dgft.csrfToken": csrfToken,
        "dgft.csrfHeaderName": csrfHeaderName,
        "dgft.screenId": screenId,
        "dgft.sessionUpdatedAt": new Date(),
      },
    },
    { upsert: true, returnDocument: "after" }
  );
}

async function clearDgftSession(companyId) {
  if (!companyId) return null;
  return Configure.findOneAndUpdate(
    { companyId },
    {
      $set: {
        "dgft.cookies": [],
        "dgft.csrfToken": "",
        "dgft.screenId": "",
        "dgft.sessionUpdatedAt": null,
      },
    },
    { returnDocument: "after" }
  );
}

function sanitizeDgftCred(dgft = {}) {
  const username = String(dgft.username ?? "").trim();
  const password = String(dgft.password ?? "");
  return {
    id: username,
    password,
    username,
    configured: Boolean(username && password),
    passwordIsWrong: Boolean(dgft.passwordIsWrong),
  };
}

// --- Sales / SAP ---

function sanitizeSapCred(sap = {}) {
  const id = String(sap.id ?? sap.username ?? "").trim();
  const password = String(sap.password ?? "");
  const sapConnection = String(
    sap.sapConnection ?? sap.sap_connection ?? sap.SAP_CONNECTION ?? sap.connection ?? ""
  ).trim();
  const reportTcode = String(
    sap.reportTcode ?? sap.report_tcode ?? sap.REPORT_TCODE ?? ""
  ).trim();
  const uploadTcode = String(
    sap.uploadTcode ?? sap.upload_tcode ?? sap.UPLOAD_TCODE ?? ""
  ).trim();
  return {
    id,
    username: id,
    password,
    sapConnection,
    SAP_CONNECTION: sapConnection,
    connection: sapConnection,
    reportTcode,
    REPORT_TCODE: reportTcode,
    uploadTcode,
    UPLOAD_TCODE: uploadTcode,
    configured: Boolean(id && password && sapConnection && reportTcode && uploadTcode),
  };
}

async function getStoredSapCredentials(companyId) {
  const doc = await loadConfigure(companyId);
  const id = String(doc?.sales?.sap?.id ?? "").trim();
  const password = String(doc?.sales?.sap?.password ?? "");
  const sapConnection = String(doc?.sales?.sap?.sapConnection ?? "").trim();
  const reportTcode = String(doc?.sales?.sap?.reportTcode ?? "").trim();
  const uploadTcode = String(doc?.sales?.sap?.uploadTcode ?? "").trim();
  if (!id || !password || !sapConnection || !reportTcode || !uploadTcode) return null;
  return {
    id,
    username: id,
    password,
    sapConnection,
    SAP_CONNECTION: sapConnection,
    connection: sapConnection,
    reportTcode,
    REPORT_TCODE: reportTcode,
    uploadTcode,
    UPLOAD_TCODE: uploadTcode,
  };
}

async function upsertSapCredentials(
  companyId,
  id,
  password,
  reportTcode,
  uploadTcode,
  sapConnection
) {
  const sapId = String(id ?? "").trim();
  const sapPassword = String(password ?? "");
  const sapReportTcode = String(reportTcode ?? "").trim();
  const sapUploadTcode = String(uploadTcode ?? "").trim();
  const sapConn = String(sapConnection ?? "").trim();
  if (
    !companyId ||
    !sapId ||
    !sapPassword ||
    !sapConn ||
    !sapReportTcode ||
    !sapUploadTcode
  ) {
    throw new Error(
      "companyId, id, password, sapConnection, reportTcode, and uploadTcode are required to store SAP credentials."
    );
  }
  await ensureConfigureDoc(companyId);
  await Configure.findOneAndUpdate(
    { companyId },
    {
      $set: {
        "sales.sap.id": sapId,
        "sales.sap.password": sapPassword,
        "sales.sap.sapConnection": sapConn,
        "sales.sap.reportTcode": sapReportTcode,
        "sales.sap.uploadTcode": sapUploadTcode,
      },
    },
    { upsert: true }
  );
}

function sanitizeSalesConfigureSection(doc) {
  const sap = sanitizeSapCred(doc?.sales?.sap);
  return { sap };
}

// --- Automation ---

function clampEffectiveDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(31, Math.trunc(n)));
}

function sanitizeAutomationSection(doc) {
  const automation = doc?.automation || {};
  const sales = automation.sales || {};
  const pdf = automation.pdf || {};
  const jv = automation.jv || {};
  return {
    sales: {
      enabled: sales.enabled === true,
      dataStartFrom: String(sales.dataStartFrom || "").trim(),
      monthStartEffectiveDays: clampEffectiveDays(sales.monthStartEffectiveDays),
      monthEndEffectiveDays: clampEffectiveDays(sales.monthEndEffectiveDays),
    },
    pdf: {
      enabled: pdf.enabled === true,
    },
    jv: {
      enabled: jv.enabled === true,
    },
  };
}

async function upsertAutomationSettings(companyId, payload = {}) {
  const sales = payload.sales && typeof payload.sales === "object" ? payload.sales : {};
  const pdf = payload.pdf && typeof payload.pdf === "object" ? payload.pdf : {};
  const jv = payload.jv && typeof payload.jv === "object" ? payload.jv : {};

  const automation = {
    "automation.sales.enabled": sales.enabled === true,
    "automation.sales.dataStartFrom": String(sales.dataStartFrom || "").trim(),
    "automation.sales.monthStartEffectiveDays": clampEffectiveDays(sales.monthStartEffectiveDays),
    "automation.sales.monthEndEffectiveDays": clampEffectiveDays(sales.monthEndEffectiveDays),
    "automation.pdf.enabled": pdf.enabled === true,
    "automation.jv.enabled": jv.enabled === true,
  };

  await ensureConfigureDoc(companyId);
  await Configure.findOneAndUpdate({ companyId }, { $set: automation }, { upsert: true });
}

// --- CHA ---

function sanitizeChaSection(section) {
  if (!section || typeof section !== "object") return section;
  const encryptedPassword = String(section.encryptedPassword || "").trim();
  return {
    email: section.email,
    password: section.password,
    pan: String(section.pan || "").trim(),
    iec: String(section.iec || "").trim(),
    gstNumbers: Array.isArray(section.gstNumbers) ? section.gstNumbers : [],
    encryptedPassword,
    hasEncryptedPassword: Boolean(encryptedPassword),
    passwordIsWrong: Boolean(section.passwordIsWrong),
  };
}

function sanitizeChaOtpcred(otpcred) {
  if (!otpcred || typeof otpcred !== "object") {
    return {
      provider: "",
      payload: {
        labelsName: "",
        clientId: "",
        clientSecret: "",
        redirectUri: "",
        refreshToken: "",
      },
    };
  }

  return {
    provider: String(otpcred.provider || ""),
    payload: {
      labelsName: String(
        otpcred?.payload?.labelsName ||
          otpcred?.payload?.filterName ||
          otpcred?.payload?.name ||
          otpcred.name ||
          ""
      ),
      clientId: String(otpcred?.payload?.clientId || ""),
      clientSecret: String(otpcred?.payload?.clientSecret || ""),
      redirectUri: String(otpcred?.payload?.redirectUri || ""),
      refreshToken: String(otpcred?.payload?.refreshToken || ""),
    },
  };
}

function sanitizeChaSectionDoc(doc) {
  if (!doc) return null;
  const cha = doc.cha || {};
  const otpcred = sanitizeChaOtpcred(cha.otpcred);

  return {
    id: doc._id?.toString?.() || String(doc._id),
    companyId: doc.companyId?.toString?.() || String(doc.companyId),
    sections: Array.isArray(cha.sections) ? cha.sections.map(sanitizeChaSection) : [],
    otpcred,
    gmailOtp: otpcred,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function saveChaSections(companyId, sections) {
  await ensureConfigureDoc(companyId);
  return Configure.findOneAndUpdate(
    { companyId },
    { $set: { "cha.sections": sections } },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
}

async function saveChaOtpcred(companyId, otpcred) {
  await ensureConfigureDoc(companyId);
  return Configure.findOneAndUpdate(
    { companyId },
    { $set: { "cha.otpcred": otpcred } },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
}

async function updateChaSectionEncryptedPassword(companyId, sectionIndex, encryptedPassword) {
  const enc = String(encryptedPassword || "").trim();
  if (!enc) return;

  await Configure.updateOne(
    { companyId },
    {
      $set: {
        [`cha.sections.${sectionIndex}.encryptedPassword`]: enc,
        [`cha.sections.${sectionIndex}.passwordIsWrong`]: false,
      },
    }
  );
}

/**
 * Mark / clear passwordIsWrong on a CHA section matched by email (case-insensitive).
 */
async function setChaSectionPasswordIsWrong(companyId, email, value = true) {
  if (!companyId) return;
  const target = String(email || "").trim().toLowerCase();
  if (!target) return;

  const doc = await loadConfigure(companyId);
  const sections = Array.isArray(doc?.cha?.sections) ? doc.cha.sections : [];
  if (!sections.length) return;

  let changed = false;
  const next = sections.map((section) => {
    const sectionEmail = String(section?.email || "").trim().toLowerCase();
    if (sectionEmail !== target) return section;
    changed = true;
    return {
      ...(section && typeof section === "object" ? section : {}),
      email: section.email,
      password: section.password,
      encryptedPassword: section.encryptedPassword || "",
      pan: section.pan || "",
      iec: section.iec || "",
      gstNumbers: Array.isArray(section.gstNumbers) ? section.gstNumbers : [],
      passwordIsWrong: Boolean(value),
    };
  });

  if (!changed) return;
  await saveChaSections(companyId, next);
}

async function clearChaSectionPasswordIsWrong(companyId, email) {
  return setChaSectionPasswordIsWrong(companyId, email, false);
}

async function getChaPasswordAlertEmails(companyId) {
  const doc = await loadConfigure(companyId);
  return normalizePasswordAlertEmails(doc?.cha?.passwordAlertEmails);
}

async function saveChaPasswordAlertEmails(companyId, emails) {
  const list = normalizePasswordAlertEmails(emails);
  await ensureConfigureDoc(companyId);
  await Configure.findOneAndUpdate(
    { companyId },
    { $set: { "cha.passwordAlertEmails": list } },
    { upsert: true }
  );
  return list;
}

async function getDgftPasswordAlertEmails(companyId) {
  const doc = await loadConfigure(companyId);
  return normalizePasswordAlertEmails(doc?.dgft?.passwordAlertEmails);
}

async function saveDgftPasswordAlertEmails(companyId, emails) {
  const list = normalizePasswordAlertEmails(emails);
  await ensureConfigureDoc(companyId);
  await Configure.findOneAndUpdate(
    { companyId },
    { $set: { "dgft.passwordAlertEmails": list } },
    { upsert: true }
  );
  return list;
}

module.exports = {
  Configure,
  pickString,
  formatRefreshTokenForResponse,
  loadConfigure,
  getConfigureDoc,
  ensureConfigureDoc,
  migrateAndDropLegacyCredentialCollections,
  normalizeRedirectUri,
  resolveGmailOAuthRedirectUri,
  resolveOutlookOAuthRedirectUri,
  DEFAULT_GMAIL_REDIRECT_URI,
  DEFAULT_OUTLOOK_REDIRECT_URI,
  PDF_MAILBOX_PROVIDERS,
  normalizePdfGmailBody,
  normalizePdfOutlookBody,
  normalizePdfMailboxProvider,
  sanitizePdfGmailCred,
  sanitizePdfOutlookCred,
  sanitizePdfSection,
  isGmailMailboxReady,
  isOutlookMailboxReady,
  getPdfGmailCred,
  savePdfGmailCred,
  updatePdfGmailRefreshToken,
  getPdfOutlookCred,
  savePdfOutlookCred,
  updatePdfOutlookOAuthTokens,
  getPdfMailboxProvider,
  setPdfMailboxProvider,
  getPdfMailboxStatus,
  getStoredDgftCredentials,
  getStoredDgftSession,
  upsertDgftCredentials,
  setDgftPasswordIsWrong,
  isDgftPasswordWrong,
  saveDgftSession,
  clearDgftSession,
  sanitizeDgftCred,
  sanitizeSapCred,
  sanitizeSalesConfigureSection,
  sanitizeAutomationSection,
  upsertAutomationSettings,
  getStoredSapCredentials,
  upsertSapCredentials,
  sanitizeChaSection,
  sanitizeChaOtpcred,
  sanitizeChaSectionDoc,
  saveChaSections,
  saveChaOtpcred,
  updateChaSectionEncryptedPassword,
  setChaSectionPasswordIsWrong,
  clearChaSectionPasswordIsWrong,
  getChaPasswordAlertEmails,
  saveChaPasswordAlertEmails,
  getDgftPasswordAlertEmails,
  saveDgftPasswordAlertEmails,
  normalizePasswordAlertEmails,
};
