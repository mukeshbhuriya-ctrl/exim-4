const BASE_URL = "https://www.dgft.gov.in/CP/webHP";
const DEFAULT_REFERER =
  "https://www.dgft.gov.in/CP/web?requestType=ApplicationRH&actionVal=checkLogin";

function stripQuotes(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function cookiesFromRawHeader(rawCookieHeader) {
  const out = [];
  for (const chunk of String(rawCookieHeader || "").split(";")) {
    const part = chunk.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    out.push({
      name,
      value,
      domain: "www.dgft.gov.in",
      path: "/",
    });
  }
  return out;
}

function buildCookieHeader(input) {
  if (Array.isArray(input)) {
    const pairs = input
      .map((c) =>
        c?.name && c?.value !== undefined && c?.value !== null
          ? `${c.name}=${c.value}`
          : null
      )
      .filter(Boolean);
    if (!pairs.length) {
      throw new Error("cookies array is empty or invalid.");
    }
    return pairs.join("; ");
  }
  const raw = stripQuotes(input);
  if (!raw) {
    throw new Error("cookie is required (raw header string or cookies array).");
  }
  const parsed = cookiesFromRawHeader(raw);
  if (!parsed.length) {
    throw new Error("cookie header does not contain valid name=value pairs.");
  }
  return parsed.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Calls DGFT preview port API and returns parsed response array.
 *
 * @param {object} params
 * @param {string|object[]} params.cookie - Raw Cookie header or cookie array.
 * @param {string} params.csrf - _csrf token.
 * @param {string} params.portOfReg - Port code like INHZA1.
 * @param {string} params.screenId - screenId (required).
 * @returns {Promise<any>} Parsed JSON response (example: [{key:683,value:"INHZA1-..."}]).
 */
async function fetchPortPreview(params = {}) {
  const csrf = stripQuotes(params.csrf);
  const portOfReg = stripQuotes(params.portOfReg);
  const screenId = stripQuotes(params.screenId);
  const cookieHeader = buildCookieHeader(params.cookie);

  if (!csrf) throw new Error("csrf is required.");
  if (!portOfReg) throw new Error("portOfReg is required.");
  if (!screenId) throw new Error("screenId is required.");
  if (!/^\d+$/.test(screenId)) {
    throw new Error(`screenId must be numeric, got: ${JSON.stringify(screenId)}`);
  }

  const endpoint =
    `${BASE_URL}?requestType=ApplicationRH&actionVal=preview` +
    `&screenId=${encodeURIComponent(screenId)}` +
    `&_csrf=${encodeURIComponent(csrf)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: cookieHeader,
      Origin: "https://www.dgft.gov.in",
      Referer: DEFAULT_REFERER,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-TOKEN": csrf,
    },
    body: `portOfReg=${encodeURIComponent(portOfReg)}`,
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`fetchPortPreview failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Expected JSON response, got: ${body.slice(0, 300)}`);
  }
}

module.exports = {
  fetchPortPreview,
};
