const {
  sanitizeChaSection,
  sanitizeChaOtpcred,
  sanitizeChaSectionDoc,
  saveChaSections,
  saveChaOtpcred,
  loadConfigure,
} = require("#utils/configure");
const { captureExtLoginRequestBody } = require("../web_scraping/cha/dricat/get_req_body");

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeChaSection(item = {}) {
  const email = String(item.email || "").trim();
  const password = String(item.password ?? "");
  const pan = String(item.pan || "").trim();
  const iec = String(item.iec || "").trim();
  const gstNumbers = normalizeStringArray(item.gstNumbers);

  if (!email || !password) return null;

  return { email, password, pan, iec, gstNumbers, encryptedPassword: "" };
}

/**
 * Run Selenium once per section to capture ICEGATE's encrypted ext-login password.
 */
async function enrichChaSectionsWithEncryptedPasswords(sections, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 120_000;
  const captureTimeoutMs = Number.isFinite(Number(options.captureTimeoutMs))
    ? Number(options.captureTimeoutMs)
    : timeoutMs;
  const enriched = [];

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    console.log(
      `[CHA credential] capturing encrypted password for section ${sectionIndex} (${section.email})...`
    );

    const captured = await captureExtLoginRequestBody(section.email, section.password, {
      gridUrl: options.gridUrl,
      timeoutMs,
      captureTimeoutMs,
    });

    const encryptedPassword = String(captured?.password || "").trim();
    if (!encryptedPassword) {
      throw new Error(
        `Failed to capture encrypted password for CHA section ${sectionIndex} (${section.email}).`
      );
    }

    console.log(
      `[CHA credential] encrypted password captured for section ${sectionIndex} (${section.email}).`
    );

    enriched.push({
      ...section,
      encryptedPassword,
    });
  }

  return enriched;
}

function normalizeChaBody(body = {}) {
  const rawSections = Array.isArray(body.sections) ? body.sections : [];
  const sections = rawSections.map(normalizeChaSection).filter(Boolean);
  return { sections };
}

function normalizeGmailOtpBody(body = {}) {
  const provider = String(body?.provider || "").trim().toLowerCase();
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
  const labelsName = String(
    body?.labelsName ||
      body?.filterName ||
      body?.name ||
      payload?.labelsName ||
      payload?.filterName ||
      payload?.name ||
      ""
  ).trim();
  const installed = body?.installed && typeof body.installed === "object" ? body.installed : {};
  const redirectUris = Array.isArray(installed.redirect_uris) ? installed.redirect_uris : [];

  return {
    provider,
    payload: {
      labelsName,
      clientId: String(payload?.clientId || body?.clientId || installed?.client_id || "").trim(),
      clientSecret: String(
        payload?.clientSecret || body?.clientSecret || installed?.client_secret || ""
      ).trim(),
      redirectUri: String(
        payload?.redirectUri || body?.redirectUri || redirectUris[0] || ""
      ).trim(),
      refreshToken: String(
        payload?.refreshToken ||
          payload?.refresh_token ||
          body?.refreshToken ||
          body?.refresh_token ||
          installed?.refresh_token ||
          ""
      ).trim(),
    },
  };
}

function sanitizeChaCredential(doc) {
  if (!doc) return null;
  return sanitizeChaSectionDoc(doc);
}

async function getChaConfigure(companyId) {
  return loadConfigure(companyId);
}

module.exports = {
  normalizeChaBody,
  normalizeGmailOtpBody,
  sanitizeChaCredential,
  sanitizeChaSection,
  sanitizeChaOtpcred,
  saveChaSections,
  saveChaOtpcred,
  getChaConfigure,
  enrichChaSectionsWithEncryptedPasswords,
};
