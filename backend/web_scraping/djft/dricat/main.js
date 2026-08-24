const { fetchIecNo, BILL_REPOSITORY_REFERER } = require("./iecno");
const { fetchPortPreview } = require("./fetch_port");
const { fetchBrcNo } = require("./fetch_brc_no");
const { fetchBrcDetails } = require("./fetch_brc_detailes");
const { fetchPdf } = require("./pdf_fetch");
const { fetchCsrfAndScreenId } = require("./backup_csrfandscreenid");
const { extractBrcDetailsFromBody } = require("./brc_detailes_extract_from_body");
const { putObject, getDefaultBucket, isS3Configured } = require("#utils/s3Upload");

function stripQuotes(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function iecNoToNumber(iecNoStr) {
  const s = String(iecNoStr || "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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

function resolveCookies(options = {}) {
  if (Array.isArray(options.cookies) && options.cookies.length) {
    return options.cookies;
  }
  const rawCookie =
    stripQuotes(options.cookie) || stripQuotes(process.env.DGFT_COOKIE);
  if (rawCookie) {
    const parsed = cookiesFromRawHeader(rawCookie);
    if (parsed.length) return parsed;
  }
  const envJson = stripQuotes(process.env.DGFT_COOKIES_JSON);
  if (envJson) {
    const parsed = JSON.parse(envJson);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  }
  throw new Error(
    "cookies are required. Pass options.cookies (array) or options.cookie (raw header)."
  );
}

function isCsrfFetch403Error(error) {
  const msg = String(error?.message || "");
  return (
    /fetchCsrfAndScreenId failed with HTTP 403/i.test(msg) ||
    /Could not find _csrf token/i.test(msg)
  );
}

async function refreshCookiesAfter403(options = {}, currentCookies = []) {
  if (typeof options.refreshCookies === "function") {
    const refreshed = await options.refreshCookies({
      currentCookies,
    });
    if (Array.isArray(refreshed) && refreshed.length) return refreshed;
  }

  return resolveCookies(options);
}

function uniqueBrcNumbersFromResponse(brcResponse) {
  const rows = Array.isArray(brcResponse?.body?.data) ? brcResponse.body.data : [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const brc = String(row?.brcNumber || "").trim();
    if (!brc || seen.has(brc)) continue;
    seen.add(brc);
    out.push(brc);
  }
  return out;
}

function buildSummaryJsonFromBody(body, brcNumber, context = {}) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  if (brcNumber) {
    const matched = rows.find(
      (row) => String(row?.brcNumber || "").trim() === String(brcNumber).trim()
    );
    if (matched && typeof matched === "object") return matched;
  }
  if (rows.length && typeof rows[0] === "object") return rows[0];
  if (body && typeof body === "object" && !Array.isArray(body)) return body;

  const data = context.data || {};
  if (Object.keys(data).length) {
    const brcStatusRaw = data.brcStatus ?? data.status;
    const brcStatusObj =
      brcStatusRaw && typeof brcStatusRaw === "object" && !Array.isArray(brcStatusRaw)
        ? brcStatusRaw
        : brcStatusRaw != null && String(brcStatusRaw).trim() !== ""
          ? { value: brcStatusRaw }
          : null;
    const sbCcRaw = data.sbCC ?? data.sbCurrencyCode;
    const sbCCObj =
      sbCcRaw && typeof sbCcRaw === "object" && !Array.isArray(sbCcRaw)
        ? sbCcRaw
        : sbCcRaw != null && String(sbCcRaw).trim() !== ""
          ? { value: sbCcRaw }
          : null;
    return {
      brcNumber: String(data.brcNumber || brcNumber || ""),
      uploadDate: data.uploadDate || null,
      brcType: data.brcType || null,
      brcStatus: brcStatusObj,
      sbDate: data.sbDate || context.sbDate || null,
      sbNumber: data.sbNumber || context.sbNumber || null,
      ifscCode: data.ifscCode || null,
      bankAcNo: data.bankAcNo || data.accountNumber || null,
      realisationDate: data.realisationDate || null,
      iecNumber: data.iecNumber || data.iecNo || context.iecNo || null,
      exporterName: data.exporterName || null,
      exportPortCode: Array.isArray(context.portPreview)
        ? context.portPreview[0] || null
        : context.portPreview || null,
      invoiceNumber: data.invoiceNumber || null,
      netRealizedValueFc: data.netRealizedValueFc || null,
      realizedAmountCC:
        data.realizedAmountCC ?? data.realizedAmountCC1 ?? data.fobValueRealizedFc ?? null,
      sbCC: sbCCObj,
      branch: data.branch || null,
      address: data.address || null,
      gstIn: data.gstinNumber || null,
      gstinInvoiceNumber: data.gstInvoiceNumber || data.gstInvoiceNo || null,
      gstinInvoiceDate: data.gstInvoiceDate || null,
      isGstAvail: data.gstinAvail ?? data.gstinBenefit ?? data.isGstinBenefit ?? null,
      ccExchangeRate: data.ccExchangeRate || null,
      fobValUSD: data.fobValUSD ?? data.fobUsd ?? null,
      usdExchangeRate: data.usdExchangeRate || null,
      commission: data.commission ?? data.commissionValue ?? null,
      discountValue: data.discountValue || null,
      insuranceValue: data.insuranceValue || null,
      otherDeduction: data.otherDeduction ?? data.otherDeductionValue ?? null,
      freight: data.freight || null,
    };
  }

  return null;
}

function safeS3Segment(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_");
}

async function uploadPdfToS3(pdfResponse, options = {}) {
  if (!pdfResponse?.saved || !pdfResponse?.pdfBuffer) return pdfResponse;
  const companyId = String(options.companyId || "").trim();
  if (!companyId || !isS3Configured()) return pdfResponse;

  const buffer = pdfResponse.pdfBuffer;
  const bucket = getDefaultBucket();
  const fileName = String(pdfResponse.fileName || "Summary.pdf");
  const key = `${safeS3Segment(companyId)}/${fileName}`.replace(/\/+/g, "/");
  const uploaded = await putObject({
    bucket,
    key,
    body: buffer,
    contentType: "application/pdf",
  });

  return {
    ...pdfResponse,
    s3Bucket: uploaded.bucket,
    s3Key: uploaded.key,
    pdfUrl: uploaded.url,
  };
}

function mergeBrcResponseWithDetails(brcResponse, brcDetailsResponses) {
  const rows = Array.isArray(brcResponse?.body?.data) ? brcResponse.body.data : [];
  const detailMap = new Map(
    (brcDetailsResponses || []).map((item) => [String(item?.brcNumber || "").trim(), item])
  );
  const mergedRows = rows.map((row) => {
    const brcNumber = String(row?.brcNumber || "").trim();
    const detail = detailMap.get(brcNumber);
    if (!detail) return row;
    const flattenedDetail = detail
      ? {
          brcNumber: detail.brcNumber || "",
          status:
            detail.status != null && Number.isFinite(Number(detail.status))
              ? Number(detail.status)
              : null,
          ...(detail.data || {}),
          pdfUrl: detail?.pdfUrl || detail?.pdfResponse?.pdfUrl || null,
        }
      : null;
    return {
      ...row,
      detailResponse: flattenedDetail,
      pdfUrl: flattenedDetail?.pdfUrl || null,
    };
  });

  return {
    ...brcResponse,
    body:
      brcResponse && typeof brcResponse.body === "object" && brcResponse.body !== null
        ? {
            ...brcResponse.body,
            data: mergedRows,
          }
        : brcResponse.body,
  };
}

function safeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePortLabel(value) {
  const text = safeText(value);
  if (!text) return "";
  return text.replace(/\s*\([A-Z0-9]+\)\s*$/i, "").trim();
}

function toDisplayNumberOrText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return safeText(value);
}

function buildMainStyleBrcDetail(row) {
  const detail = row?.detailResponse && typeof row.detailResponse === "object" ? row.detailResponse : {};
  const brcStatus = detail.brcStatus ?? detail.status ?? row?.brcStatus?.value ?? row?.brcStatus ?? "";
  return {
    ...detail,
    brNumber: detail.brNumber || detail.brcNumber || row?.brcNumber || "",
    brcNumber: detail.brcNumber || row?.brcNumber || "",
    brcStatus: toDisplayNumberOrText(brcStatus),
    sbDate: detail.sbDate || row?.sbDate || "",
    sbNumber: detail.sbNumber || row?.sbNumber || "",
    uploadDate: detail.uploadDate || row?.uploadDate || "",
    realisationDate: detail.realisationDate || row?.realisationDate || "",
    realizedAmountCC:
      detail.realizedAmountCC ?? row?.realizedAmountCC ?? row?.realizedAmountCC1 ?? "",
    netRealizedValueFc: detail.netRealizedValueFc ?? row?.netRealizedValueFc ?? "",
    invoiceNumber: detail.invoiceNumber || row?.invoiceNumber || "",
    exportPortCode:
      detail.exportPortCode ||
      row?.exportPortCode?.value ||
      row?.exportPortCode ||
      "",
    utilizationF:
      detail.utilizationF ??
      row?.utilizationF ??
      row?.utilizationFlag ??
      false,
    pdfUrl: detail.pdfUrl || row?.pdfUrl || "",
  };
}

function buildMainStyleTableRows(mergedBrcResponse) {
  const rows = Array.isArray(mergedBrcResponse?.body?.data) ? mergedBrcResponse.body.data : [];
  return rows.map((row) => {
    const detail = buildMainStyleBrcDetail(row);
    return {
      "BRC Issue Date": safeText(row?.uploadDate || detail.uploadDate),
      "Bank Realisation Number": safeText(row?.brcNumber || detail.brcNumber),
      "Bank Realisation Status": safeText(
        row?.brcStatus?.value || row?.brcStatus || detail.brcStatus || detail.status
      ),
      "Bill ID": safeText(row?.invoiceNumber || detail.invoiceNumber),
      "Cancel eBRC": safeText(row?.cancelEbrc || "initiate"),
      "Date on which the amount is realized in the bank": safeText(
        row?.realisationDate || detail.realisationDate
      ),
      "FOB value realized in the foreign currency code": toDisplayNumberOrText(
        row?.realizedAmountCC ??
          row?.realizedAmountCC1 ??
          detail.realizedAmountCC ??
          detail.netRealizedValueFc
      ),
      "GST Details": safeText(row?.gstDetails || "-"),
      "Shipping Bill Date": safeText(row?.sbDate || detail.sbDate),
      "Shipping Bill Number": safeText(row?.sbNumber || detail.sbNumber),
      "Shipping Bill Port": normalizePortLabel(
        row?.exportPortCode?.value || row?.exportPortCode || detail.exportPortCode
      ),
      "Utilisation Status": safeText(row?.utilizationStatus || row?.utilizationFlag || "No"),
      brcDetail: detail,
    };
  });
}

/**
 * Flow:
 * 1) fetch cookie (input/env)
 * 2) fetch csrf + screenId from /CP/index.jsp
 * 3) fetch IEC number from billRepository
 * 4) fetch port details from preview API
 * 5) fetch BRC response data
 */
async function fetchDgftData(options = {}) {
  const portOfReg = String(options.portName || options.portOfReg || "").trim();
  const sbNumber = String(options.sbNumber || "").trim();
  const sbDate = String(options.sbDate || "").trim();
  if (!portOfReg) {
    throw new Error("portName (or portOfReg) is required.");
  }
  if (!sbNumber) {
    throw new Error("sbNumber is required.");
  }
  if (!sbDate) {
    throw new Error("sbDate is required.");
  }

  // 1) Fetch cookie
  let cookies = resolveCookies(options);

  // 2) Fetch csrf + screenId (retry once on 403 with refreshed cookies)
  let csrfData;
  try {
    csrfData = await fetchCsrfAndScreenId({ cookie: cookies });
  } catch (error) {
    if (!isCsrfFetch403Error(error)) throw error;
    const refreshedCookies = await refreshCookiesAfter403(options, cookies);
    cookies = refreshedCookies;
    csrfData = await fetchCsrfAndScreenId({ cookie: cookies });
  }
  const csrfToken = stripQuotes(csrfData?.csrfToken);
  const fetchedScreenId = stripQuotes(csrfData?.screenId);
  const previewScreenId = stripQuotes(
    options.portScreenId ||
      options.previewScreenId ||
      process.env.DGFT_PORT_SCREEN_ID ||
      "9000012351"
  );
  if (!csrfToken) throw new Error("Could not resolve csrfToken.");
  if (!previewScreenId) throw new Error("Could not resolve preview screenId.");

  // 3) Fetch IEC number
  const iecResult = await fetchIecNo({
    cookies,
    billRepositoryReferer: BILL_REPOSITORY_REFERER,
    ...(csrfToken ? { csrfToken } : {}),
    ...(process.env.DGFT_BILL_SCREEN_ID
      ? { screenId: stripQuotes(process.env.DGFT_BILL_SCREEN_ID) }
      : {}),
  });
  const iecNo = String(iecResult?.iecNo || "").trim();
  const iecNumber = iecNoToNumber(iecNo);
  cookies = Array.isArray(iecResult?.cookies) ? iecResult.cookies : cookies;

  // 4) Fetch port details
  const portPreview = await fetchPortPreview({
    cookie: cookies,
    csrf: csrfToken,
    screenId: previewScreenId,
    portOfReg,
  });

  // 5) Fetch BRC response
  const brcResponse = await fetchBrcNo({
    cookie: cookies,
    csrf: csrfToken,
    screenId: stripQuotes(process.env.DGFT_BILL_SCREEN_ID || "90000542"),
    sbNumber,
    sbDate,
    iecNo,
    portPreview,
    fromDateOfSelectedBil: String(options.fromDateOfSelectedBil || "").trim(),
    toDateOfSelectedBil: String(options.toDateOfSelectedBil || "").trim(),
  });

  const brcNumbers = uniqueBrcNumbersFromResponse(brcResponse);
  const billRows = Array.isArray(brcResponse?.body?.data) ? brcResponse.body.data : [];
  const hasShippingBillData = billRows.length > 0 && brcNumbers.length > 0;

  const brcDetailsResponses = [];
  const pdfResponses = [];
  for (const brcNumber of brcNumbers) {
    const detailResponse = await fetchBrcDetails({
      cookie: cookies,
      csrf: csrfToken,
      screenId: stripQuotes(process.env.DGFT_BILL_SCREEN_ID || "90000542"),
      brcNumber,
    });
    const body = detailResponse?.body;
    const data = extractBrcDetailsFromBody(body, { brcNumber });
    const summaryjson = buildSummaryJsonFromBody(body, brcNumber, {
      data,
      sbNumber,
      sbDate,
      iecNo,
      portPreview,
    });
    const localPdfResponse = summaryjson
      ? await fetchPdf({
          cookie: cookies,
          csrf: csrfToken,
          summaryjson,
          brcNumber,
          invoiceNumber: data?.invoiceNumber || "",
          fileName: `${brcNumber}_${data?.invoiceNumber || "Summary"}`,
        })
      : {
          status: 0,
          contentType: "",
          body: "",
          endpoint: "",
          saved: false,
          fileName: null,
          pdfBuffer: null,
          byteLength: 0,
        };
    const pdfResponse = await uploadPdfToS3(localPdfResponse, {
      companyId: options.companyId,
    });
    brcDetailsResponses.push({
      ...detailResponse,
      data,
      pdfResponse,
      pdfUrl: pdfResponse?.pdfUrl || null,
    });
    pdfResponses.push({
      brcNumber,
      ...pdfResponse,
    });
  }

  const mergedBrcResponse = mergeBrcResponseWithDetails(brcResponse, brcDetailsResponses);
  const tableRows = buildMainStyleTableRows(mergedBrcResponse);

  return {
    ok: Boolean(iecNo) && hasShippingBillData,
    status: hasShippingBillData ? 200 : "No BRC number found",
    contentType: "application/json",
    body: {
      message: hasShippingBillData
        ? "Fetched csrf/screenId, IEC number, and port details successfully."
        : "No BRC number found for this query.",
    },
    iecNo,
    iecNumber,
    ianNo: iecNo,
    csrfToken,
    fetchedScreenId,
    previewScreenId,
    portOfReg,
    portPreview,
    tableRows,
    brcResponse: mergedBrcResponse,
    brcNumbers,
    brcDetailsResponses,
    pdfResponses,
    cookies,
  };
}

if (require.main === module) {
  fetchDgftData({
    portName: process.env.DGFT_PORT_NAME || "",
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error?.message || error);
      process.exitCode = 1;
    });
}

module.exports = {
  fetchDgftData,
};
