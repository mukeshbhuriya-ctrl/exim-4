const INDEX_URL = "https://www.dgft.gov.in/CP/index.jsp";
const REFERER_URL =
  "https://www.dgft.gov.in/CP/web?requestType=ApplicationRH&actionVal=checkLogin";

const CSRF_TOKEN_RE =
  /<meta[^>]+name=["']_csrf["'][^>]+content=["']([^"']+)["']/i;
const CSRF_HEADER_RE =
  /<meta[^>]+name=["']_csrf_header["'][^>]+content=["']([^"']+)["']/i;
const SCREEN_ID_RE_LIST = [
  /screenId=(\d+)/i,
  /["']screenId["']\s*[:=]\s*["']?(\d+)["']?/i,
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

/**
 * GET /CP/index.jsp and parse csrf + screenId.
 *
 * @param {object} params
 * @param {string|object[]} params.cookie - Raw cookie header or cookie array.
 * @returns {Promise<{ csrfToken: string, csrfHeaderName: string, screenId: string, html: string }>}
 */
async function fetchCsrfAndScreenId(params = {}) {
  const cookieHeader = cookieHeaderFromInput(params.cookie);

  const response = await fetch(INDEX_URL, {
    method: "GET",
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Cache-Control": "max-age=0",
      Cookie: cookieHeader,
      Referer: REFERER_URL,
      "Upgrade-Insecure-Requests": "1",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    },
  });

  const html = await response.text();
  if (!response.ok) {
    throw new Error(
      `fetchCsrfAndScreenId failed with HTTP ${response.status}: ${html.slice(0, 300)}`
    );
  }

  const csrfTokenMatch = html.match(CSRF_TOKEN_RE);
  if (!csrfTokenMatch?.[1]) {
    throw new Error("Could not find _csrf token in /CP/index.jsp response.");
  }
  const csrfHeaderMatch = html.match(CSRF_HEADER_RE);
  const screenId = parseScreenId(html);
  if (!screenId) {
    throw new Error("Could not find screenId in /CP/index.jsp response.");
  }

  return {
    csrfToken: String(csrfTokenMatch[1]).trim(),
    csrfHeaderName: csrfHeaderMatch?.[1]
      ? String(csrfHeaderMatch[1]).trim()
      : "X-CSRF-TOKEN",
    screenId,
    html,
  };
}

module.exports = {
  fetchCsrfAndScreenId,
  cookieHeaderFromInput,
};
