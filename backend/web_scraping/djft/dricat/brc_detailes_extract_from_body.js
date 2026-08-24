/**
 * Output keys match DGFT e-BRC form `id`/`name` values (same shape as Selenium
 * `extractBrcDetailForm` in `web_scraping/djft/main.js`). Each alias list’s first
 * entry is that primary form key; remaining entries are labels / API variants.
 */
const FIELD_ALIASES = {
  brNumber: ["brNumber"],
  bankAcNo: [
    "bankAcNo",
    "accountNo",
    "accountNumber",
    "Account number in which the amount is realized.",
    "Account number in which the amount is realized. *",
  ],
  branch: ["branch", "Branch", "Branch *"],
  brcNumber: ["brcNumber", "BRC Number", "Bank Realisation Number", "brNumber"],
  brcStatus: [
    "brcStatus",
    "brcStatus.value",
    "status",
    "Status of the BRC",
    "Status of the BRC *",
  ],
  brcType: ["brcType", "BRC Type", "BRC Type *"],
  ccExchangeRate: ["ccExchangeRate", "CC Exchange Rate"],
  chCode: [
    "chCode",
    "customHouseCode",
    "Custom House Code shared by the RBI",
    "customHouseCodeSharedByRbi",
  ],
  commission: ["commission", "commissionValue", "Commission value paid by the exporter"],
  commissionFc: [
    "commissionFc",
    "commissionCurrencyCode",
    "Foreign currency code for the commission value",
  ],
  discountFc: [
    "discountFc",
    "discountCurrencyCode",
    "Foreign currency code of the discount",
  ],
  discountValue: ["discountValue", "discountValueFc", "Discount value"],
  exportPortCode: [
    "exportPortCode",
    "exportPort",
    "exportPortCode.value",
    "Port code of the export",
    "Port code of the export *",
  ],
  exporterName: ["exporterName", "nameOfExporter", "Name Of Exporter", "Name Of Exporter *"],
  fccRvalue: [
    "fccRvalue",
    "realizedAmountCurrencyCode",
    "Currency code for the realized amount",
    "Currency code for the realized amount *",
  ],
  fobValUSD: ["fobValUSD", "fobUsd", "FOB USD"],
  freight: ["freight", "Freight"],
  freightFc: ["freightFc", "freightCurrencyCode", "Freight Foreign currency code"],
  gstInvoiceDate: ["gstInvoiceDate", "GST Invoice Date", "GST Invoice Date *"],
  gstInvoiceNumber: ["gstInvoiceNumber", "gstInvoiceNo", "GST Invoice No.", "GST Invoice No. *"],
  gstinAvail: [
    "gstinAvail",
    "isGstinBenefit",
    "gstinBenefit",
    "Whether you want to avail GSTIN benefit",
    "Whether you want to avail GSTIN benefit *",
  ],
  iecNumber: [
    "iecNumber",
    "iecNo",
    "Iec Number Of The Exporter",
    "Iec Number Of The Exporter *",
  ],
  ifscCode: [
    "ifscCode",
    "IFSC Code of the account in which the amount is realized",
    "IFSC Code of the account in which the amount is realized *",
  ],
  importFile1: ["importFile1"],
  insuranceFc: [
    "insuranceFc",
    "insuranceCurrencyCode",
    "Insurance foreign currency code",
  ],
  insuranceValue: ["insuranceValue", "insuranceValueFc", "Insurance value"],
  invoiceNumber: ["invoiceNumber", "Invoice Number", "Invoice Number *"],
  netRealizedValueFc: ["netRealizedValueFc", "Net Realized Value(FC)"],
  netRealizedValueInr: [
    "netRealizedValueInr",
    "Net Realized Value(INR)",
    "Net Realized Value in INR",
  ],
  otherDeduction: [
    "otherDeduction",
    "otherDeductionValue",
    "otherDeductionValueFc",
    "Other Deduction Value",
  ],
  otherDeductionFc: [
    "otherDeductionFc",
    "otherDeductionCurrencyCode",
    "Other Deduction foreign currency code",
  ],
  realisationDate: [
    "realisationDate",
    "realizationDate",
    "Date on which the amount is realized in the bank",
    "Date on which the amount is realized in the bank *",
  ],
  realizedAmountCC: [
    "realizedAmountCC",
    "fobValueFc",
    "fobValueRealizedFc",
    "FOB value realized in the foreign currency code",
    "FOB value realized in the foreign currency code *",
  ],
  realizedAmountCC1: ["realizedAmountCC1"],
  sbCC: [
    "sbCC",
    "sbCC.value",
    "sbCurrencyCode",
    "shippingBillCurrencyCode",
    "Shipping bill currency code",
    "Shipping bill currency code *",
  ],
  sbDate: ["sbDate", "Shipping Bill Date", "Shipping Bill Date *"],
  sbNumber: ["sbNumber", "sbNo", "Shipping Bill Number", "Shipping Bill Number *"],
  sbValueFc: ["sbValueFc", "shippingValue", "Shipping value in the currency code"],
  sbValueFc1: ["sbValueFc1"],
  uploadDate: [
    "uploadDate",
    "Date on which BRC uploaded by the RBI-CBIC/Banks",
    "Date on which BRC uploaded by the RBI-CBIC/Banks *",
  ],
  usdExchangeRate: ["usdExchangeRate", "USD Exchange Rate"],
  utilizationF: [
    "utilizationF",
    "utilizationStatus",
    "Utilization Status",
    "utilizationStatus.value",
  ],

  /** Same fields as above; extra aliases for older keys / labels (export key = aliases[0]) */
  iecNo: ["iecNo", "iecNumber", "Iec Number Of The Exporter", "Iec Number Of The Exporter *"],
  status: ["brcStatus", "brcStatus.value", "status", "Status of the BRC", "Status of the BRC *"],
  accountNumber: [
    "bankAcNo",
    "accountNo",
    "accountNumber",
    "Account number in which the amount is realized.",
    "Account number in which the amount is realized. *",
  ],
  gstinBenefit: [
    "gstinAvail",
    "isGstinBenefit",
    "gstinBenefit",
    "Whether you want to avail GSTIN benefit",
    "Whether you want to avail GSTIN benefit *",
  ],
  gstInvoiceNo: ["gstInvoiceNo", "gstInvoiceNumber", "GST Invoice No.", "GST Invoice No. *"],
  gstinNumber: ["gstinNo", "gstinNumber", "GSTIN Number", "GSTIN Number *"],
  address: ["address", "Address", "Address *"],
  customHouseCode: [
    "customHouseCode",
    "chCode",
    "Custom House Code shared by the RBI",
    "customHouseCodeSharedByRbi",
  ],
  sbCurrencyCode: [
    "sbCC",
    "sbCurrencyCode",
    "shippingBillCurrencyCode",
    "Shipping bill currency code",
    "Shipping bill currency code *",
  ],
  shippingValue: ["sbValueFc", "shippingValue", "Shipping value in the currency code"],
  fobValueRealizedFc: [
    "realizedAmountCC",
    "fobValueFc",
    "fobValueRealizedFc",
    "FOB value realized in the foreign currency code",
    "FOB value realized in the foreign currency code *",
  ],
  fobUsd: ["fobValUSD", "fobUsd", "FOB USD"],
  commissionValue: ["commission", "commissionValue", "Commission value paid by the exporter"],
  commissionCurrencyCode: [
    "commissionFc",
    "commissionCurrencyCode",
    "Foreign currency code for the commission value",
  ],
  discountCurrencyCode: [
    "discountFc",
    "discountCurrencyCode",
    "Foreign currency code of the discount",
  ],
  otherDeductionValue: [
    "otherDeduction",
    "otherDeductionValue",
    "otherDeductionValueFc",
    "Other Deduction Value",
  ],
  otherDeductionCurrencyCode: [
    "otherDeductionFc",
    "otherDeductionCurrencyCode",
    "Other Deduction foreign currency code",
  ],
  freightCurrencyCode: ["freightFc", "freightCurrencyCode", "Freight Foreign currency code"],
  realizedAmountCurrencyCode: [
    "realizedAmountCurrencyCode",
    "Currency code for the realized amount",
    "Currency code for the realized amount *",
  ],
};

const IGNORED_EXTRACTED_VALUES = new Set([
  "*",
  "please select",
  "select",
  "utilization",
]);

const LABEL_TO_FIELD = new Map();
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const alias of aliases) {
    LABEL_TO_FIELD.set(normalizeLookupKey(alias), field);
  }
}

function normalizeLookupKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&nbsp;/gi, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function decodeHtmlEntities(value) {
  const entityMap = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return String(value || "").replace(
    /&(#x?[0-9a-f]+|amp|apos|gt|lt|nbsp|quot);/gi,
    (match, entity) => {
      const lower = String(entity).toLowerCase();
      if (lower[0] === "#") {
        const isHex = lower[1] === "x";
        const number = Number.parseInt(lower.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return Number.isFinite(number) ? String.fromCodePoint(number) : match;
      }
      return entityMap[lower] || match;
    }
  );
}

function hasMeaningfulValue(value) {
  if (value == null) return false;
  if (typeof value === "string") {
    const normalized = decodeHtmlEntities(value)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return normalized !== "" && !IGNORED_EXTRACTED_VALUES.has(normalized);
  }
  return true;
}

function cleanScalarValue(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
    return trimmed === "" ? null : trimmed;
  }
  return value;
}

function compactObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => hasMeaningfulValue(value))
  );
}

function stripTags(value) {
  return String(value || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|label|li|option|p|td|th|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function parseAttributes(source) {
  const attrs = {};
  const attrRegex = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = null;
  while ((match = attrRegex.exec(source)) !== null) {
    const name = String(match[1] || "").trim();
    if (!name) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = value;
  }
  return attrs;
}

function readSelectedOptionText(innerHtml) {
  const optionRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  const options = [];
  let match = null;
  while ((match = optionRegex.exec(innerHtml)) !== null) {
    options.push({
      attrs: parseAttributes(match[1] || ""),
      text: cleanScalarValue(stripTags(match[2] || "")),
    });
  }

  const selectedOptions = options.filter((option) =>
    Object.prototype.hasOwnProperty.call(option.attrs, "selected")
  );
  if (selectedOptions.length) {
    return selectedOptions.find((option) => hasMeaningfulValue(option.text))?.text || null;
  }

  const meaningfulOptions = options.filter((option) => hasMeaningfulValue(option.text));
  if (meaningfulOptions.length === 1) return meaningfulOptions[0].text;
  return null;
}

function extractHtmlFormValues(html) {
  const output = {};

  const inputRegex = /<input\b([^>]*)>/gi;
  let match = null;
  while ((match = inputRegex.exec(html)) !== null) {
    const attrs = parseAttributes(match[1] || "");
    const fieldKey = String(attrs.id || attrs.name || "").trim();
    const type = String(attrs.type || "text").toLowerCase();
    if (!fieldKey || type === "hidden") continue;
    if ((type === "checkbox" || type === "radio") && !("checked" in attrs)) continue;
    output[fieldKey] = cleanScalarValue(attrs.value ?? "") || "";
  }

  const textareaRegex = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
  while ((match = textareaRegex.exec(html)) !== null) {
    const attrs = parseAttributes(match[1] || "");
    const fieldKey = String(attrs.id || attrs.name || "").trim();
    if (!fieldKey) continue;
    output[fieldKey] = cleanScalarValue(stripTags(match[2] || "")) || "";
  }

  const selectRegex = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  while ((match = selectRegex.exec(html)) !== null) {
    const attrs = parseAttributes(match[1] || "");
    const fieldKey = String(attrs.id || attrs.name || "").trim();
    if (!fieldKey) continue;
    output[fieldKey] = readSelectedOptionText(match[2] || "") || "";
  }

  return output;
}

function extractLabelValuePairsFromText(source) {
  const lines = decodeHtmlEntities(stripTags(source))
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const output = {};

  for (let index = 0; index < lines.length; index += 1) {
    const field = LABEL_TO_FIELD.get(normalizeLookupKey(lines[index]));
    if (!field) continue;

    let value = null;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (LABEL_TO_FIELD.has(normalizeLookupKey(lines[next]))) break;
      if (!hasMeaningfulValue(lines[next])) {
        index = next;
        continue;
      }
      value = lines[next];
      index = next;
      break;
    }

    if (hasMeaningfulValue(value) && !Object.prototype.hasOwnProperty.call(output, field)) {
      output[field] = value;
    }
  }

  return output;
}

function addLookupValue(lookup, key, value) {
  const cleaned = cleanScalarValue(value);
  if (!key || !hasMeaningfulValue(cleaned)) return;

  const rawKey = String(key).trim();
  const normalizedKey = normalizeLookupKey(rawKey);
  if (rawKey && !lookup.has(rawKey)) lookup.set(rawKey, cleaned);
  if (normalizedKey && !lookup.has(normalizedKey)) lookup.set(normalizedKey, cleaned);
}

function collectLookupValues(lookup, source, prefix = "") {
  if (source == null) return;

  if (Array.isArray(source)) {
    for (const item of source) {
      if (item && typeof item === "object") {
        const label = item.label ?? item.name ?? item.field ?? item.title;
        const value = item.value ?? item.text ?? item.fieldValue ?? item.val;
        if (label != null && value != null) addLookupValue(lookup, label, value);
      }
      collectLookupValues(lookup, item, prefix);
    }
    return;
  }

  if (typeof source !== "object") {
    if (prefix) addLookupValue(lookup, prefix, source);
    return;
  }

  if (
    prefix &&
    Object.prototype.hasOwnProperty.call(source, "value") &&
    typeof source.value !== "object"
  ) {
    addLookupValue(lookup, prefix, source.value);
    addLookupValue(lookup, `${prefix}.value`, source.value);
  }

  if (
    prefix &&
    Object.prototype.hasOwnProperty.call(source, "key") &&
    typeof source.key !== "object"
  ) {
    addLookupValue(lookup, `${prefix}.key`, source.key);
  }

  for (const [key, value] of Object.entries(source)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;

    if (value != null && typeof value !== "object") {
      addLookupValue(lookup, key, value);
      addLookupValue(lookup, nextPrefix, value);
      continue;
    }

    collectLookupValues(lookup, value, nextPrefix);
  }
}

function buildLookupMap(source) {
  const lookup = new Map();
  collectLookupValues(lookup, source);
  return lookup;
}

function pickLookupValue(lookup, aliases) {
  for (const alias of aliases) {
    if (lookup.has(alias)) return lookup.get(alias);

    const normalizedAlias = normalizeLookupKey(alias);
    if (lookup.has(normalizedAlias)) return lookup.get(normalizedAlias);
  }
  return null;
}

function normalizeDetailSource(source) {
  if (typeof source !== "string") return source;

  const textValues = extractLabelValuePairsFromText(source);
  const htmlValues = extractHtmlFormValues(source);

  return {
    ...textValues,
    ...htmlValues,
  };
}

function mapBrcDetailRow(row) {
  const lookup = buildLookupMap(row || {});
  const output = {};

  if (row && typeof row === "object" && !Array.isArray(row)) {
    for (const [k, v] of Object.entries(row)) {
      if (Array.isArray(v)) continue;
      if (v !== null && typeof v === "object" && !(v instanceof Date)) continue;
      const cleaned = cleanScalarValue(v);
      if (!hasMeaningfulValue(cleaned)) continue;
      output[k] = cleaned;
    }
  }

  for (const [, aliases] of Object.entries(FIELD_ALIASES)) {
    const exportKey = aliases[0];
    if (!exportKey) continue;
    const value = pickLookupValue(lookup, aliases);
    if (!hasMeaningfulValue(value)) continue;
    output[exportKey] = value;
  }

  return compactObject(output);
}

function extractDetailCandidates(body, text) {
  if (Array.isArray(body?.data)) return body.data;
  if (body?.data != null) return [body.data];
  if (Array.isArray(body)) return body;
  if (body != null) return [body];
  if (hasMeaningfulValue(text)) return [text];
  return [];
}

function extractBrcDetailsFromBody(body, options = {}) {
  const rawBody = typeof body === "string" ? body : "";
  let parsedBody = body;

  if (typeof body === "string") {
    try {
      parsedBody = JSON.parse(body);
    } catch {
      parsedBody = body;
    }
  }

  const filteredRows = extractDetailCandidates(parsedBody, rawBody)
    .map(normalizeDetailSource)
    .map(mapBrcDetailRow)
    .filter((row) => Object.keys(row).length > 0);

  const requestedBrcNumber = String(options.brcNumber || "").trim();
  const matchedRow =
    filteredRows.find((row) => String(row.brcNumber || "").trim() === requestedBrcNumber) ||
    filteredRows[0] ||
    {};

  return compactObject({
    ...(requestedBrcNumber ? { brcNumber: requestedBrcNumber } : {}),
    ...matchedRow,
  });
}

module.exports = {
  extractBrcDetailsFromBody,
};
