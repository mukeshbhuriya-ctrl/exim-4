const BASE_URL = "https://www.dgft.gov.in/CP/web";
const DEFAULT_REFERER =
  "https://www.dgft.gov.in/CP/web?requestType=ApplicationRH&actionVal=checkLogin";

const COLUMNS = [
  "brcNumber",
  "uploadDate",
  "realisationDate",
  "realizedAmountCC",
  "invoiceNumber",
  "sbNumber",
  "sbDate",
  "exportPortCode.value",
  "brcStatus.value",
  "utilizationStatus",
  "source",
  "bankFlag",
  "",
  "",
  "",
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

function normalizeExportPortCode(portPreview) {
  const first = Array.isArray(portPreview) ? portPreview[0] : portPreview;
  const key = first?.key != null ? String(first.key).trim() : "";
  const value = first?.value != null ? String(first.value).trim() : "";
  if (!key || !value) {
    throw new Error(
      "portPreview must contain key and value (e.g. [{ key: 683, value: 'INHZA1-...' }])."
    );
  }
  return { key, value };
}

function buildFormData({
  iecNo,
  sbNumber,
  sbDate,
  exportPortCode,
  fromDateOfSelectedBil = "",
  toDateOfSelectedBil = "",
}) {
  const filters = {
    brcNo: "",
    iecNo: String(iecNo || ""),
    fromDateOfSelectedBil: String(fromDateOfSelectedBil || ""),
    toDateOfSelectedBil: String(toDateOfSelectedBil || ""),
    sbNumber: String(sbNumber || ""),
    sbDate: String(sbDate || ""),
    exportPortCode: {
      key: String(exportPortCode?.key || ""),
      value: String(exportPortCode?.value || ""),
    },
    exportPortCode_key: String(exportPortCode?.key || ""),
    exportPortCode_value: String(exportPortCode?.value || ""),
    invoiceNumber: "",
    licenseNumber: "",
  };

  const payload = {
    draw: "1",
    "order[0][column]": "0",
    "order[0][dir]": "asc",
    start: "0",
    length: "10",
    "search[value]": "",
    "search[regex]": "false",
    "dataJson[formData]": JSON.stringify(filters),
  };

  COLUMNS.forEach((columnName, index) => {
    payload[`columns[${index}][data]`] = columnName;
    payload[`columns[${index}][name]`] = "";
    payload[`columns[${index}][searchable]`] = "true";
    payload[`columns[${index}][orderable]`] = "true";
    payload[`columns[${index}][search][value]`] = "";
    payload[`columns[${index}][search][regex]`] = "false";
  });

  return payload;
}

/**
 * Calls DGFT loadBankRealisationData endpoint and returns API response.
 *
 * @param {object} params
 * @param {string|object[]} params.cookie
 * @param {string} params.csrf
 * @param {string} params.screenId
 * @param {string} params.sbNumber
 * @param {string} params.sbDate
 * @param {string} params.iecNo
 * @param {Array|object} params.portPreview - should contain key + value
 * @param {string} [params.fromDateOfSelectedBil]
 * @param {string} [params.toDateOfSelectedBil]
 * @returns {Promise<{status:number, contentType:string, body:any}>}
 */
async function fetchBrcNo(params = {}) {
  const csrf = stripQuotes(params.csrf);
  const screenId = stripQuotes(params.screenId);
  const sbNumber = stripQuotes(params.sbNumber);
  const sbDate = stripQuotes(params.sbDate);
  const iecNo = stripQuotes(params.iecNo);
  const fromDateOfSelectedBil = stripQuotes(params.fromDateOfSelectedBil);
  const toDateOfSelectedBil = stripQuotes(params.toDateOfSelectedBil);
  const cookieHeader = cookieHeaderFromInput(params.cookie);
  const exportPortCode = normalizeExportPortCode(params.portPreview);

  if (!csrf) throw new Error("csrf is required.");
  if (!screenId) throw new Error("screenId is required.");
  if (!/^\d+$/.test(screenId)) throw new Error("screenId must be numeric.");
  if (!sbNumber) throw new Error("sbNumber is required.");
  if (!sbDate) throw new Error("sbDate is required.");
  if (!iecNo) throw new Error("iecNo is required.");

  const endpoint =
    `${BASE_URL}?requestType=ApplicationRH&actionVal=loadBankRealisationData` +
    `&screenId=${encodeURIComponent(screenId)}` +
    `&_csrf=${encodeURIComponent(csrf)}`;

  const formData = new URLSearchParams(
    buildFormData({
      iecNo,
      sbNumber,
      sbDate,
      exportPortCode,
      fromDateOfSelectedBil,
      toDateOfSelectedBil,
    })
  );

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
    body: formData.toString(),
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep as text when non-JSON response is returned
  }

  return {
    status: response.status,
    contentType,
    body,
  };
}

module.exports = {
  fetchBrcNo,
};
