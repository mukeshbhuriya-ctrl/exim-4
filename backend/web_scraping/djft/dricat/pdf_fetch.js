const BASE_URL = "https://www.dgft.gov.in/CP/webHP";
const DEFAULT_REFERER =
  "https://www.dgft.gov.in/CP/web?requestType=ApplicationRH&actionVal=checkLogin";

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

function normalizeSummaryJson(summaryjson) {
  if (summaryjson == null) {
    throw new Error("summaryjson is required.");
  }
  if (typeof summaryjson === "string") {
    const trimmed = summaryjson.trim();
    if (!trimmed) throw new Error("summaryjson is required.");
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      throw new Error("summaryjson must be valid JSON string or object.");
    }
  }
  return JSON.stringify(summaryjson);
}

function sanitizeFileName(value) {
  return String(value || "file")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function extractPdfBytesFromScript(body) {
  const match = String(body || "").match(/Uint8Array\s*\(\s*\[([\s\S]*?)\]\s*\)/i);
  if (!match?.[1]) return null;

  const numbers = match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((num) => Number.isFinite(num))
    .map((num) => (num < 0 ? num + 256 : num));

  if (!numbers.length) return null;
  return Buffer.from(numbers);
}

function resolvePdfFileName(params = {}) {
  const baseName = sanitizeFileName(
    params.fileName || params.brcNumber || params.invoiceNumber || "Summary"
  );
  return `${baseName}.pdf`;
}

/**
 * Calls DGFT print/listener endpoint with summaryjson and returns response.
 *
 * @param {object} params
 * @param {string|object[]} params.cookie
 * @param {string} params.csrf
 * @param {string|object} params.summaryjson
 * @param {string} [params.screenId]
 * @param {string} [params.moduleName]
 * @param {string} [params.mpgId]
 * @param {string} [params.arn]
 * @param {string} [params.fileName]
 * @param {string} [params.brcNumber]
 * @param {string} [params.invoiceNumber]
 * @returns {Promise<{status:number, contentType:string, body:string, endpoint:string, saved:boolean, fileName:string|null, pdfBuffer:Buffer|null, byteLength:number}>}
 */
async function fetchPdf(params = {}) {
  const csrf = stripQuotes(params.csrf);
  const cookieHeader = cookieHeaderFromInput(params.cookie);
  const summaryjson = normalizeSummaryJson(params.summaryjson);
  const screenId = stripQuotes(params.screenId || "9000012349");
  const moduleName = stripQuotes(params.moduleName || "214000000");
  const mpgId = stripQuotes(params.mpgId || "50000007");
  const arn =
    params.arn == null || String(params.arn) === "" ? "undefined" : String(params.arn);

  if (!csrf) throw new Error("csrf is required.");
  if (!/^\d+$/.test(screenId)) throw new Error("screenId must be numeric.");

  const endpoint =
    `${BASE_URL}?requestType=ApplicationRH&actionVal=listner&print=true` +
    `&moduleName=${encodeURIComponent(moduleName)}` +
    `&screenId=${encodeURIComponent(screenId)}` +
    `&dataSubmission=` +
    `&mpgId=${encodeURIComponent(mpgId)}` +
    `&arn=${encodeURIComponent(arn)}` +
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
    body: `summaryjson=${encodeURIComponent(summaryjson)}`,
  });

  const body = await response.text();
  const pdfBytes = extractPdfBytesFromScript(body);
  const fileName = pdfBytes ? resolvePdfFileName(params) : null;

  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    body,
    endpoint,
    saved: Boolean(pdfBytes),
    fileName,
    pdfBuffer: pdfBytes || null,
    byteLength: pdfBytes ? pdfBytes.length : 0,
  };
}

module.exports = {
  fetchPdf,
};
