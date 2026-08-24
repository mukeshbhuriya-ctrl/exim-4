const fs = require("fs/promises");
const path = require("path");

const BASE_FIELDS = ["source_pdf", "Port Code", "SB No", "SB Date"];

const PART3_COLUMNS = [
  "1.INVSN",
  "2.ITEMSN",
  "3.HS CD",
  "4.DESCRIPTION",
  "5.QUANTITY",
  "6.UQC",
  "7.RATE",
  "8.VALUE(F/C)",
  "9.FOB (INR)",
  "10.PMV",
  "11.DUTYAMT",
  "12.CESS RT",
  "13.CESAMT",
  "14.DBKCLMD",
  "15.IGSTSTAT",
  "16.IGST VALUE",
  "17.IGST AMOUNT",
  "18.SCHCOD",
  "19.SCHEME DESCRIPTION",
  "20.SQC MSR",
  "21.SQC UQC",
  "22.STATE OF ORIGIN",
  "23.DISTRICT OF ORIGIN",
  "24.PT Abroad",
  "25.COMP CESS",
  "26.END USE",
  "27.FTA BENEFIT AVAILED",
  "28.REWARD BENEFIT",
  "29.THIRD PARTY ITEM",
];

const PART4_A_COLUMNS = [
  "1.INV SNO",
  "2.ITEM SNO",
  "3.DBK SNO.",
  "4.QTY/WT",
  "5.VALUE",
  "6.RATE",
  "7.DBK AMT",
  "8.STALEV",
  "9.CENLEV",
  "10.ROSCTL AMT",
];

const PART4_H_COLUMNS = [
  "1.SNO",
  "2.INVOICENO",
  "3.INVOICEAMOUNT",
  "4.CURRENCY",
];

const PART4_M_COLUMNS = [
  "1.INVSN",
  "2.ITMSN",
  "3.QUANTITY",
  "4.UQC",
  "5.NO.OF UNITS",
  "6. VALUE",
];

const ROW_SECTION_CONFIGS = [
  ["id.", PART3_COLUMNS],
  ["dbk.", PART4_A_COLUMNS],
  ["inv.", PART4_H_COLUMNS],
  ["rodtep.", PART4_M_COLUMNS],
];

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function textOrEmpty(value) {
  return cleanText(value) || "";
}

function getCleanLines(pageText) {
  return String(pageText || "")
    .split(/\r?\n/)
    .map((line) => textOrEmpty(line))
    .filter(Boolean);
}

function emptyRow(columns) {
  const row = {};
  for (const column of columns) {
    row[column] = null;
  }
  return row;
}

function normalizeRow(row, columns) {
  const normalized = emptyRow(columns);
  for (const column of columns) {
    normalized[column] = cleanText(row[column]);
  }
  return normalized;
}

function normalizeRows(rows, columns) {
  return rows.map((row) => normalizeRow(row, columns));
}

function firstValue(row, keys) {
  if (!row) return null;
  for (const key of keys) {
    const value = cleanText(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function itemJoinKey(invoiceSerial, itemSerial) {
  const invoice = cleanText(invoiceSerial);
  const item = cleanText(itemSerial);
  if (!invoice || !item) return null;
  return `${invoice}::${item}`;
}

function invoiceJoinKey(invoiceSerial) {
  return cleanText(invoiceSerial);
}

function buildItemLookup(rows, invoiceKeys, itemKeys) {
  const lookup = new Map();
  for (const row of rows || []) {
    const key = itemJoinKey(firstValue(row, invoiceKeys), firstValue(row, itemKeys));
    if (key && !lookup.has(key)) lookup.set(key, row);
  }
  return lookup;
}

function buildInvoiceLookup(rows, invoiceKeys) {
  const lookup = new Map();
  for (const row of rows || []) {
    const key = invoiceJoinKey(firstValue(row, invoiceKeys));
    if (key && !lookup.has(key)) lookup.set(key, row);
  }
  return lookup;
}

function addPrefixedFields(target, source, prefix, columns) {
  for (const column of columns) {
    target[`${prefix}${column}`] = cleanText(source ? source[column] : null);
  }
}

function emptyPrefixedRow() {
  const row = {};
  for (const [prefix, columns] of ROW_SECTION_CONFIGS) {
    addPrefixedFields(row, null, prefix, columns);
  }
  return row;
}

/** All flat keys stored on PdfUploadRow.data (for report column picker). */
function buildPdfFlatColumnCatalog() {
  const keys = new Set(BASE_FIELDS);
  for (const [prefix, columns] of ROW_SECTION_CONFIGS) {
    for (const column of columns) {
      keys.add(`${prefix}${column}`);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function extractHeaderFromPageText(pageText) {
  const compact = String(pageText || "").replace(/\s+/g, " ");
  const pattern =
    /Port\s*Code\s*SB\s*No\s*SB\s*Date\s*(?:INDIAN\s+CUSTOMS\s+EDI\s+SYSTEM\s*)?([A-Z0-9]{6})\s+(\d+)\s+([0-9]{2}-[A-Z]{3}-[0-9]{2})/i;
  const match = compact.match(pattern);
  if (!match) return null;
  return [
    textOrEmpty(match[1]).toUpperCase(),
    textOrEmpty(match[2]),
    textOrEmpty(match[3]).toUpperCase(),
  ];
}

function extractHeaderFromFilename(pdfStem) {
  const stem = String(pdfStem || "").toUpperCase();
  const match = stem.match(/([A-Z]{6})SB/);
  if (!match) return null;

  const sbMatch = stem.match(/^(\d{7})/);
  return [match[1], sbMatch ? sbMatch[1] : null];
}

function chooseMostCommon(values) {
  const filtered = values.filter(Boolean);
  if (!filtered.length) return null;

  const counts = new Map();
  for (const value of filtered) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  let winner = null;
  let winnerCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }
  return winner;
}

function findHeaderValuesFromPages(pageTexts, pdfStem) {
  const pageHeaders = [];
  for (const pageText of pageTexts) {
    const parsed = extractHeaderFromPageText(pageText);
    if (parsed) pageHeaders.push(parsed);
  }

  const header = {
    "Port Code": chooseMostCommon(pageHeaders.map((item) => item[0])),
    "SB No": chooseMostCommon(pageHeaders.map((item) => item[1])),
    "SB Date": chooseMostCommon(pageHeaders.map((item) => item[2])),
  };

  if ((!header["Port Code"] || !header["SB No"]) && pdfStem) {
    const filenameHeader = extractHeaderFromFilename(pdfStem);
    if (filenameHeader) {
      header["Port Code"] = header["Port Code"] || filenameHeader[0];
      header["SB No"] = header["SB No"] || filenameHeader[1];
    }
  }

  return header;
}

function stripPart3LineNoise(line) {
  let text = textOrEmpty(line);
  if (!text) return "";
  return text
    .replace(/^LET\s+EXPORT\s+COPY\s+/i, "")
    .replace(/^INDIAN\s+CUSTOMS\s+EDI\s+SYSTEM\s+/i, "")
    .trim();
}

const PART3_DETAIL_LINE_REGEX =
  /^(\d+)\s+(\d+)\s+(\d{6,10})\s+(.+?)\s+([\d.,]+)\s+([A-Z]{2,5})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)(?:\s+(.+))?$/;

function parsePart3DetailFromLines(detailLines) {
  if (!Array.isArray(detailLines) || !detailLines.length) return null;

  const cleaned = detailLines.map(stripPart3LineNoise).filter(Boolean);
  const candidates = [];

  for (let i = 0; i < cleaned.length; i += 1) {
    const primary = cleaned[i];
    const extraFromLines = cleaned.slice(i + 1).join(" ");
    candidates.push(cleanText(`${primary} ${extraFromLines}`));
    candidates.push(primary);
  }
  if (cleaned.length > 1) {
    candidates.push(cleaned.join(" "));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(PART3_DETAIL_LINE_REGEX);
    if (!match) continue;

    const trailingDesc = cleanText(match[11] || "");
    const baseDesc = cleanText(match[4]);
    const description = cleanText([baseDesc, trailingDesc].filter(Boolean).join(" "));

    return {
      "1.INVSN": cleanText(match[1]),
      "2.ITEMSN": cleanText(match[2]),
      "3.HS CD": cleanText(match[3]),
      "4.DESCRIPTION": description,
      "5.QUANTITY": cleanText(match[5]),
      "6.UQC": cleanText(match[6]),
      "7.RATE": cleanText(match[7]),
      "8.VALUE(F/C)": cleanText(match[8]),
      "9.FOB (INR)": cleanText(match[9]),
      "10.PMV": cleanText(match[10]),
    };
  }

  return null;
}

function isPart3ItemRowValid(row) {
  return Boolean(row["1.INVSN"] && row["2.ITEMSN"] && row["3.HS CD"]);
}

function isNoiseLine(line) {
  const raw = textOrEmpty(line);
  const text = stripPart3LineNoise(raw) || raw;
  if (!text) return true;
  if (/^LET\s+EXPORT\s+COPY$/i.test(raw)) return true;
  if (/^INVOICE\s*\(\s*\d+\s*\/\s*\d+\s*\)$/i.test(text)) return true;
  if (/^PART\s*[-]?\s*III\b/i.test(text)) return true;
  if (text.length === 1 && /^[A-Za-z]$/.test(text) && !["Y", "N"].includes(text.toUpperCase())) {
    return true;
  }
  if (/^[()/A-Z]+$/.test(text) && text.length <= 4) return true;
  return false;
}

function isPtAbroadSectionNoiseLine(line) {
  const text = stripPart3LineNoise(line) || textOrEmpty(line);
  if (!text) return true;
  if (isNoiseLine(line)) return true;
  if (/^INVOICE\s*\(\s*\d+\s*\/\s*\d+\s*\)$/i.test(text)) return true;
  if (text.includes("1INVSN 2ITEMSN")) return true;
  if (text.includes("24. PT Abroad")) return true;
  if (text.includes("GLOSSARY")) return true;
  return false;
}

function parsePtAbroadValueLine(line) {
  const text = stripPart3LineNoise(line) || textOrEmpty(line);
  if (!text) return null;

  const tokens = text
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (token) =>
        !(token.length === 1 && /^[A-Za-z]$/.test(token) && !["Y", "N"].includes(token.toUpperCase()))
    );

  if (tokens.length < 6) return null;

  const thirdParty = tokens[tokens.length - 1];
  const reward = tokens[tokens.length - 2];
  const fta = tokens[tokens.length - 3];

  if (!/^[YN]$/i.test(thirdParty)) return null;
  if (!/^(Yes|No)$/i.test(reward)) return null;
  if (!/^[YN]$/i.test(fta)) return null;
  if (!/^[A-Z]{2,12}$/i.test(tokens[0])) return null;
  if (!/^[\d.,]+$/.test(tokens[1])) return null;

  let tokenIndex = 2;
  let compCess = tokens[1];
  if (tokens[tokenIndex] && ["INR", "USD", "EUR"].includes(tokens[tokenIndex].toUpperCase())) {
    compCess = `${tokens[1]} ${tokens[tokenIndex]}`;
    tokenIndex += 1;
  }

  const endUse = tokens.slice(tokenIndex, tokens.length - 3).join(" ");
  if (!endUse) return null;

  return {
    "24.PT Abroad": cleanText(tokens[0].toUpperCase()),
    "25.COMP CESS": cleanText(compCess),
    "26.END USE": cleanText(endUse),
    "27.FTA BENEFIT AVAILED": cleanText(fta.toUpperCase()),
    "28.REWARD BENEFIT": cleanText(reward),
    "29.THIRD PARTY ITEM": cleanText(thirdParty.toUpperCase()),
  };
}

function collectPtAbroadValueLines(lines, startIdx, stopMarkers) {
  const collected = [];
  let index = startIdx;

  while (index < lines.length) {
    const line = lines[index];
    if (stopMarkers.some((marker) => line.includes(marker))) {
      break;
    }
    if (!isPtAbroadSectionNoiseLine(line)) {
      collected.push(line);
    }
    index += 1;
  }

  return { lines: collected, nextIndex: index };
}

function parsePtAbroadFieldsFromLines(valueLines) {
  if (!Array.isArray(valueLines) || !valueLines.length) return null;

  for (const line of valueLines) {
    const parsed = parsePtAbroadValueLine(line);
    if (parsed) return parsed;
  }

  const joined = valueLines
    .map((line) => stripPart3LineNoise(line) || textOrEmpty(line))
    .filter(Boolean)
    .join(" ");
  return parsePtAbroadValueLine(joined);
}

function findFirstMeaningfulLine(lines, startIdx, stopMarkers) {
  let index = startIdx;
  while (index < lines.length) {
    const line = lines[index];
    if (stopMarkers.some((marker) => line.includes(marker))) return ["", index];
    if (!isNoiseLine(line)) return [line, index + 1];
    index += 1;
  }
  return ["", index];
}

function parsePart3Page(pageText) {
  const lines = getCleanLines(pageText);
  const rows = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].includes("1INVSN 2ITEMSN 3.HS CD")) {
      index += 1;
      continue;
    }

    const row = emptyRow(PART3_COLUMNS);
    index += 1;

    const detailLines = [];
    while (
      index < lines.length &&
      !lines[index].includes("11.DUTYAMT") &&
      !lines[index].includes("1INVSN 2ITEMSN 3.HS CD")
    ) {
      if (!isNoiseLine(lines[index])) detailLines.push(lines[index]);
      index += 1;
    }

    const parsedDetail = parsePart3DetailFromLines(detailLines);
    if (parsedDetail) {
      Object.assign(row, parsedDetail);
    }

    if (index < lines.length && lines[index].includes("11.DUTYAMT")) {
      index += 1;
      const [values1118, nextIndex] = findFirstMeaningfulLine(lines, index, [
        "19. SCHEME DESCRIPTION",
        "1INVSN 2ITEMSN 3.HS CD",
      ]);
      index = nextIndex;

      const tokens = values1118.split(/\s+/).filter(Boolean);
      if (tokens.length >= 1) row["14.DBKCLMD"] = cleanText(tokens[0]);
      if (tokens.length >= 2) {
        let igstStatus = tokens[1].toUpperCase();
        if (igstStatus.endsWith("LUT")) igstStatus = "LUT";
        row["15.IGSTSTAT"] = cleanText(igstStatus);
      }
      if (tokens.length >= 3) row["18.SCHCOD"] = cleanText(tokens[tokens.length - 1]);

      const middleTokens = tokens.length > 3 ? tokens.slice(2, -1) : [];
      const numberTokens = middleTokens.filter((token) => /^[\d.,]+$/.test(token));
      if (numberTokens.length >= 1) row["16.IGST VALUE"] = cleanText(numberTokens[0]);
      if (numberTokens.length >= 2) row["17.IGST AMOUNT"] = cleanText(numberTokens[1]);
    }

    if (index < lines.length && lines[index].includes("19. SCHEME DESCRIPTION")) {
      index += 1;
      const [values1923, nextIndex] = findFirstMeaningfulLine(lines, index, [
        "24. PT Abroad",
        "1INVSN 2ITEMSN 3.HS CD",
      ]);
      index = nextIndex;

      const schemeMatch = values1923.match(
        /^(.*?)\s+([\d.,]+)\s+([A-Z]{2,5})\s+([A-Za-z ]+?)\s+([A-Za-z ]+)$/
      );
      if (schemeMatch) {
        row["19.SCHEME DESCRIPTION"] = cleanText(schemeMatch[1]);
        row["20.SQC MSR"] = cleanText(schemeMatch[2]);
        row["21.SQC UQC"] = cleanText(schemeMatch[3]);
        row["22.STATE OF ORIGIN"] = cleanText(schemeMatch[4]);
        row["23.DISTRICT OF ORIGIN"] = cleanText(schemeMatch[5]);
      } else {
        row["19.SCHEME DESCRIPTION"] = cleanText(values1923);
      }
    }

    while (
      index < lines.length &&
      !lines[index].includes("24. PT Abroad") &&
      !lines[index].includes("1INVSN 2ITEMSN 3.HS CD")
    ) {
      index += 1;
    }

    if (index < lines.length && lines[index].includes("24. PT Abroad")) {
      index += 1;
      const { lines: ptAbroadLines, nextIndex } = collectPtAbroadValueLines(lines, index, [
        "1INVSN 2ITEMSN 3.HS CD",
        "GLOSSARY",
        "Scan QR Code",
      ]);
      index = nextIndex;

      const parsedPtAbroad = parsePtAbroadFieldsFromLines(ptAbroadLines);
      if (parsedPtAbroad) {
        Object.assign(row, parsedPtAbroad);
      }
    }

    if (!isPart3ItemRowValid(row)) {
      continue;
    }

    rows.push(row);
  }

  return rows;
}

function parsePart4APage(pageText) {
  const lines = getCleanLines(pageText);
  const rows = [];

  let startIdx = -1;
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (lines[idx].includes("1.INV SNO 2.ITEM SNO 3.DBK SNO.")) {
      startIdx = idx + 1;
      break;
    }
  }
  if (startIdx === -1) return rows;

  for (let idx = startIdx; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (line.startsWith("B.") || line.includes("AA / DFIA")) break;

    if (/^\d+\s+\d+/.test(line)) {
      const normalizedLine = line.replace(/([0-9])Y([0-9])/g, "$1 $2");
      const tokens = normalizedLine.split(/\s+/);
      if (tokens.length >= 7) {
        const row = emptyRow(PART4_A_COLUMNS);
        row["1.INV SNO"] = cleanText(tokens[0]);
        row["2.ITEM SNO"] = cleanText(tokens[1]);
        row["3.DBK SNO."] = cleanText(tokens[2]);
        row["4.QTY/WT"] = cleanText(tokens[3]);
        row["5.VALUE"] = cleanText(tokens[4]);
        row["6.RATE"] = cleanText(tokens[5]);
        row["7.DBK AMT"] = cleanText(tokens[6]);
        row["8.STALEV"] = cleanText(tokens[7]);
        row["9.CENLEV"] = cleanText(tokens[8]);
        row["10.ROSCTL AMT"] = cleanText(tokens[9]);
        rows.push(row);
      }
    }
  }

  return rows;
}

function parsePart4HPage(pageText) {
  const lines = getCleanLines(pageText);
  const rows = [];

  let headerIdx = -1;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (
      line.includes("1.SNO") &&
      line.includes("2.INVOICE NO") &&
      line.includes("3.INVOICE AMOUNT") &&
      line.includes("4.CURRENCY")
    ) {
      headerIdx = idx;
      break;
    }
  }
  if (headerIdx === -1) return rows;

  function parseInvoiceDetailLine(line) {
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 4 || !/^\d+$/.test(tokens[0])) return null;

    const currencyIndex = tokens.length - 1;
    const amountIndex = tokens.length - 2;
    const invoiceNoIndex = tokens.length - 3;
    const currency = tokens[currencyIndex];
    const amount = tokens[amountIndex];
    const invoiceNo = tokens[invoiceNoIndex];

    if (!/^[A-Z]{3}$/.test(currency)) return null;
    if (!/^[\d.,]+$/.test(amount)) return null;
    if (!/^[A-Z0-9./-]+$/i.test(invoiceNo)) return null;
    if (["LET", "EXPORT", "COPY"].includes(invoiceNo.toUpperCase())) return null;

    const row = emptyRow(PART4_H_COLUMNS);
    row["1.SNO"] = cleanText(tokens[0]);
    row["2.INVOICENO"] = cleanText(invoiceNo);
    row["3.INVOICEAMOUNT"] = cleanText(amount);
    row["4.CURRENCY"] = cleanText(currency);
    return row;
  }

  for (let idx = headerIdx + 1; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (
      line.startsWith("I.CONTAINER") ||
      line.startsWith("Scan QR Code") ||
      line.startsWith("Page ") ||
      line.startsWith("NOITAMROFNI")
    ) {
      break;
    }

    if (/^\d+\s+/.test(line)) {
      const row = parseInvoiceDetailLine(line);
      if (row) rows.push(row);
    }
  }

  return rows;
}

function parsePart4MPage(pageText) {
  const lines = getCleanLines(pageText);
  const rows = [];

  let startIdx = -1;
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (lines[idx].includes("M. RODTEP DETAILS")) {
      startIdx = idx;
      break;
    }
  }
  if (startIdx === -1) return rows;

  let idx = startIdx + 1;
  while (idx < lines.length && !lines[idx].includes("1.INVSN2.ITMSN")) {
    if (lines[idx].startsWith("N. REEXPORT")) return rows;
    idx += 1;
  }
  if (idx >= lines.length) return rows;

  idx += 1;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.startsWith("N. REEXPORT") || line.startsWith("Glossary") || line.startsWith("Scan QR Code")) {
      break;
    }

    const row = parsePart4MDataLine(line);
    if (row) rows.push(row);
    idx += 1;
  }

  return rows;
}

/**
 * RODTEP table can spill to the next PART-IV page without repeating
 * "M. RODTEP DETAILS" (e.g. last item row alone before N. REEXPORT).
 * Only used as a continuation after a header page already produced rows.
 */
function parsePart4MContinuationPage(pageText) {
  const lines = getCleanLines(pageText);
  const rows = [];
  if (!String(pageText || "").includes("PART - IV")) return rows;
  if (String(pageText || "").includes("M. RODTEP DETAILS")) return rows;

  for (const line of lines) {
    if (line.startsWith("N. REEXPORT") || line.startsWith("Glossary") || line.startsWith("Scan QR Code")) {
      break;
    }
    const row = parsePart4MDataLine(line);
    if (row) rows.push(row);
  }
  return rows;
}

/** Parse one RODTEP detail line: INVSN ITMSN QUANTITY UQC NO.OF UNITS VALUE */
function parsePart4MDataLine(line) {
  const text = textOrEmpty(line);
  if (!text) return null;

  // Prefer strict 6-field rows (quantity + alpha UQC), same shape as header table.
  const strict = /^(\d+)\s+(\d+)\s+([\d.,]+)\s+([A-Za-z]{2,5})\s+([\d.,]+)\s+([\d.,]+)$/.exec(
    text
  );
  if (strict) {
    const row = emptyRow(PART4_M_COLUMNS);
    row["1.INVSN"] = cleanText(strict[1]);
    row["2.ITMSN"] = cleanText(strict[2]);
    row["3.QUANTITY"] = cleanText(strict[3]);
    row["4.UQC"] = cleanText(strict[4]);
    row["5.NO.OF UNITS"] = cleanText(strict[5]);
    row["6. VALUE"] = cleanText(strict[6]);
    return row;
  }

  // Keep previous token-split behavior for slightly messier spacing.
  if (/^\d+\s+\d+/.test(text)) {
    const tokens = text.split(/\s+/);
    if (
      tokens.length >= 6 &&
      /^\d+$/.test(tokens[0]) &&
      /^\d+$/.test(tokens[1]) &&
      /^[A-Za-z]{2,5}$/.test(tokens[3])
    ) {
      const row = emptyRow(PART4_M_COLUMNS);
      row["1.INVSN"] = cleanText(tokens[0]);
      row["2.ITMSN"] = cleanText(tokens[1]);
      row["3.QUANTITY"] = cleanText(tokens[2]);
      row["4.UQC"] = cleanText(tokens[3]);
      row["5.NO.OF UNITS"] = cleanText(tokens[4]);
      row["6. VALUE"] = cleanText(tokens[5]);
      return row;
    }
  }

  return null;
}

function textItemsToPageText(items) {
  const positioned = [];

  for (const item of items) {
    if (!item || typeof item.str !== "string") continue;
    const text = item.str.trim();
    if (!text) continue;

    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4] || 0);
    const y = Number(transform[5] || 0);
    positioned.push({ text, x, y });
  }

  if (!positioned.length) return "";

  positioned.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 1.5) return b.y - a.y;
    return a.x - b.x;
  });

  const lines = [];
  for (const token of positioned) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last.y - token.y) > 1.5) {
      lines.push({ y: token.y, parts: [token] });
    } else {
      last.parts.push(token);
    }
  }

  return lines
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

function getStandardFontDataUrl() {
  try {
    const pdfjsPackagePath = require.resolve("pdfjs-dist/package.json");
    const standardFontsPath = path.join(path.dirname(pdfjsPackagePath), "standard_fonts") + path.sep;
    return standardFontsPath.replace(/\\/g, "/");
  } catch {
    return undefined;
  }
}

async function extractTextByPage(pdfPath) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = await fs.readFile(pdfPath);
  const loadOptions = { data: new Uint8Array(data), disableWorker: true };
  const standardFontDataUrl = getStandardFontDataUrl();
  if (standardFontDataUrl) loadOptions.standardFontDataUrl = standardFontDataUrl;

  const loadingTask = pdfjsLib.getDocument(loadOptions);
  const pdf = await loadingTask.promise;
  const pageTexts = [];

  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      pageTexts.push(textItemsToPageText(content.items || []));
    }
  } finally {
    await pdf.destroy();
  }

  return pageTexts;
}

function parsePageTexts(pageTexts, pdfStem) {
  const header = findHeaderValuesFromPages(pageTexts, pdfStem);
  const extracted = {
    header,
    part3_item_details: [],
    part4_a_drawback_rosl_claim: [],
    part4_h_invoice_details: [],
    part4_m_rodtep_details: [],
  };

  for (const pageText of pageTexts) {
    if (pageText.includes("PART - III - ITEM DETAILS")) {
      extracted.part3_item_details.push(...parsePart3Page(pageText));
    }
    if (pageText.includes("A. DRAWBACK & ROSL CLAIM")) {
      extracted.part4_a_drawback_rosl_claim.push(...parsePart4APage(pageText));
    }
    if (pageText.includes("H.INVOICE DETAILS")) {
      extracted.part4_h_invoice_details.push(...parsePart4HPage(pageText));
    }
    if (pageText.includes("M. RODTEP DETAILS")) {
      extracted.part4_m_rodtep_details.push(...parsePart4MPage(pageText));
    } else if (
      extracted.part4_m_rodtep_details.length > 0 &&
      pageText.includes("PART - IV")
    ) {
      // Continuation page: leftover RODTEP rows without repeating the section header.
      extracted.part4_m_rodtep_details.push(...parsePart4MContinuationPage(pageText));
    }
  }

  return extracted;
}

function buildJsonOutput(pdfPath, extracted, sourcePdfDisplayName = null) {
  const pdfName = sourcePdfDisplayName || path.basename(pdfPath);
  const header = extracted.header || {};
  const dbkByItem = buildItemLookup(
    extracted.part4_a_drawback_rosl_claim,
    ["1.INV SNO"],
    ["2.ITEM SNO"]
  );
  const invoiceBySerial = buildInvoiceLookup(extracted.part4_h_invoice_details, ["1.SNO"]);
  const rodtepByItem = buildItemLookup(
    extracted.part4_m_rodtep_details,
    ["1.INVSN"],
    ["2.ITMSN"]
  );

  const output = {
    source_pdf: pdfName,
    "Port Code": cleanText(header["Port Code"]),
    "SB No": cleanText(header["SB No"]),
    "SB Date": cleanText(header["SB Date"]),
    data: [],
  };

  for (const field of BASE_FIELDS) {
    if (!(field in output)) output[field] = null;
  }

  for (const itemRow of extracted.part3_item_details || []) {
    const invoiceSerial = firstValue(itemRow, ["1INVSN", "1.INVSN"]);
    const itemSerial = firstValue(itemRow, ["2ITEMSN", "2.ITEMSN"]);
    const itemKey = itemJoinKey(invoiceSerial, itemSerial);
    const invoiceKey = invoiceJoinKey(invoiceSerial);
    const row = {
      source_pdf: output.source_pdf,
      "Port Code": output["Port Code"],
      "SB No": output["SB No"],
      "SB Date": output["SB Date"],
      ...emptyPrefixedRow(),
    };

    addPrefixedFields(row, itemRow, "id.", PART3_COLUMNS);
    addPrefixedFields(row, itemKey ? dbkByItem.get(itemKey) : null, "dbk.", PART4_A_COLUMNS);
    addPrefixedFields(row, invoiceKey ? invoiceBySerial.get(invoiceKey) : null, "inv.", PART4_H_COLUMNS);
    addPrefixedFields(row, itemKey ? rodtepByItem.get(itemKey) : null, "rodtep.", PART4_M_COLUMNS);
    output.data.push(row);
  }

  return output;
}

async function processPdf(pdfPath) {
  const resolvedPdfPath = path.resolve(pdfPath);
  const pageTexts = await extractTextByPage(resolvedPdfPath);
  const pdfStem = path.parse(resolvedPdfPath).name;
  return parsePageTexts(pageTexts, pdfStem);
}

async function pdfToJson(pdfPath, outputPath = null, sourcePdfDisplayName = null) {
  const resolvedPdfPath = path.resolve(pdfPath);
  const extracted = await processPdf(resolvedPdfPath);
  const jsonOutput = buildJsonOutput(resolvedPdfPath, extracted, sourcePdfDisplayName);

  if (!outputPath) {
    return { outputPath: null, data: jsonOutput };
  }

  const resolvedOutputPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await fs.writeFile(resolvedOutputPath, `${JSON.stringify(jsonOutput, null, 2)}\n`, "utf8");

  return { outputPath: resolvedOutputPath, data: jsonOutput };
}

function printUsage() {
  console.log(
    "Usage: node controllers/company/admin/process/pdf/pdf_extract_data.js <input.pdf> [output.json]"
  );
  console.log("  If output.json is omitted, JSON is printed to stdout (no file is written).");
}

async function main() {
  const [inputPdf, outputJson] = process.argv.slice(2);

  if (!inputPdf) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { outputPath, data } = await pdfToJson(inputPdf, outputJson || null, null);
  if (outputPath) {
    console.log(`JSON written: ${outputPath}`);
  } else {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  BASE_FIELDS,
  PART3_COLUMNS,
  PART4_A_COLUMNS,
  PART4_H_COLUMNS,
  PART4_M_COLUMNS,
  ROW_SECTION_CONFIGS,
  buildPdfFlatColumnCatalog,
  buildJsonOutput,
  extractTextByPage,
  parsePageTexts,
  pdfToJson,
  processPdf,
};
