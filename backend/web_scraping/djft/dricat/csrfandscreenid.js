const INDEX_URL = "https://www.dgft.gov.in/CP/index.jsp";
const HOME_URL = "https://www.dgft.gov.in/CP/";
const CHECK_LOGIN_URL =
  "https://www.dgft.gov.in/CP/web?requestType=ApplicationRH&actionVal=checkLogin";
const REFERER_URL = CHECK_LOGIN_URL;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const CSRF_TOKEN_RES = [
  /<meta[^>]+(?:name|property)=["']_csrf["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']_csrf["']/i,
  /<meta[^>]+name=["']_csrf["'][^>]+content=["']([^"']+)["']/i,
  /<input[^>]+type=["']hidden["'][^>]+name=["']_csrf["'][^>]+value=["']([^"']+)["']/i,
  /<input[^>]+name=["']_csrf["'][^>]+value=["']([^"']+)["']/i,
  /["']_csrf["']\s*[:=]\s*["']([0-9a-f-]{8,})["']/i,
];

const CSRF_HEADER_RES = [
  /<meta[^>]+(?:name|property)=["']_csrf_header["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']_csrf_header["']/i,
  /<meta[^>]+name=["']_csrf_header["'][^>]+content=["']([^"']+)["']/i,
];

const SCREEN_ID_RE_LIST = [
  /screenId=(\d+)/i,
  /["']screenId["']\s*[:=]\s*["']?(\d+)["']?/i,
];

const CSRF_FETCH_SOURCES = [
  { url: INDEX_URL, referer: REFERER_URL, label: "index.jsp" },
  { url: HOME_URL, referer: HOME_URL, label: "CP home" },
  { url: CHECK_LOGIN_URL, referer: HOME_URL, label: "checkLogin" },
];

function stripQuotes(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function cookieHeaderFromInput(cookieInput) {
  if (Array.isArray(cookieInput)) {
    const pairs = cookieInput
      .map((c) =>
        c?.name && c?.value !== undefined && c?.value !== null
          ? `${c.name}=${c.value}`
          : null
      )
      .filter(Boolean);
    if (!pairs.length) throw new Error("cookies array is empty or invalid.");
    return pairs.join("; ");
  }

  const raw = stripQuotes(cookieInput);
  if (!raw) throw new Error("cookie is required.");
  const pairs = raw
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.includes("="));
  if (!pairs.length) throw new Error("cookie must contain name=value pairs.");
  return pairs.join("; ");
}

function parseScreenId(html) {
  const source = String(html || "");
  for (const re of SCREEN_ID_RE_LIST) {
    const match = source.match(re);
    if (match?.[1]) return String(match[1]).trim();
  }
  return "";
}

function defaultScreenId() {
  return stripQuotes(
    process.env.DGFT_EBRC_LOADPAGE_SCREEN_ID ||
      process.env.DGFT_BILL_SCREEN_ID ||
      process.env.DGFT_PORT_SCREEN_ID ||
      ""
  );
}

function parseCsrfFromHtml(html) {
  const source = String(html || "");
  let csrfToken = "";
  for (const re of CSRF_TOKEN_RES) {
    const match = source.match(re);
    if (match?.[1]) {
      csrfToken = String(match[1]).trim();
      break;
    }
  }

  let csrfHeaderName = "X-CSRF-TOKEN";
  for (const re of CSRF_HEADER_RES) {
    const match = source.match(re);
    if (match?.[1]) {
      csrfHeaderName = String(match[1]).trim();
      break;
    }
  }

  return {
    csrfToken,
    csrfHeaderName: csrfHeaderName || "X-CSRF-TOKEN",
    screenId: parseScreenId(source),
  };
}

async function fetchHtmlForCsrf(cookieHeader, source) {
  const response = await fetch(source.url, {
    method: "GET",
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Cache-Control": "max-age=0",
      Cookie: cookieHeader,
      Referer: source.referer,
      "Upgrade-Insecure-Requests": "1",
      "User-Agent": DEFAULT_USER_AGENT,
    },
  });

  const html = await response.text();
  if (!response.ok) {
    throw new Error(
      `fetchCsrfAndScreenId failed with HTTP ${response.status} (${source.label}): ${html.slice(0, 300)}`
    );
  }

  return { html, source: source.label };
}

/**
 * GET DGFT portal pages and parse csrf + screenId.
 * Tries /CP/index.jsp first, then /CP/ and checkLogin when token is missing.
 *
 * @param {object} params
 * @param {string|object[]} params.cookie - Raw cookie header or cookie array.
 * @returns {Promise<{ csrfToken: string, csrfHeaderName: string, screenId: string, html: string, source: string }>}
 */
async function fetchCsrfAndScreenId(params = {}) {
  const cookieHeader = cookieHeaderFromInput(params.cookie);
  const sources = Array.isArray(params.sources) && params.sources.length
    ? params.sources
    : CSRF_FETCH_SOURCES;

  let lastHtml = "";
  let lastSource = "";
  let lastError = null;

  for (const source of sources) {
    try {
      const fetched = await fetchHtmlForCsrf(cookieHeader, source);
      lastHtml = fetched.html;
      lastSource = fetched.source;
      const parsed = parseCsrfFromHtml(fetched.html);
      if (parsed.csrfToken) {
        const screenId = parsed.screenId || defaultScreenId();
        return {
          csrfToken: parsed.csrfToken,
          csrfHeaderName: parsed.csrfHeaderName,
          screenId,
          html: fetched.html,
          source: fetched.source,
        };
      }
    } catch (error) {
      lastError = error;
      if (/failed with HTTP (403|401)/i.test(String(error?.message || ""))) {
        throw error;
      }
    }
  }

  if (lastError && !lastHtml) {
    throw lastError;
  }

  throw new Error(
    "Could not find _csrf token in DGFT portal response (tried index.jsp, /CP/, and checkLogin)."
  );
}

module.exports = {
  fetchCsrfAndScreenId,
  cookieHeaderFromInput,
  parseCsrfFromHtml,
};
