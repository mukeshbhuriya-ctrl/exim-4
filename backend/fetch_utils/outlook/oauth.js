const msal = require("@azure/msal-node");
const { getPdfOutlookCred } = require("#utils/pdfOutlookFetchCred");

/** Application permission scope — same as get_inbox.py */
const OUTLOOK_SCOPES = ["https://graph.microsoft.com/.default"];
const DEFAULT_OUTLOOK_SCOPES = OUTLOOK_SCOPES;

function pickField(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function normalizeOutlookCred(input = {}) {
  const payload =
    input.payload && typeof input.payload === "object" ? input.payload : input;

  return {
    tenantId: pickField(payload, ["tenantId", "tenant_id"]),
    clientId: pickField(payload, ["clientId", "client_id"]),
    clientSecret: pickField(payload, ["clientSecret", "client_secret"]),
    mailboxEmail: pickField(payload, [
      "mailboxEmail",
      "mailbox_email",
      "accountEmail",
      "account_email",
    ]),
    fromFolderName: pickField(payload, [
      "fromFolderName",
      "fromfoldername",
      "from_folder_name",
    ]),
    toFolderName: pickField(payload, ["toFolderName", "tofoldername", "to_folder_name"]),
  };
}

function buildMsalConfig(cred) {
  const tenantId = String(cred.tenantId || "").trim();
  const clientId = String(cred.clientId || "").trim();
  const clientSecret = String(cred.clientSecret || "").trim();

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("tenantId, clientId, and clientSecret are required for Outlook MSAL.");
  }

  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret,
    },
  };
}

function createOutlookMsalClient(cred) {
  return new msal.ConfidentialClientApplication(buildMsalConfig(cred));
}

/**
 * App-only token via client credentials — no user OAuth or redirect URI.
 * Mirrors acquire_token() in get_inbox.py.
 */
async function acquireOutlookAccessToken(cred) {
  const normalized = normalizeOutlookCred(cred);
  const pca = createOutlookMsalClient(normalized);

  const result = await pca.acquireTokenByClientCredential({
    scopes: OUTLOOK_SCOPES,
  });

  if (!result?.accessToken) {
    const error = result?.error || "unknown_error";
    const description = result?.error_description || "Could not acquire access token.";
    throw new Error(
      `Outlook client-credentials auth failed: ${error} - ${description}\n` +
        "Check Azure app has Application permission Mail.ReadWrite with admin consent, " +
        "and that mailboxEmail is a valid mailbox in the tenant."
    );
  }

  return {
    accessToken: result.accessToken,
    expiresOn: result.expiresOn || null,
  };
}

async function createOutlookAccessSession(config) {
  const normalized = normalizeOutlookCred(config);
  const tokenResult = await acquireOutlookAccessToken(normalized);

  return {
    accessToken: tokenResult.accessToken,
    mailboxEmail: normalized.mailboxEmail,
    config: normalized,
    refreshAccessToken: async () => {
      const refreshed = await acquireOutlookAccessToken(normalized);
      return refreshed.accessToken;
    },
  };
}

async function getCompanyPdfOutlookAccessSession(companyId) {
  if (!companyId) {
    throw new Error("getCompanyPdfOutlookAccessSession: companyId is required.");
  }

  const cred = await getPdfOutlookCred(companyId);
  if (!cred) {
    throw new Error(
      "Outlook credentials are not configured. Save them via POST /api/company/admin/configure/pdf/create-outlook-credential."
    );
  }

  const fromFolderName = String(cred.fromFolderName || "").trim();
  const toFolderName = String(cred.toFolderName || "").trim();
  if (!fromFolderName || !toFolderName) {
    throw new Error("fromFolderName and toFolderName are required in Outlook credentials.");
  }

  const mailboxEmail = pickField(cred, [
    "mailboxEmail",
    "mailbox_email",
    "accountEmail",
    "account_email",
  ]);
  if (!mailboxEmail) {
    throw new Error(
      "mailboxEmail is required in Outlook credentials. Save the target mailbox address."
    );
  }

  const session = await createOutlookAccessSession(cred);

  return {
    ...session,
    mailboxEmail,
    fromFolderName,
    toFolderName,
  };
}

module.exports = {
  DEFAULT_OUTLOOK_SCOPES,
  OUTLOOK_SCOPES,
  normalizeOutlookCred,
  acquireOutlookAccessToken,
  createOutlookAccessSession,
  getCompanyPdfOutlookAccessSession,
};
