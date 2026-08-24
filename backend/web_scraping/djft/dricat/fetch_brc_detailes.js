const { extractBrcDetailsFromBody } = require("./brc_detailes_extract_from_body");

const BASE_URL = "https://www.dgft.gov.in/CP/web";
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

/**
 * Calls getBankRealisationData for a single brcNumber.
 *
 * @param {object} params
 * @param {string|object[]} params.cookie
 * @param {string} params.csrf
 * @param {string} params.screenId
 * @param {string} params.brcNumber
 * @returns {Promise<{ brcNumber: string, status: number, contentType: string, body: any, data: object }>}
 */
async function fetchBrcDetails(params = {}) {
  const csrf = stripQuotes(params.csrf);
  const screenId = stripQuotes(params.screenId);
  const brcNumber = stripQuotes(params.brcNumber);
  const cookieHeader = cookieHeaderFromInput(params.cookie);

  if (!csrf) throw new Error("csrf is required.");
  if (!screenId) throw new Error("screenId is required.");
  if (!/^\d+$/.test(screenId)) throw new Error("screenId must be numeric.");
  if (!brcNumber) throw new Error("brcNumber is required.");

  const endpoint =
    `${BASE_URL}?requestType=ApplicationRH&actionVal=getBankRealisationData` +
    `&screenId=${encodeURIComponent(screenId)}` +
    `&_csrf=${encodeURIComponent(csrf)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
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
    body: `brcNumber=${encodeURIComponent(brcNumber)}&isBackSearchEnabled=true`,
  });

  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep string if non-JSON response
  }

  const data = extractBrcDetailsFromBody(body, { brcNumber });

  return {
    brcNumber,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    body,
    data,
  };
}

module.exports = {
  fetchBrcDetails,
};
