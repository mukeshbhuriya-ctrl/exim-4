/**
 * DGFT billRepository → IEC (`fetchIecNo`). CLI loads backend/.env and supports
 * `node web_scraping/djft/dricat/iecno.js -c "Cookie..." -s "<csrf>" [-S screenId] [--json]`.
 */
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "..", "..", "..", ".env"),
  quiet: true,
});

const HOME_URL = "https://www.dgft.gov.in/CP/";
const BASE_URL = "https://www.dgft.gov.in/CP/web";
const BILL_REPOSITORY_REFERER =
  "https://www.dgft.gov.in/CP/web?requestType=ApplicationRH&actionVal=checkLogin";
const DEFAULT_BILL_REPOSITORY_SCREEN_ID = "90000542";

function resolveBillRepositoryScreenId(raw) {
  if (raw == null) return DEFAULT_BILL_REPOSITORY_SCREEN_ID;
  const s = String(raw)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!s) return DEFAULT_BILL_REPOSITORY_SCREEN_ID;
  if (!/^\d+$/.test(s)) {
    throw new Error(`screenId must be numeric, got: ${JSON.stringify(s)}`);
  }
  return s;
}

const CSRF_TOKEN_RE =
  /<meta[^>]+(?:name|property)=["']_csrf["'][^>]+content=["']([^"']+)["']/i;
const CSRF_HEADER_RE =
  /<meta[^>]+(?:name|property)=["']_csrf_header["'][^>]+content=["']([^"']+)["']/i;

/** Order-agnostic: DGFT may emit value= before id= on the iecNo input. */
function parseIecNoFromBillRepositoryHtml(html) {
  const body = String(html || "");
  const idFirst =
    /<input\b[^>]*\bid=["']iecNo["'][^>]*\bvalue=["']([^"']*)["'][^>]*>/i;
  const valueFirst =
    /<input\b[^>]*\bvalue=["']([^"']*)["'][^>]*\bid=["']iecNo["'][^>]*>/i;
  let m = body.match(idFirst);
  if (m?.[1] !== undefined) return String(m[1]).trim();
  m = body.match(valueFirst);
  if (m?.[1] !== undefined) return String(m[1]).trim();
  return null;
}

function domainMatches(hostname, cookieDomain, hostOnly) {
  if (!cookieDomain) return false;
  const normalized = String(cookieDomain).replace(/^\./, "").toLowerCase();
  const host = String(hostname || "").toLowerCase();
  if (hostOnly) return host === normalized;
  return host === normalized || host.endsWith(`.${normalized}`);
}

function pathMatches(requestPath, cookiePath) {
  if (!cookiePath) return true;
  return String(requestPath || "/").startsWith(String(cookiePath));
}

function buildCookieHeader(cookies, targetUrl) {
  const target = new URL(targetUrl);
  const pairs = [];
  for (const cookie of cookies || []) {
    if (
      !domainMatches(
        target.hostname,
        cookie?.domain || "",
        Boolean(cookie?.hostOnly)
      )
    ) {
      continue;
    }
    if (!pathMatches(target.pathname || "/", cookie?.path || "/")) continue;
    if (cookie?.secure && target.protocol !== "https:") continue;
    if (cookie?.name && cookie?.value !== undefined && cookie?.value !== null) {
      pairs.push(`${cookie.name}=${cookie.value}`);
    }
  }
  if (!pairs.length) {
    throw new Error(`No matching cookies found for ${targetUrl}`);
  }
  return pairs.join("; ");
}

function upsertCookie(cookies, newCookie) {
  const idx = cookies.findIndex(
    (cookie) =>
      cookie?.name === newCookie?.name &&
      cookie?.domain === newCookie?.domain &&
      (cookie?.path || "/") === (newCookie?.path || "/")
  );
  if (idx >= 0) cookies[idx] = newCookie;
  else cookies.push(newCookie);
}

function parseSetCookieHeader(setCookieValue, requestUrl) {
  const target = new URL(requestUrl);
  const chunks = String(setCookieValue || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!chunks.length || !chunks[0].includes("=")) return null;

  const [name, ...valueParts] = chunks[0].split("=");
  if (!name) return null;

  const attrs = {};
  for (const attr of chunks.slice(1)) {
    const [key, ...rest] = attr.split("=");
    attrs[String(key || "").toLowerCase()] = rest.join("=");
  }

  const rawDomain = attrs.domain || "";
  const normalizedDomain = rawDomain.replace(/^\./, "") || target.hostname;
  return {
    domain: normalizedDomain,
    hostOnly: !rawDomain,
    httpOnly: Object.prototype.hasOwnProperty.call(attrs, "httponly"),
    name,
    path: attrs.path || "/",
    secure: Object.prototype.hasOwnProperty.call(attrs, "secure"),
    value: valueParts.join("="),
  };
}

function mergeSetCookieHeaders(cookies, responseHeaders, requestUrl) {
  const merged = (cookies || []).map((c) => ({ ...c }));
  const setCookies =
    typeof responseHeaders.getSetCookie === "function"
      ? responseHeaders.getSetCookie()
      : [];

  for (const setCookie of setCookies) {
    const parsed = parseSetCookieHeader(setCookie, requestUrl);
    if (parsed) upsertCookie(merged, parsed);
  }
  return merged;
}

function extractCsrfDetails(html) {
  const tokenMatch = String(html || "").match(CSRF_TOKEN_RE);
  if (!tokenMatch) {
    throw new Error("Could not find `_csrf` token in GET /CP/ response");
  }
  const headerMatch = String(html || "").match(CSRF_HEADER_RE);
  return {
    csrfToken: tokenMatch[1],
    csrfHeaderName: headerMatch ? headerMatch[1] : "X-CSRF-TOKEN",
  };
}

async function refreshCsrf(cookies) {
  const response = await fetch(HOME_URL, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Cache-Control": "max-age=0",
      Cookie: buildCookieHeader(cookies, HOME_URL),
      Referer: "https://www.dgft.gov.in/CP/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    },
  });

  const body = await response.text();
  const mergedCookies = mergeSetCookieHeaders(cookies, response.headers, HOME_URL);
  const { csrfToken, csrfHeaderName } = extractCsrfDetails(body);
  return { cookies: mergedCookies, csrfToken, csrfHeaderName };
}

async function fetchIecNo(options = {}) {
  const cookiesInput = options.cookies;
  const billRepositoryReferer =
    typeof options.billRepositoryReferer === "string" && options.billRepositoryReferer
      ? options.billRepositoryReferer
      : "https://www.dgft.gov.in/CP/";
  if (!Array.isArray(cookiesInput)) {
    throw new Error("cookies array is required. Pass fetchIecNo({ cookies: [...] })");
  }
  const screenId = resolveBillRepositoryScreenId(
    options.screenId ?? options.billRepositoryScreenId
  );
  const explicitCsrfRaw = options.csrfToken ?? options._csrf;
  const explicitCsrf =
    typeof explicitCsrfRaw === "string" && String(explicitCsrfRaw).trim()
      ? String(explicitCsrfRaw).trim()
      : null;
  const csrfHeaderNameOverride =
    typeof options.csrfHeaderName === "string" && options.csrfHeaderName.trim()
      ? options.csrfHeaderName.trim()
      : null;

  let csrf;
  if (explicitCsrf) {
    csrf = {
      cookies: cookiesInput.map((c) => ({ ...c })),
      csrfToken: explicitCsrf,
      csrfHeaderName: csrfHeaderNameOverride || "X-CSRF-TOKEN",
    };
  } else {
    csrf = await refreshCsrf(cookiesInput);
  }
  const cookieHeader = buildCookieHeader(csrf.cookies, BASE_URL);

  const params = new URLSearchParams({
    requestType: "ApplicationRH",
    actionVal: "billRepository",
    screenId,
    menuCode: "90000570",
    auditUSFlag: "true",
    _csrf: String(csrf.csrfToken || ""),
  });
  const endpoint = `${BASE_URL}?${params.toString()}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "text/html, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: cookieHeader,
      Origin: "https://www.dgft.gov.in",
      Referer: billRepositoryReferer,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      [csrf.csrfHeaderName]: csrf.csrfToken,
    },
    body: "portal=CAS",
  });

  const body = await response.text();
  if (!response.ok) {
    console.error("[dricat][iecno] billRepository non-OK snippet", body.slice(0, 1200));
    throw new Error(`billRepository failed with HTTP ${response.status}`);
  }

  const iecNo = parseIecNoFromBillRepositoryHtml(body);
  if (!iecNo) {
    console.error("[dricat][iecno] iecNo parse failed snippet", body.slice(0, 2500));
    throw new Error("Could not find iecNo in billRepository response.");
  }

  return {
    iecNo,
    cookies: csrf.cookies,
  };
}

function stripQuotes(s) {
  return String(s || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function cookiesFromRawHeader(raw) {
  const out = [];
  for (const part of String(raw || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
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

function parseCliArgs(argv) {
  const out = {
    cookie: null,
    csrf: null,
    screenId: null,
    json: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--cookie" || a === "-c") {
      out.cookie = args[++i];
    } else if (a === "--csrf" || a === "-s") {
      out.csrf = args[++i];
    } else if (a === "--screen-id" || a === "-S") {
      out.screenId = args[++i];
    } else if (a === "--json" || a === "-j") {
      out.json = true;
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

function loadCookiesFromEnv() {
  if (process.env.DGFT_COOKIES_JSON) {
    return JSON.parse(process.env.DGFT_COOKIES_JSON);
  }
  const rawCookie = process.env.DGFT_COOKIE;
  if (rawCookie) {
    return cookiesFromRawHeader(stripQuotes(rawCookie));
  }
  return null;
}

/**
 * @param {string} cookieHeader - Raw Cookie header (name=value; ...)
 * @param {string} [csrfToken] - If omitted, GET /CP/ refresh is used.
 * @param {string} [screenId] - billRepository screenId (default 90000542).
 */
async function getIecNo(cookieHeader, csrfToken, screenId) {
  const cookies = cookiesFromRawHeader(stripQuotes(cookieHeader));
  if (!cookies.length) {
    throw new Error("cookieHeader must contain at least one name=value pair.");
  }
  const token =
    csrfToken != null && String(csrfToken).trim() !== ""
      ? stripQuotes(csrfToken)
      : "";
  const sid =
    screenId != null && String(screenId).trim() !== ""
      ? stripQuotes(screenId)
      : "";
  return fetchIecNo({
    cookies,
    billRepositoryReferer: BILL_REPOSITORY_REFERER,
    ...(token ? { csrfToken: token } : {}),
    ...(sid ? { screenId: sid } : {}),
  });
}

async function main() {
  const cli = parseCliArgs(process.argv);
  if (cli.help) {
    process.stdout.write(
      "Usage: node iecno.js --cookie \"JSESSIONID=...; AWSALB=...\" --csrf \"<_csrf>\" [--screen-id 90000542] [--json]\n" +
        "Short: -c / -s / -S / -j. Omit --csrf to refresh via GET /CP/.\n" +
        "Env: DGFT_COOKIE, DGFT_COOKIES_JSON, DGFT_CSRF, DGFT_BILL_SCREEN_ID (backend/.env).\n" +
        "Default output: IEC only. --json prints { iecNo, cookies }.\n"
    );
    return;
  }

  let screenId = "";
  if (cli.screenId != null && String(cli.screenId).trim() !== "") {
    screenId = stripQuotes(cli.screenId);
  } else if (process.env.DGFT_BILL_SCREEN_ID) {
    screenId = stripQuotes(process.env.DGFT_BILL_SCREEN_ID);
  }

  let cookies;
  if (cli.cookie != null && String(cli.cookie).trim() !== "") {
    cookies = cookiesFromRawHeader(stripQuotes(cli.cookie));
  } else {
    cookies = loadCookiesFromEnv();
  }

  let csrf = "";
  if (cli.csrf != null && String(cli.csrf).trim() !== "") {
    csrf = stripQuotes(cli.csrf);
  } else {
    csrf = process.env.DGFT_CSRF ? stripQuotes(process.env.DGFT_CSRF) : "";
  }

  if (!Array.isArray(cookies) || !cookies.length) {
    throw new Error(
      "Pass --cookie \"...\" or set DGFT_COOKIE / DGFT_COOKIES_JSON in backend/.env."
    );
  }

  const result = await fetchIecNo({
    cookies,
    billRepositoryReferer: BILL_REPOSITORY_REFERER,
    ...(csrf ? { csrfToken: csrf } : {}),
    ...(screenId ? { screenId } : {}),
  });

  if (cli.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.iecNo}\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  fetchIecNo,
  getIecNo,
  main,
  parseIecNoFromBillRepositoryHtml,
  DEFAULT_BILL_REPOSITORY_SCREEN_ID,
  resolveBillRepositoryScreenId,
  BILL_REPOSITORY_REFERER,
};
