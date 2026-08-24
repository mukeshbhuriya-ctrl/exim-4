const fs = require("fs/promises");
const path = require("path");
const { spawnSync } = require("child_process");
let ExcelJS = null;

function getExcelJS() {
  if (!ExcelJS) {
    // Lazy load so API routes using only `processPdf` do not require exceljs installed.
    ExcelJS = require("exceljs");
  }
  return ExcelJS;
}

const ROOT_FOLDER = __dirname;
const INPUT_DIR = path.join(ROOT_FOLDER, "IN");
const OUTPUT_DIR = path.join(ROOT_FOLDER, "OUT");
const STATUS_DIR = path.join(ROOT_FOLDER, "STATUS");
const TRACKER_PATH = path.join(STATUS_DIR, "PDF_Process_Tracker.xlsx");

const BASE_COLUMNS = ["source_pdf", "Port Code", "SB No", "SB Date"];

const PART3_COLUMNS = [
  "1INVSN",
  "2ITEMSN",
  "3.HS CD",
  "4.DESCRIPTION",
  "5.QUANTITY",
  "6UQC",
  "7.RATE",
  "8VALUE(F/C)",
  "9.FOB (INR)",
  "10.PMV",
  "11.DUTYAMT",
  "12.CESS RT",
  "13CESAMT",
  "14.DBKCLMD",
  "15.IGSTSTAT",
  "16. IGST VALUE",
  "17. IGST AMOUNT",
  "18SCHCOD",
  "19. SCHEME DESCRIPTION",
  "20. SQC MSR",
  "21. SQC UQC",
  "22. STATE OF ORIGIN",
  "23. DISTRICT OF ORIGIN",
  "24. PT Abroad",
  "25.COMP CESS",
  "26.END USE",
  "27.FTA BENEFIT AVAILED",
  "28. REWARD BENEFIT",
  "29. THIRD PARTY ITEM",
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

const SHEET_CONFIGS = [
  ["Part3_Item_Details", PART3_COLUMNS, "part3_item_details"],
  ["Part4_A_Drawback", PART4_A_COLUMNS, "part4_a_drawback_rosl_claim"],
  ["Part4_H_Invoice", PART4_H_COLUMNS, "part4_h_invoice_details"],
  ["Part4_M_RODTEP", PART4_M_COLUMNS, "part4_m_rodtep_details"],
];

const TRACKER_COLUMNS = [
  "document_key",
  "pdf_name",
  "status",
  "start_time",
  "end_time",
  "taken_time_seconds",
  "taken_time_hhmmss",
  "remarks",
  "excel_output_path",
  "json_output_path",
];

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function getCleanLines(pageText) {
  return String(pageText || "")
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter((line) => line);
}

function emptyRow(columns) {
  const row = {};
  for (const col of columns) row[col] = "";
  return row;
}

function extractHeaderFromPageText(pageText) {
  const compact = String(pageText || "").replace(/\s+/g, " ");
  const pattern =
    /Port\s*Code\s*SB\s*No\s*SB\s*Date\s*(?:INDIAN\s+CUSTOMS\s+EDI\s+SYSTEM\s*)?([A-Z0-9]{6})\s+(\d+)\s+([0-9]{2}-[A-Z]{3}-[0-9]{2})/i;
  const match = compact.match(pattern);
  if (!match) return null;
  return [
    cleanText(match[1]).toUpperCase(),
    cleanText(match[2]),
    cleanText(match[3]).toUpperCase(),
  ];
}

function extractHeaderFromFilename(pdfStem) {
  const stem = String(pdfStem || "").toUpperCase();
  const match = stem.match(/([A-Z]{6})SB/);
  if (!match) return null;
  const portCode = match[1];
  const sbMatch = stem.match(/^(\d{7})/);
  const sbNo = sbMatch ? sbMatch[1] : "";
  return [portCode, sbNo];
}

function chooseMostCommon(values) {
  if (!values.length) return "";
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let winner = "";
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

  const portCandidates = pageHeaders.map((h) => h[0]).filter(Boolean);
  const sbCandidates = pageHeaders.map((h) => h[1]).filter(Boolean);
  const dateCandidates = pageHeaders.map((h) => h[2]).filter(Boolean);

  let portCode = chooseMostCommon(portCandidates);
  let sbNo = chooseMostCommon(sbCandidates);
  const sbDate = chooseMostCommon(dateCandidates);

  if ((!portCode || !sbNo) && pdfStem) {
    const filenameHeader = extractHeaderFromFilename(pdfStem);
    if (filenameHeader) {
      portCode = portCode || filenameHeader[0];
      sbNo = sbNo || filenameHeader[1];
    }
  }

  return { "Port Code": portCode, "SB No": sbNo, "SB Date": sbDate };
}

function isNoiseLine(line) {
  const text = cleanText(line);
  if (!text) return true;
  if (text.length === 1 && /[A-Za-z]/.test(text) && !["Y", "N"].includes(text.toUpperCase())) {
    return true;
  }
  if (/^[()/A-Z]+$/.test(text) && text.length <= 4) return true;
  return false;
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

    const primaryLine = detailLines.length ? detailLines[0] : "";
    const extraDescription = detailLines.length > 1 ? detailLines.slice(1).join(" ") : "";

    const detailMatch = primaryLine.match(
      /^(\d+)\s+(\d+)\s+(\d{6,10})(.*?)\s+([\d.,]+)\s+([A-Z]{2,5})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/
    );

    if (detailMatch) {
      row["1INVSN"] = cleanText(detailMatch[1]);
      row["2ITEMSN"] = cleanText(detailMatch[2]);
      row["3.HS CD"] = cleanText(detailMatch[3]);
      row["4.DESCRIPTION"] = cleanText(`${detailMatch[4]} ${extraDescription}`.trim());
      row["5.QUANTITY"] = cleanText(detailMatch[5]);
      row["6UQC"] = cleanText(detailMatch[6]);
      row["7.RATE"] = cleanText(detailMatch[7]);
      row["8VALUE(F/C)"] = cleanText(detailMatch[8]);
      row["9.FOB (INR)"] = cleanText(detailMatch[9]);
      row["10.PMV"] = cleanText(detailMatch[10]);
    } else {
      row["4.DESCRIPTION"] = cleanText(detailLines.join(" "));
    }

    if (index < lines.length && lines[index].includes("11.DUTYAMT")) {
      index += 1;
      const [values1118, nextIndex] = findFirstMeaningfulLine(lines, index, [
        "19. SCHEME DESCRIPTION",
        "1INVSN 2ITEMSN 3.HS CD",
      ]);
      index = nextIndex;

      const tokens = values1118.split(/\s+/).filter(Boolean);
      if (tokens.length >= 1) row["14.DBKCLMD"] = tokens[0];
      if (tokens.length >= 2) {
        let igst = tokens[1].toUpperCase();
        if (igst.endsWith("LUT")) igst = "LUT";
        row["15.IGSTSTAT"] = igst;
      }
      if (tokens.length >= 3) row["18SCHCOD"] = tokens[tokens.length - 1];

      const middleTokens = tokens.length > 3 ? tokens.slice(2, -1) : [];
      const numberTokens = middleTokens.filter((t) => /^[\d.,]+$/.test(t));
      if (numberTokens.length >= 1) row["16. IGST VALUE"] = numberTokens[0];
      if (numberTokens.length >= 2) row["17. IGST AMOUNT"] = numberTokens[1];
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
        row["19. SCHEME DESCRIPTION"] = cleanText(schemeMatch[1]);
        row["20. SQC MSR"] = cleanText(schemeMatch[2]);
        row["21. SQC UQC"] = cleanText(schemeMatch[3]);
        row["22. STATE OF ORIGIN"] = cleanText(schemeMatch[4]);
        row["23. DISTRICT OF ORIGIN"] = cleanText(schemeMatch[5]);
      } else {
        row["19. SCHEME DESCRIPTION"] = cleanText(values1923);
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
      const [values2429, nextIndex] = findFirstMeaningfulLine(lines, index, [
        "1INVSN 2ITEMSN 3.HS CD",
        "GLOSSARY",
        "Scan QR Code",
      ]);
      index = nextIndex;

      const tokens = values2429
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => !(token.length === 1 && /[A-Za-z]/.test(token) && !["Y", "N"].includes(token.toUpperCase())));

      if (tokens.length) {
        row["24. PT Abroad"] = tokens[0];
        let tokenIndex = 1;

        if (tokens.length > 1) {
          let compCess = tokens[1];
          if (tokens.length > 2 && ["INR", "USD", "EUR"].includes(tokens[2])) {
            compCess = `${compCess} ${tokens[2]}`;
            tokenIndex = 3;
          } else {
            tokenIndex = 2;
          }
          row["25.COMP CESS"] = compCess;
        }

        const remaining = tokens.slice(tokenIndex);
        if (remaining.length >= 4) {
          row["26.END USE"] = remaining.slice(0, -3).join(" ");
          row["27.FTA BENEFIT AVAILED"] = remaining[remaining.length - 3];
          row["28. REWARD BENEFIT"] = remaining[remaining.length - 2];
          row["29. THIRD PARTY ITEM"] = remaining[remaining.length - 1];
        } else if (remaining.length === 3) {
          row["26.END USE"] = remaining[0];
          row["27.FTA BENEFIT AVAILED"] = remaining[1];
          row["28. REWARD BENEFIT"] = remaining[2];
        } else if (remaining.length === 2) {
          row["26.END USE"] = remaining[0];
          row["27.FTA BENEFIT AVAILED"] = remaining[1];
        } else if (remaining.length === 1) {
          row["26.END USE"] = remaining[0];
        }
      }
    }

    rows.push(row);
  }

  if (!rows.length) {
    const compact = cleanText(pageText);
    const fallbackPattern =
      /(\d+)\s+(\d+)\s+(\d{6,10})\s+(.+?)\s+([\d.,]+)\s+([A-Z]{2,5})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/g;
    let match = fallbackPattern.exec(compact);
    while (match) {
      const row = emptyRow(PART3_COLUMNS);
      row["1INVSN"] = cleanText(match[1]);
      row["2ITEMSN"] = cleanText(match[2]);
      row["3.HS CD"] = cleanText(match[3]);
      row["4.DESCRIPTION"] = cleanText(match[4]);
      row["5.QUANTITY"] = cleanText(match[5]);
      row["6UQC"] = cleanText(match[6]);
      row["7.RATE"] = cleanText(match[7]);
      row["8VALUE(F/C)"] = cleanText(match[8]);
      row["9.FOB (INR)"] = cleanText(match[9]);
      row["10.PMV"] = cleanText(match[10]);
      rows.push(row);
      match = fallbackPattern.exec(compact);
    }
  }

  return rows;
}

function parsePart4APage(pageText) {
  const lines = getCleanLines(pageText);
  const rows = [];

  let startIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes("1.INV SNO 2.ITEM SNO 3.DBK SNO.")) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) return rows;

  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("B.") || line.includes("AA / DFIA")) break;

    if (/^\d+\s+\d+/.test(line)) {
      const normalized = line.replace(/([0-9])Y([0-9])/g, "$1 $2");
      const tokens = normalized.split(/\s+/);
      if (tokens.length >= 7) {
        const row = emptyRow(PART4_A_COLUMNS);
        row["1.INV SNO"] = tokens[0] || "";
        row["2.ITEM SNO"] = tokens[1] || "";
        row["3.DBK SNO."] = tokens[2] || "";
        row["4.QTY/WT"] = tokens[3] || "";
        row["5.VALUE"] = tokens[4] || "";
        row["6.RATE"] = tokens[5] || "";
        row["7.DBK AMT"] = tokens[6] || "";
        row["8.STALEV"] = tokens[7] || "";
        row["9.CENLEV"] = tokens[8] || "";
        row["10.ROSCTL AMT"] = tokens[9] || "";
        rows.push(row);
      }
    }
  }

  if (!rows.length) {
    const compact = cleanText(pageText);
    const fallbackPattern =
      /(\d+)\s+(\d+)\s+([A-Z0-9.]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)(?:\s+([\d.,]+))?(?:\s+([\d.,]+))?(?:\s+([\d.,]+))?/g;
    let match = fallbackPattern.exec(compact);
    while (match) {
      const row = emptyRow(PART4_A_COLUMNS);
      row["1.INV SNO"] = cleanText(match[1]);
      row["2.ITEM SNO"] = cleanText(match[2]);
      row["3.DBK SNO."] = cleanText(match[3]);
      row["4.QTY/WT"] = cleanText(match[4]);
      row["5.VALUE"] = cleanText(match[5]);
      row["6.RATE"] = cleanText(match[6]);
      row["7.DBK AMT"] = cleanText(match[7]);
      row["8.STALEV"] = cleanText(match[8] || "");
      row["9.CENLEV"] = cleanText(match[9] || "");
      row["10.ROSCTL AMT"] = cleanText(match[10] || "");
      rows.push(row);
      match = fallbackPattern.exec(compact);
    }
  }

  return rows;
}

function parsePart4HPage(pageText) {
  const lines = getCleanLines(pageText);
  const rows = [];

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (
      line.includes("1.SNO") &&
      line.includes("2.INVOICE NO") &&
      line.includes("3.INVOICE AMOUNT") &&
      line.includes("4.CURRENCY")
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return rows;

  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (
      line.startsWith("I.CONTAINER") ||
      line.startsWith("Scan QR Code") ||
      line.startsWith("Page ") ||
      line.startsWith("NOITAMROFNI")
    ) {
      break;
    }
    if (/^\d+\s+/.test(line)) {
      const tokens = line.split(/\s+/);
      if (tokens.length >= 4) {
        const row = emptyRow(PART4_H_COLUMNS);
        row["1.SNO"] = tokens[0] || "";
        row["2.INVOICENO"] = tokens[1] || "";
        row["3.INVOICEAMOUNT"] = tokens[2] || "";
        row["4.CURRENCY"] = tokens[3] || "";
        rows.push(row);
      }
    }
  }

  if (!rows.length) {
    const compact = cleanText(pageText);
    const fallbackPattern = /(\d+)\s+([A-Z0-9\/-]+)\s+([\d.,]+)\s+([A-Z]{3})/g;
    let match = fallbackPattern.exec(compact);
    while (match) {
      const row = emptyRow(PART4_H_COLUMNS);
      row["1.SNO"] = cleanText(match[1]);
      row["2.INVOICENO"] = cleanText(match[2]);
      row["3.INVOICEAMOUNT"] = cleanText(match[3]);
      row["4.CURRENCY"] = cleanText(match[4]);
      rows.push(row);
      match = fallbackPattern.exec(compact);
    }
  }

  return rows;
}

function parsePart4MPage(pageText) {
  const lines = getCleanLines(pageText);
  const rows = [];

  let startIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes("M. RODTEP DETAILS")) {
      startIdx = i;
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
    if (/^\d+\s+\d+/.test(line)) {
      const tokens = line.split(/\s+/);
      if (tokens.length >= 6) {
        const row = emptyRow(PART4_M_COLUMNS);
        row["1.INVSN"] = tokens[0] || "";
        row["2.ITMSN"] = tokens[1] || "";
        row["3.QUANTITY"] = tokens[2] || "";
        row["4.UQC"] = tokens[3] || "";
        row["5.NO.OF UNITS"] = tokens[4] || "";
        row["6. VALUE"] = tokens[5] || "";
        rows.push(row);
      }
    }
    idx += 1;
  }

  if (!rows.length) {
    const compact = cleanText(pageText);
    const fallbackPattern =
      /(\d+)\s+(\d+)\s+([\d.,]+)\s+([A-Z]{2,5})\s+([\d.,]+)\s+([\d.,]+)/g;
    let match = fallbackPattern.exec(compact);
    while (match) {
      const row = emptyRow(PART4_M_COLUMNS);
      row["1.INVSN"] = cleanText(match[1]);
      row["2.ITMSN"] = cleanText(match[2]);
      row["3.QUANTITY"] = cleanText(match[3]);
      row["4.UQC"] = cleanText(match[4]);
      row["5.NO.OF UNITS"] = cleanText(match[5]);
      row["6. VALUE"] = cleanText(match[6]);
      rows.push(row);
      match = fallbackPattern.exec(compact);
    }
  }

  return rows;
}

function attachBaseFields(rows, pdfName, headerValues, columns) {
  if (!rows.length) return [];
  return rows.map((row) => {
    const merged = emptyRow([...BASE_COLUMNS, ...columns]);
    merged["source_pdf"] = pdfName;
    merged["Port Code"] = headerValues["Port Code"] || "";
    merged["SB No"] = headerValues["SB No"] || "";
    merged["SB Date"] = headerValues["SB Date"] || "";
    for (const col of columns) merged[col] = cleanText(row[col] || "");
    return merged;
  });
}

function writeRowsToSheet(sheet, rows, columns) {
  sheet.addRow(columns);
  for (const row of rows) {
    sheet.addRow(columns.map((column) => cleanText(row[column] || "")));
  }
}

async function writePdfWorkbook(pdfOutputPath, pdfName, headerValues, extracted) {
  const ExcelJSLib = getExcelJS();
  const workbook = new ExcelJSLib.Workbook();

  for (const [sheetName, sectionColumns, sectionKey] of SHEET_CONFIGS) {
    const rows = attachBaseFields(extracted[sectionKey] || [], pdfName, headerValues, sectionColumns);
    const columns = [...BASE_COLUMNS, ...sectionColumns];
    const sheet = workbook.addWorksheet(sheetName);
    writeRowsToSheet(sheet, rows, columns);
  }

  await workbook.xlsx.writeFile(pdfOutputPath);
}

function formatDuration(secondsValue) {
  const totalSeconds = Math.max(0, Math.round(Number(secondsValue) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getSheetHeaders(sheet) {
  const first = sheet.getRow(1);
  const values = first.values || [];
  return values
    .slice(1)
    .map((v) => cleanText(v))
    .filter((v, idx, arr) => !(idx >= arr.length));
}

async function ensureTrackerWorkbook(trackerPath) {
  const ExcelJSLib = getExcelJS();
  try {
    await fs.access(trackerPath);
  } catch {
    await fs.mkdir(path.dirname(trackerPath), { recursive: true });
    const workbook = new ExcelJSLib.Workbook();
    const sheet = workbook.addWorksheet("PDF_Process_Tracker");
    sheet.addRow(TRACKER_COLUMNS);
    await workbook.xlsx.writeFile(trackerPath);
  }
}

function ensureTrackerHeaders(sheet) {
  const row1 = sheet.getRow(1);
  const rowValues = row1.values ? row1.values.slice(1).map((v) => cleanText(v)) : [];
  const hasAny = rowValues.some(Boolean);

  if (!hasAny) {
    TRACKER_COLUMNS.forEach((h, i) => sheet.getCell(1, i + 1).value = h);
    return [...TRACKER_COLUMNS];
  }

  const headers = getSheetHeaders(sheet);
  if (!headers.length) {
    TRACKER_COLUMNS.forEach((h, i) => sheet.getCell(1, i + 1).value = h);
    return [...TRACKER_COLUMNS];
  }

  const missing = TRACKER_COLUMNS.filter((h) => !headers.includes(h));
  if (missing.length) {
    let col = headers.length + 1;
    for (const h of missing) {
      sheet.getCell(1, col).value = h;
      headers.push(h);
      col += 1;
    }
  }
  return headers;
}

async function getTrackerContext(trackerPath) {
  const ExcelJSLib = getExcelJS();
  await ensureTrackerWorkbook(trackerPath);
  const workbook = new ExcelJSLib.Workbook();
  await workbook.xlsx.readFile(trackerPath);
  const sheet = workbook.worksheets[0] || workbook.addWorksheet("PDF_Process_Tracker");
  const headers = ensureTrackerHeaders(sheet);
  const columnMap = {};
  headers.forEach((h, idx) => {
    if (h) columnMap[h] = idx + 1;
  });
  return { workbook, sheet, columnMap };
}

function trackerSetValues(sheet, columnMap, rowIndex, values) {
  for (const [key, value] of Object.entries(values)) {
    const col = columnMap[key];
    if (col) sheet.getCell(rowIndex, col).value = value;
  }
}

function trackerGetValue(sheet, columnMap, rowIndex, key) {
  const col = columnMap[key];
  if (!col || !rowIndex) return "";
  return cleanText(sheet.getCell(rowIndex, col).value);
}

function buildTrackerIndex(sheet, columnMap) {
  const index = {};
  const keyCol = columnMap.document_key;
  if (!keyCol) return index;

  for (let row = 2; row <= sheet.rowCount; row += 1) {
    const key = cleanText(sheet.getCell(row, keyCol).value);
    if (key) index[key] = row;
  }
  return index;
}

function upsertPdfEntriesInTracker(sheet, columnMap, trackerIndex, pdfFiles) {
  let newCount = 0;

  for (const pdfPath of pdfFiles) {
    const documentKey = path.parse(pdfPath).name;
    let rowIndex = trackerIndex[documentKey];

    if (!rowIndex) {
      rowIndex = sheet.rowCount + 1;
      trackerIndex[documentKey] = rowIndex;
      trackerSetValues(sheet, columnMap, rowIndex, {
        document_key: documentKey,
        pdf_name: path.basename(pdfPath),
        status: "NEW",
        remarks: "Discovered new PDF",
        start_time: "",
        end_time: "",
        taken_time_seconds: "",
        taken_time_hhmmss: "",
        excel_output_path: "",
        json_output_path: "",
      });
      newCount += 1;
      continue;
    }

    const currentStatus = trackerGetValue(sheet, columnMap, rowIndex, "status").toUpperCase();
    const updateValues = { pdf_name: path.basename(pdfPath) };
    if (currentStatus === "IN_PROGRESS") {
      updateValues.status = "PENDING";
      updateValues.remarks = "Previous run interrupted; moved to PENDING";
    }
    trackerSetValues(sheet, columnMap, rowIndex, updateValues);
  }

  return newCount;
}

async function extractTextByPage(pdfPath) {
  function extractWithPdfPlumber(pdfFilePath) {
    const pyCode = [
      "import json,sys",
      "import pdfplumber",
      "p = sys.argv[1]",
      "with pdfplumber.open(p) as pdf:",
      "    pages = [page.extract_text() or '' for page in pdf.pages]",
      "print(json.dumps(pages, ensure_ascii=False))",
    ].join("\n");

    const result = spawnSync("python", ["-c", pyCode, pdfFilePath], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });

    if (result.status !== 0) {
      return null;
    }

    const payload = String(result.stdout || "").trim();
    if (!payload) return null;

    try {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) {
        return parsed.map((p) => String(p || ""));
      }
    } catch {
      return null;
    }
    return null;
  }

  const pyPages = extractWithPdfPlumber(pdfPath);
  if (pyPages && pyPages.length) {
    return pyPages;
  }

  function toTextWithDetectedLines(items) {
    // First try: honor PDF end-of-line markers when present.
    let textFromEol = "";
    let eolCount = 0;
    for (const item of items) {
      const chunk = "str" in item ? String(item.str || "") : "";
      if (!chunk) continue;
      if (textFromEol && !textFromEol.endsWith("\n")) textFromEol += " ";
      textFromEol += chunk;
      if (item.hasEOL) {
        textFromEol += "\n";
        eolCount += 1;
      }
    }
    if (eolCount >= 3) return textFromEol;

    // Fallback: rebuild lines using Y coordinate groups, then X-order text.
    const positioned = [];
    for (const item of items) {
      if (!("str" in item)) continue;
      const text = String(item.str || "").trim();
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

    const mergedLines = lines.map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    );
    return mergedLines.filter(Boolean).join("\n");
  }

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = await fs.readFile(pdfPath);
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
  const pdf = await loadingTask.promise;
  const pageTexts = [];

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = toTextWithDetectedLines(content.items || []);
    pageTexts.push(text);
  }

  return pageTexts;
}

async function processPdf(pdfPath) {
  const pageTexts = await extractTextByPage(pdfPath);
  const pdfStem = path.parse(pdfPath).name;
  const headerValues = findHeaderValuesFromPages(pageTexts, pdfStem);

  const part3Rows = [];
  const part4ARows = [];
  const part4HRows = [];
  const part4MRows = [];

  for (const pageText of pageTexts) {
    if (pageText.includes("PART - III - ITEM DETAILS")) part3Rows.push(...parsePart3Page(pageText));
    if (pageText.includes("A. DRAWBACK & ROSL CLAIM")) part4ARows.push(...parsePart4APage(pageText));
    if (pageText.includes("H.INVOICE DETAILS")) part4HRows.push(...parsePart4HPage(pageText));
    if (pageText.includes("M. RODTEP DETAILS")) part4MRows.push(...parsePart4MPage(pageText));
  }

  return {
    header: headerValues,
    part3_item_details: part3Rows,
    part4_a_drawback_rosl_claim: part4ARows,
    part4_h_invoice_details: part4HRows,
    part4_m_rodtep_details: part4MRows,
  };
}

function nowTimestamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

async function processAll(rootFolder, limit = null) {
  const inputDir = path.join(rootFolder, "IN");
  const outputDir = path.join(rootFolder, "OUT");
  const statusDir = path.join(rootFolder, "STATUS");
  const trackerPath = path.join(statusDir, "PDF_Process_Tracker.xlsx");

  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(statusDir, { recursive: true });

  const jsonDir = path.join(outputDir, "JSON");
  const excelDir = path.join(outputDir, "EXCEL");
  await fs.mkdir(jsonDir, { recursive: true });
  await fs.mkdir(excelDir, { recursive: true });

  const dirEntries = await fs.readdir(inputDir, { withFileTypes: true });
  let pdfFiles = dirEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => path.join(inputDir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  if (limit !== null && limit !== undefined) pdfFiles = pdfFiles.slice(0, limit);

  const { workbook: trackerWorkbook, sheet: trackerSheet, columnMap: trackerColumns } = await getTrackerContext(trackerPath);
  const trackerIndex = buildTrackerIndex(trackerSheet, trackerColumns);
  const newCount = upsertPdfEntriesInTracker(trackerSheet, trackerColumns, trackerIndex, pdfFiles);
  await trackerWorkbook.xlsx.writeFile(trackerPath);

  if (!pdfFiles.length) {
    console.log(`No PDFs found in: ${inputDir}`);
    console.log(`Tracker updated: ${trackerPath}`);
    return;
  }

  const processingQueue = [];
  let skippedCount = 0;
  for (const pdfPath of pdfFiles) {
    const rowIndex = trackerIndex[path.parse(pdfPath).name];
    const status = trackerGetValue(trackerSheet, trackerColumns, rowIndex, "status").toUpperCase();
    if (status === "NEW" || status === "PENDING") {
      processingQueue.push(pdfPath);
    } else {
      skippedCount += 1;
    }
  }

  if (!processingQueue.length) {
    console.log("No NEW/PENDING PDFs to process. Set tracker status to PENDING if you want reprocessing.");
    console.log(`Tracker updated: ${trackerPath}`);
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < processingQueue.length; i += 1) {
    const pdfPath = processingQueue[i];
    console.log(`[${i + 1}/${processingQueue.length}] Processing: ${path.basename(pdfPath)}`);
    const rowIndex = trackerIndex[path.parse(pdfPath).name];
    const startMs = Date.now();
    const startStamp = nowTimestamp();

    let status = "FAILED";
    let remarks = "";
    const pdfStem = path.parse(pdfPath).name;
    const excelPath = path.join(excelDir, `${pdfStem}.xlsx`);
    const jsonPath = path.join(jsonDir, `${pdfStem}.json`);
    let excelWritten = false;
    let jsonWritten = false;

    trackerSetValues(trackerSheet, trackerColumns, rowIndex, {
      pdf_name: path.basename(pdfPath),
      status: "IN_PROGRESS",
      start_time: startStamp,
      end_time: "",
      taken_time_seconds: "",
      taken_time_hhmmss: "",
      remarks: "Processing started",
      excel_output_path: "",
      json_output_path: "",
    });
    await trackerWorkbook.xlsx.writeFile(trackerPath);

    try {
      const extracted = await processPdf(pdfPath);
      await writePdfWorkbook(excelPath, path.basename(pdfPath), extracted.header, extracted);
      excelWritten = true;

      const jsonOutput = {
        source_pdf: path.basename(pdfPath),
        "Port Code": extracted.header["Port Code"] || "",
        "SB No": extracted.header["SB No"] || "",
        "SB Date": extracted.header["SB Date"] || "",
        part3_item_details: extracted.part3_item_details,
        part4_a_drawback_rosl_claim: extracted.part4_a_drawback_rosl_claim,
        part4_h_invoice_details: extracted.part4_h_invoice_details,
        part4_m_rodtep_details: extracted.part4_m_rodtep_details,
      };
      await fs.writeFile(jsonPath, JSON.stringify(jsonOutput, null, 2), "utf8");
      jsonWritten = true;

      status = "SUCCESS";
      remarks = "Processed successfully";
      successCount += 1;
    } catch (err) {
      status = "FAILED";
      remarks = err instanceof Error ? err.message : String(err);
      failureCount += 1;
      console.log(`  FAILED: ${remarks}`);
    } finally {
      const endMs = Date.now();
      const durationSeconds = (endMs - startMs) / 1000;
      trackerSetValues(trackerSheet, trackerColumns, rowIndex, {
        pdf_name: path.basename(pdfPath),
        status,
        start_time: startStamp,
        end_time: nowTimestamp(),
        taken_time_seconds: Math.round(durationSeconds * 100) / 100,
        taken_time_hhmmss: formatDuration(durationSeconds),
        remarks,
        excel_output_path: excelWritten ? excelPath : "",
        json_output_path: jsonWritten ? jsonPath : "",
      });
      await trackerWorkbook.xlsx.writeFile(trackerPath);
    }
  }

  console.log(
    `\nCompleted. Total IN PDFs: ${pdfFiles.length}, New discovered: ${newCount}, ` +
      `Skipped (not NEW/PENDING): ${skippedCount}, Processed: ${processingQueue.length}, ` +
      `Success: ${successCount}, Failed: ${failureCount}`
  );
  console.log(`Root folder: ${rootFolder}`);
  console.log(`Input folder: ${inputDir}`);
  console.log(`Output folder: ${outputDir}`);
  console.log(`Excel folder: ${excelDir}`);
  console.log(`JSON folder: ${jsonDir}`);
  console.log(`Tracker: ${trackerPath}`);
}

async function main() {
  await processAll(ROOT_FOLDER);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  processPdf,
  processAll,
};

