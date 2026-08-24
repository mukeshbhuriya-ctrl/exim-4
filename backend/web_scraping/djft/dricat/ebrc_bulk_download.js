const { cookieHeaderFromInput } = require("./csrfandscreenid");
const { resolveDgftSessionForApi, clearDgftSession } = require("./dgft_session");
const { saveDgftSession } = require("#utils/dgftCredentials");

const BASE_URL = "https://www.dgft.gov.in/CP/web";
const UPLOAD_BASE_URL = "https://www.dgft.gov.in/CP/Upload";
const INDEX_REFERER = "https://www.dgft.gov.in/CP/index.jsp";
const DEFAULT_LOADPAGE_SCREEN_ID = "30500000119";
const DEFAULT_MENU_CODE = "9000012925";
const EBRC_LOADPAGE_REFERER =
  `${BASE_URL}?requestType=ApplicationRH&actionVal=loadpage&screenId=${DEFAULT_LOADPAGE_SCREEN_ID}&menuCode=${DEFAULT_MENU_CODE}`;
const ATTACHMENT_NAME_HIDDEN = "attach_2";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

function stripQuotes(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function stripHtmlText(fragment) {
  return String(fragment || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse `#bulkDownloadTable` rows from DGFT eBRC bulk download loadpage HTML.
 *
 * @param {string} html
 * @returns {object[]}
 */
function parseEBrcBulkDownloadTable(html) {
  const source = String(html || "");
  const tableMatch = source.match(
    /<table[^>]*\bid=["']bulkDownloadTable["'][\s\S]*?<\/table>/i
  );
  if (!tableMatch?.[0]) return [];

  const tbodyMatch = tableMatch[0].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch?.[1]) return [];

  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tbodyMatch[1])) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;

    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(tdMatch[1]);
    }

    if (cells.length < 7) continue;

    const statusHtml = cells[4];
    const attachIdMatch = statusHtml.match(/data-attachId=["']([^"']+)["']/i);

    rows.push({
      srNo: stripHtmlText(cells[0]),
      requestType: stripHtmlText(cells[1]),
      fromDate: stripHtmlText(cells[2]),
      toDate: stripHtmlText(cells[3]),
      status: stripHtmlText(statusHtml),
      attachId: attachIdMatch?.[1] ? String(attachIdMatch[1]).trim() : null,
      requestDateTime: stripHtmlText(cells[5]),
      submittedBy: stripHtmlText(cells[6]),
    });
  }

  return rows;
}

async function resolveSessionForRequest(options = {}) {
  return resolveDgftSessionForApi({
    companyId: options.companyId,
    username: options.username,
    password: options.password,
    maxLoginRetries: options.maxLoginRetries,
    seleniumGridUrl: options.seleniumGridUrl,
    forceRefresh: options.forceRefresh === true,
  });
}

function isRetryableDgftHttpError(error) {
  return /failed with HTTP (403|404)/i.test(String(error?.message || ""));
}

async function withDgftSessionRetry(run, options = {}) {
  const attempts = options.forceRefresh === true
    ? [{ ...options, forceRefresh: true }]
    : [
        { ...options, forceRefresh: false },
        { ...options, forceRefresh: true },
      ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await run(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableDgftHttpError(error)) throw error;
      if (attempt.companyId) {
        await clearDgftSession(attempt.companyId);
      }
    }
  }

  throw lastError || new Error("DGFT request failed.");
}

function resolveLoadpageScreenId(options = {}) {
  return stripQuotes(
    options.screenId ||
      process.env.DGFT_EBRC_LOADPAGE_SCREEN_ID ||
      DEFAULT_LOADPAGE_SCREEN_ID
  );
}

function parseContentDispositionFilename(headerValue) {
  const header = String(headerValue || "");
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(header);
  return plainMatch?.[1] ? plainMatch[1].trim() : "";
}

function sanitizeFileName(value, fallback = "ebrc-attachment.xls") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?\x00-\x1F]/g, "_")
    .trim();
  return cleaned || fallback;
}

function buildContentDispositionHeader(fileName) {
  const safeName = ensureXlsFileName(fileName).replace(/"/g, "");
  return `attachment; filename="${safeName}"`;
}

/**
 * DGFT portal appends mpgId directly in the query string and keeps `/` unencoded.
 */
function encodeMpgIdForDgftUpload(mpgId) {
  return String(mpgId || "").replace(/ /g, "%20");
}

function buildDgftUploadDownloadUrl(mpgId, csrfToken) {
  const mpgIdParam = encodeMpgIdForDgftUpload(mpgId);
  const csrfParam = encodeURIComponent(csrfToken);
  return (
    `${UPLOAD_BASE_URL}?flag=viewTempAttach` +
    `&attachmentNameHidden=${ATTACHMENT_NAME_HIDDEN}` +
    `&mpgId=${mpgIdParam}` +
    `&print=true&_csrf=${csrfParam}`
  );
}

function extractBytesFromHtmlBody(body) {
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

function detectDgftAttachmentMeta(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return { kind: "unknown" };
  }

  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return {
      kind: "zip",
      contentType: "application/zip",
      extension: ".zip",
    };
  }

  if (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  ) {
    return {
      kind: "xls",
      contentType: "application/vnd.ms-excel",
      extension: ".xls",
    };
  }

  const preview = buffer.toString("utf8", 0, Math.min(buffer.length, 32)).trimStart();
  if (preview.startsWith("<") || preview.startsWith("<!")) {
    return { kind: "html" };
  }

  return { kind: "unknown" };
}

const DEFAULT_EBRC_XLS_NAME = "EBRC BULK DOWNLOAD.xls";

function cleanDgftDownloadFileName(fileName) {
  const cleaned = String(fileName || "")
    .replace(/[<>:"/\\|?\x00-\x1F]/g, "")
    .trim();
  return cleaned || DEFAULT_EBRC_XLS_NAME;
}

function ensureXlsFileName(fileName) {
  const cleaned = cleanDgftDownloadFileName(fileName);
  if (/\.xls$/i.test(cleaned)) return cleaned;
  return `${cleaned.replace(/\.[^.]+$/i, "")}.xls`;
}

function buildMpgIdCandidates({ mpgId = "", filePath = "", fileName = "" } = {}) {
  const candidates = [];
  const full = String(mpgId || "").trim();
  const path = String(filePath || "").trim();
  const name = String(fileName || "").trim();

  if (full) candidates.push(full);
  if (path && path !== full) candidates.push(path);
  if (path && name) candidates.push(`${path}* *${name}`);

  return [...new Set(candidates.filter(Boolean))];
}

function isValidXlsBuffer(buffer) {
  return detectDgftAttachmentMeta(buffer).kind === "xls";
}

function normalizeDgftAttachmentDownload(buffer, preferredFileName, attachId = "") {
  let workingBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!workingBuffer.length) {
    throw new Error("DGFT returned an empty attachment file.");
  }

  let detected = detectDgftAttachmentMeta(workingBuffer);
  if (detected.kind === "html") {
    const extracted = extractBytesFromHtmlBody(workingBuffer.toString("utf8"));
    if (!extracted?.length) {
      throw new Error("DGFT attachment download returned HTML instead of an Excel file.");
    }
    workingBuffer = extracted;
    detected = detectDgftAttachmentMeta(workingBuffer);
  }

  const preferred = ensureXlsFileName(preferredFileName);

  if (detected.kind === "xls") {
    return {
      buffer: workingBuffer,
      contentType: "application/vnd.ms-excel",
      fileName: preferred,
    };
  }

  if (detected.kind === "zip") {
    const err = new Error("DGFT returned ZIP instead of .xls");
    err.code = "DGFT_ZIP_RESPONSE";
    throw err;
  }

  const err = new Error("DGFT returned an unexpected file format (not .xls)");
  err.code = "DGFT_INVALID_FILE";
  throw err;
}

function bufferFromByteArray(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const bytes = value
    .map((part) => Number(part))
    .filter((num) => Number.isFinite(num))
    .map((num) => (num < 0 ? num + 256 : num));
  if (!bytes.length) return null;
  return Buffer.from(bytes);
}

function bufferFromAttachmentJson(payload, attachId) {
  if (!payload || typeof payload !== "object") return null;

  const candidates = [
    payload.fileContent,
    payload.fileData,
    payload.attachment,
    payload.attachByteArray,
    payload.byteArray,
    payload.data,
    payload.body,
    payload?.data?.fileContent,
    payload?.data?.fileData,
    payload?.data?.attachment,
    payload?.data?.attachByteArray,
    payload?.data?.byteArray,
  ];

  for (const candidate of candidates) {
    if (Buffer.isBuffer(candidate) && candidate.length) {
      return candidate;
    }
    if (candidate instanceof Uint8Array && candidate.length) {
      return Buffer.from(candidate);
    }
    if (Array.isArray(candidate)) {
      const fromArray = bufferFromByteArray(candidate);
      if (fromArray?.length) return fromArray;
    }
    if (typeof candidate === "string" && candidate.trim()) {
      try {
        const decoded = Buffer.from(candidate.trim(), "base64");
        if (decoded.length) return decoded;
      } catch {
        // ignore invalid base64
      }
    }
  }

  const uint8Match = JSON.stringify(payload).match(/Uint8Array\s*\(\s*\[([\s\S]*?)\]\s*\)/i);
  if (uint8Match?.[1]) {
    const numbers = uint8Match[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => Number(part))
      .filter((num) => Number.isFinite(num))
      .map((num) => (num < 0 ? num + 256 : num));
    if (numbers.length) return Buffer.from(numbers);
  }

  return null;
}

function resolveAttachmentFileName(payload, _attachId, contentDisposition = "", preferredName = "") {
  const fromPreferred = cleanDgftDownloadFileName(preferredName);
  if (fromPreferred !== DEFAULT_EBRC_XLS_NAME || preferredName) {
    return ensureXlsFileName(fromPreferred);
  }

  const fromHeader = parseContentDispositionFilename(contentDisposition);
  if (fromHeader) return ensureXlsFileName(fromHeader);

  if (payload && typeof payload === "object") {
    const fromJson = payload.fileName || payload.filename || payload?.data?.fileName;
    if (fromJson) return ensureXlsFileName(fromJson);
  }

  return DEFAULT_EBRC_XLS_NAME;
}

/**
 * getAttachmentDetails returns e.g.
 * 125/2026/06/09/16/1/ATCH8832017770339611205* *EBRC BULK DOWNLOAD.xls
 */
function parseAttachmentDetailsReference(text) {
  let raw = String(text ?? "").trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1).trim();
  }

  const splitMarker = "* *";
  const splitIdx = raw.indexOf(splitMarker);
  const fileName =
    splitIdx >= 0 ? raw.slice(splitIdx + splitMarker.length).trim() : "";

  return {
    mpgId: raw,
    filePath: splitIdx >= 0 ? raw.slice(0, splitIdx).trim() : raw,
    fileName: fileName || "ebrc-attachment.xls",
  };
}

function isAttachmentDetailsReference(text) {
  const raw = String(text ?? "").trim();
  return /ATCH/i.test(raw) || raw.includes("* *");
}

function resolveContentTypeFromFileName(fileName) {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

/**
 * Step 2: DGFT portal opens Upload?viewTempAttach with mpgId from getAttachmentDetails.
 */
async function fetchEBrcAttachmentFileOnce(options = {}) {
  const mpgId = stripQuotes(options.mpgId);
  const csrfToken = stripQuotes(options.csrfToken);
  const cookies = options.cookies;
  const preferredFileName = ensureXlsFileName(options.fileName);

  if (!mpgId) throw new Error("mpgId is required to download DGFT attachment.");
  if (!csrfToken) throw new Error("Could not resolve DGFT CSRF token.");
  if (!Array.isArray(cookies) || !cookies.length) {
    throw new Error("DGFT cookies are required.");
  }

  const downloadUrl = buildDgftUploadDownloadUrl(mpgId, csrfToken);
  const cookieHeader = cookieHeaderFromInput(cookies);
  const response = await fetch(downloadUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "application/vnd.ms-excel, application/octet-stream, */*",
      Cookie: cookieHeader,
      Referer: EBRC_LOADPAGE_REFERER,
      "User-Agent": USER_AGENT,
    },
  });

  const contentDisposition = response.headers.get("content-disposition") || "";
  const buffer = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    throw new Error(
      `DGFT attachment download failed with HTTP ${response.status}: ${buffer.toString("utf8").slice(0, 300)}`
    );
  }

  const resolvedFileName = resolveAttachmentFileName(
    null,
    "",
    contentDisposition,
    preferredFileName
  );

  return normalizeDgftAttachmentDownload(buffer, resolvedFileName);
}

async function fetchEBrcAttachmentFile(options = {}) {
  const candidates = buildMpgIdCandidates({
    mpgId: options.mpgId,
    filePath: options.filePath,
    fileName: options.fileName,
  });

  if (!candidates.length) {
    throw new Error("mpgId is required to download DGFT attachment.");
  }

  let lastError = null;
  for (const mpgId of candidates) {
    try {
      const result = await fetchEBrcAttachmentFileOnce({
        ...options,
        mpgId,
      });
      if (isValidXlsBuffer(result.buffer)) {
        return {
          ...result,
          fileName: ensureXlsFileName(options.fileName || result.fileName),
        };
      }
      lastError = new Error(
        `DGFT download did not return a valid .xls file for mpgId: ${mpgId}`
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("DGFT attachment download failed.");
}

function isBinaryContentType(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (!type) return false;
  if (type.includes("text/html")) return false;
  if (type.includes("application/json")) return false;
  if (type.includes("text/plain")) return false;
  return (
    type.includes("octet-stream") ||
    type.includes("zip") ||
    type.includes("pdf") ||
    type.includes("excel") ||
    type.includes("spreadsheet") ||
    type.includes("msword") ||
    type.includes("csv")
  );
}

async function dgftAuthenticatedPost(options = {}) {
  const session = await resolveSessionForRequest(options);
  const csrfToken = stripQuotes(session.csrfToken);
  const csrfHeaderName = stripQuotes(session.csrfHeaderName) || "X-CSRF-TOKEN";

  if (!csrfToken) {
    throw new Error("Could not resolve DGFT CSRF token.");
  }

  const screenId = resolveLoadpageScreenId(options);
  const params = new URLSearchParams({
    requestType: "ApplicationRH",
    actionVal: stripQuotes(options.actionVal),
    screenId,
    _csrf: csrfToken,
  });

  if (options.menuCode) {
    params.set("menuCode", stripQuotes(options.menuCode));
  }
  if (options.auditUSFlag) {
    params.set("auditUSFlag", "TRUE");
  }

  const referer =
    stripQuotes(options.actionVal) === "loadpage"
      ? INDEX_REFERER
      : EBRC_LOADPAGE_REFERER;

  const cookieHeader = cookieHeaderFromInput(session.cookies);
  const response = await fetch(`${BASE_URL}?${params.toString()}`, {
    method: "POST",
    headers: {
      Accept: options.accept || "text/html, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: cookieHeader,
      Origin: "https://www.dgft.gov.in",
      Referer: referer,
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
      [csrfHeaderName]: csrfToken,
    },
    body: options.body,
  });

  return {
    response,
    session,
    csrfToken,
    csrfHeaderName,
    screenId,
  };
}

/**
 * POST DGFT loadpage for eBRC bulk download requests table.
 */
async function fetchEBrcBulkDownloadHtmlOnce(options = {}) {
  const menuCode = stripQuotes(
    options.menuCode || process.env.DGFT_EBRC_MENU_CODE || DEFAULT_MENU_CODE
  );

  const { response, session, csrfToken, csrfHeaderName, screenId } =
    await dgftAuthenticatedPost({
      ...options,
      screenId: DEFAULT_LOADPAGE_SCREEN_ID,
      actionVal: "loadpage",
      menuCode,
      auditUSFlag: true,
      accept: "text/html, */*; q=0.01",
      body: stripQuotes(options.body) || "portal=CAS",
    });

  const html = await response.text();
  if (!response.ok) {
    throw new Error(
      `eBRC bulk download loadpage failed with HTTP ${response.status}: ${html.slice(0, 300)}`
    );
  }

  if (options.companyId) {
    await saveDgftSession(options.companyId, {
      cookies: session.cookies,
      csrfToken,
      csrfHeaderName,
      screenId,
    });
  }

  return {
    html,
    cookies: session.cookies,
    csrfToken,
    csrfHeaderName,
    screenId,
    menuCode,
    status: response.status,
    sessionFromCache: session.fromCache === true,
    sessionRefreshed: session.refreshed === true,
  };
}

async function fetchEBrcBulkDownloadHtml(options = {}) {
  return withDgftSessionRetry(
    (attempt) => fetchEBrcBulkDownloadHtmlOnce(attempt),
    options
  );
}

const DGFT_DATE_PATTERN = /^\d{2}\/\d{2}\/\d{4}$/;

function normalizeDgftDateInput(value, fieldName) {
  const raw = stripQuotes(value);
  if (!raw) {
    throw new Error(`${fieldName} is required (DD/MM/YYYY).`);
  }

  if (DGFT_DATE_PATTERN.test(raw)) {
    return raw;
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  throw new Error(`${fieldName} must be in DD/MM/YYYY format.`);
}

function parseDgftHtmlError(html) {
  const source = String(html || "");
  const errorMatch = source.match(
    /id=["']errorId["'][^>]*\bvalue=["']([^"']*)["']/i
  );
  const errorId = stripHtmlText(errorMatch?.[1] || "");
  if (errorId) return errorId;

  const warningMatch = source.match(
    /id=["']warningId["'][^>]*\bvalue=["']([^"']*)["']/i
  );
  const warningId = stripHtmlText(warningMatch?.[1] || "");
  if (warningId) return warningId;

  return "";
}

function buildEbrcBulkDownloadSubmitBody(options = {}) {
  const irmFromDate = normalizeDgftDateInput(
    options.irmFromDate,
    "irmFromDate"
  );
  const irmToDate = normalizeDgftDateInput(options.irmToDate, "irmToDate");
  const searchType = stripQuotes(options.searchType ?? "1");

  if (!/^[012]$/.test(searchType)) {
    throw new Error("searchType must be 0 (ORM), 1 (eBRC), or 2 (IRM).");
  }

  const params = new URLSearchParams();
  params.set("irmFromDate", irmFromDate);
  params.set("irmToDate", irmToDate);
  params.set("searchType", searchType);

  return {
    body: params.toString(),
    irmFromDate,
    irmToDate,
    searchType,
  };
}

/**
 * POST DGFT getEBRCBulkDownloadDetails — submit bulk download request.
 */
async function submitEBrcBulkDownloadRequestOnce(options = {}) {
  const submit = buildEbrcBulkDownloadSubmitBody(options);

  const { response, session, csrfToken, csrfHeaderName, screenId } =
    await dgftAuthenticatedPost({
      ...options,
      screenId: DEFAULT_LOADPAGE_SCREEN_ID,
      actionVal: "getEBRCBulkDownloadDetails",
      accept: "text/html, */*; q=0.01",
      body: submit.body,
    });

  const html = await response.text();
  if (!response.ok) {
    throw new Error(
      `eBRC bulk download submit failed with HTTP ${response.status}: ${html.slice(0, 300)}`
    );
  }

  const dgftError = parseDgftHtmlError(html);
  if (dgftError) {
    throw new Error(dgftError);
  }

  const rows = parseEBrcBulkDownloadTable(html);

  if (options.companyId) {
    await saveDgftSession(options.companyId, {
      cookies: session.cookies,
      csrfToken,
      csrfHeaderName,
      screenId,
    });
  }

  return {
    html,
    rows,
    count: rows.length,
    irmFromDate: submit.irmFromDate,
    irmToDate: submit.irmToDate,
    searchType: submit.searchType,
    cookies: session.cookies,
    csrfToken,
    csrfHeaderName,
    screenId,
    status: response.status,
    sessionFromCache: session.fromCache === true,
    sessionRefreshed: session.refreshed === true,
  };
}

async function submitEBrcBulkDownloadRequest(options = {}) {
  return withDgftSessionRetry(
    (attempt) => submitEBrcBulkDownloadRequestOnce(attempt),
    options
  );
}

/**
 * POST DGFT getAttachmentDetails and return attachment bytes for frontend download.
 */
async function fetchEBrcAttachmentOnce(options = {}) {
  const attachId = stripQuotes(options.attachId);
  if (!attachId || !/^\d+$/.test(attachId)) {
    throw new Error("attachId is required and must be numeric.");
  }

  const { response, session, screenId } = await dgftAuthenticatedPost({
    ...options,
    screenId: DEFAULT_LOADPAGE_SCREEN_ID,
    actionVal: "getAttachmentDetails",
    accept: "application/json, text/javascript, */*; q=0.01",
    body: `attachId=${encodeURIComponent(attachId)}`,
  });

  const contentType = response.headers.get("content-type") || "";
  const contentDisposition = response.headers.get("content-disposition") || "";

  if (isBinaryContentType(contentType)) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      throw new Error(
        `getAttachmentDetails failed with HTTP ${response.status}: ${buffer.toString("utf8").slice(0, 300)}`
      );
    }

    const normalized = normalizeDgftAttachmentDownload(
      buffer,
      resolveAttachmentFileName(null, attachId, contentDisposition, DEFAULT_EBRC_XLS_NAME)
    );

    return {
      buffer: normalized.buffer,
      contentType: normalized.contentType,
      fileName: normalized.fileName,
      attachId,
      screenId,
      status: response.status,
      sessionFromCache: session.fromCache === true,
      sessionRefreshed: session.refreshed === true,
    };
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `getAttachmentDetails failed with HTTP ${response.status}: ${text.slice(0, 300)}`
    );
  }

  if (isAttachmentDetailsReference(text)) {
    const reference = parseAttachmentDetailsReference(text);
    const downloaded = await fetchEBrcAttachmentFile({
      mpgId: reference.mpgId,
      filePath: reference.filePath,
      fileName: reference.fileName,
      csrfToken: session.csrfToken,
      cookies: session.cookies,
      attachId,
    });

    return {
      buffer: downloaded.buffer,
      contentType: "application/vnd.ms-excel",
      fileName: ensureXlsFileName(reference.fileName || downloaded.fileName),
      attachId,
      screenId,
      status: response.status,
      attachmentReference: reference,
      sessionFromCache: session.fromCache === true,
      sessionRefreshed: session.refreshed === true,
    };
  }

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (payload && typeof payload === "object") {
    const buffer = bufferFromAttachmentJson(payload, attachId);
    if (buffer?.length) {
      return {
        buffer,
        contentType:
          payload.contentType ||
          payload.mimeType ||
          contentType ||
          "application/octet-stream",
        fileName: resolveAttachmentFileName(payload, attachId, contentDisposition),
        attachId,
        screenId,
        status: response.status,
        sessionFromCache: session.fromCache === true,
        sessionRefreshed: session.refreshed === true,
      };
    }
  }

  throw new Error(
    `Unexpected getAttachmentDetails response for attachId ${attachId}: ${text.slice(0, 300)}`
  );
}

async function fetchEBrcAttachment(options = {}) {
  return withDgftSessionRetry(
    (attempt) => fetchEBrcAttachmentOnce(attempt),
    options
  );
}

/**
 * Login (if needed), fetch loadpage HTML, parse download-requests table.
 */
async function fetchEBrcBulkDownloadRequests(options = {}) {
  const fetched = await fetchEBrcBulkDownloadHtml(options);
  const rows = parseEBrcBulkDownloadTable(fetched.html);

  return {
    rows,
    count: rows.length,
    cookies: fetched.cookies,
    csrfToken: fetched.csrfToken,
    screenId: fetched.screenId,
    menuCode: fetched.menuCode,
    status: fetched.status,
    sessionFromCache: fetched.sessionFromCache === true,
    sessionRefreshed: fetched.sessionRefreshed === true,
  };
}

module.exports = {
  parseEBrcBulkDownloadTable,
  parseAttachmentDetailsReference,
  buildContentDispositionHeader,
  normalizeDgftAttachmentDownload,
  fetchEBrcBulkDownloadHtml,
  fetchEBrcBulkDownloadRequests,
  submitEBrcBulkDownloadRequest,
  fetchEBrcAttachment,
  fetchEBrcAttachmentFile,
};
