const crypto = require("node:crypto");
const os = require("node:os");
const fs = require("node:fs/promises");
const path = require("node:path");
const Tesseract = require("tesseract.js");
const { Builder, By, until, Key } = require("selenium-webdriver");
const { putObject, getDefaultBucket, isS3Configured } = require("#utils/s3Upload");
const {
  buildChromeOptions,
  waitForCaptchaElement,
  screenshotCaptcha,
} = require("./dgftCaptcha");

const DGFT_LOGIN_URL = "https://www.dgft.gov.in/CP/?opt=view-any-ice";
const DEFAULT_GRID_URL = process.env.SELENIUM_GRID_URL || "http://localhost:4444/wd/hub";

const MS = {
  PAGE_LOAD: 30_000,
  WAIT: 12_000,
  SMALL: 300,
  MEDIUM: 900,
  PDF_WINDOW_WAIT: 10_000,
};

const DEFAULT_DGFT_MAX_LOGIN_RETRIES = 8;
const DGFT_MAX_LOGIN_RETRIES_CAP = 100;

/** Body/query override, else `process.env.DGFT_MAX_LOGIN_RETRIES`, else default. */
function getDgftMaxLoginRetries(override) {
  if (override !== undefined && override !== null && String(override).trim() !== "") {
    const n = Number(override);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(Math.floor(n), DGFT_MAX_LOGIN_RETRIES_CAP);
    }
  }
  const fromEnv = Number(process.env.DGFT_MAX_LOGIN_RETRIES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.min(Math.floor(fromEnv), DGFT_MAX_LOGIN_RETRIES_CAP);
  }
  return DEFAULT_DGFT_MAX_LOGIN_RETRIES;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeText(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

function toDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeInputRow(row = {}) {
  const out = {
    port: safeText(row.port || row.sbLocation || row.portCode),
    sbNumber: safeText(row.sbNumber || row.sbNo),
    sbDate: safeText(row.sbDate),
  };
  const regId = row.shippingBillNoId ?? row.shippingBillNo;
  if (regId != null && String(regId).trim() !== "") {
    out.shippingBillNoId = String(regId).trim();
  }
  return out;
}

function toXPathLiteral(value) {
  const s = String(value ?? "");
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  return `concat('${s.replace(/'/g, `', "'", '`)}')`;
}

function safeBrFileName(brNumber) {
  return String(brNumber || "brc")
    .trim()
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

async function waitForNonBlankWindowUrl(driver, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let url = "";
    try {
      url = await driver.getCurrentUrl();
    } catch {
      await sleep(200);
      continue;
    }
    if (url && url !== "about:blank" && !url.startsWith("chrome://")) return url;
    await sleep(200);
  }
  try {
    return await driver.getCurrentUrl();
  } catch {
    return "";
  }
}

/**
 * Clicks Print on BRC detail; reads PDF bytes from new tab (blob: or direct PDF URL).
 * Grid-safe; no disk write.
 */
async function fetchBrcPdfBufferFromPrint(driver, brNumber) {
  const mainHandle = await driver.getWindowHandle();
  const handlesBefore = new Set(await driver.getAllWindowHandles());

  let printBtn;
  try {
    printBtn = await driver.wait(until.elementLocated(By.id("printBtn")), MS.WAIT);
    await driver.wait(until.elementIsVisible(printBtn), MS.WAIT);
  } catch {
    return { saved: false, reason: "print_button_not_found" };
  }

  await driver.executeScript("arguments[0].scrollIntoView({block:'center'})", printBtn);
  try {
    await printBtn.click();
  } catch {
    await driver.executeScript("arguments[0].click()", printBtn);
  }
  await sleep(900);

  const handlesAfter = await driver.getAllWindowHandles();
  const newHandle = handlesAfter.find((h) => !handlesBefore.has(h));
  if (!newHandle) {
    return { saved: false, reason: "no_new_window_after_print" };
  }

  await driver.switchTo().window(newHandle);
  await sleep(400);
  const currentUrl = await waitForNonBlankWindowUrl(driver, MS.PDF_WINDOW_WAIT);

  let base64Payload = null;
  try {
    if (currentUrl.startsWith("blob:")) {
      base64Payload = await driver.executeAsyncScript(
        `
        const url = arguments[0];
        const done = arguments[arguments.length - 1];
        fetch(url)
          .then((r) => r.blob())
          .then((blob) => {
            const reader = new FileReader();
            reader.onloadend = function () {
              const data = reader.result || "";
              const i = String(data).indexOf(",");
              done(i >= 0 ? String(data).slice(i + 1) : null);
            };
            reader.onerror = function () { done(null); };
            reader.readAsDataURL(blob);
          })
          .catch(function () { done(null); });
      `,
        currentUrl
      );
    } else {
      const isPdfLike =
        currentUrl.toLowerCase().includes(".pdf") ||
        (await driver.executeScript("return document.contentType || ''")).toLowerCase().includes("pdf");
      if (isPdfLike) {
        base64Payload = await driver.executeAsyncScript(`
          const done = arguments[arguments.length - 1];
          fetch(window.location.href)
            .then((r) => r.blob())
            .then((blob) => {
              const reader = new FileReader();
              reader.onloadend = function () {
                const data = reader.result || "";
                const i = String(data).indexOf(",");
                done(i >= 0 ? String(data).slice(i + 1) : null);
              };
              reader.onerror = function () { done(null); };
              reader.readAsDataURL(blob);
            })
            .catch(function () { done(null); });
        `);
      }
    }
  } catch {
    base64Payload = null;
  }

  try {
    await driver.close();
  } catch {
    // ignore
  }
  await driver.switchTo().window(mainHandle);
  await sleep(MS.SMALL);

  if (!base64Payload || typeof base64Payload !== "string") {
    return { saved: false, reason: "could_not_read_pdf_bytes" };
  }

  let pdfBuffer;
  try {
    pdfBuffer = Buffer.from(base64Payload, "base64");
  } catch {
    return { saved: false, reason: "invalid_pdf_base64" };
  }
  if (!pdfBuffer.length) {
    return { saved: false, reason: "empty_pdf" };
  }

  console.log(`[dgft] PDF bytes captured for BRC ${safeText(brNumber)}`);
  return { saved: true, buffer: pdfBuffer };
}

/**
 * Local PDF write (legacy / dev). Prefer S3 upload when companyId + bucket configured.
 */
async function saveBrcPdfViaPrint(driver, brNumber, pdfDir) {
  const pr = await fetchBrcPdfBufferFromPrint(driver, brNumber);
  if (!pr.saved) return pr;
  await ensureDir(pdfDir);
  const baseName = `${safeBrFileName(brNumber)}.pdf`;
  let outPath = path.join(pdfDir, baseName);
  try {
    await fs.access(outPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    outPath = path.join(pdfDir, `${safeBrFileName(brNumber)}_${stamp}.pdf`);
  } catch {
    // file does not exist
  }
  await fs.writeFile(outPath, pr.buffer);
  console.log(`[dgft] PDF saved (local): ${outPath}`);
  return { saved: true, pdfPath: outPath };
}

function normalizeCaptchaText(rawText) {
  return String(rawText || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .trim();
}

async function runNodeCaptcha(pngBuffer) {
  const result = await Tesseract.recognize(pngBuffer, "eng", {
    logger: () => {},
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_WORD,
    tessedit_char_whitelist:
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  });
  return normalizeCaptchaText(result?.data?.text || "");
}

async function createDriver(gridUrl = DEFAULT_GRID_URL) {
  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(buildChromeOptions())
    .usingServer(gridUrl)
    .build();
  await driver.manage().setTimeouts({
    pageLoad: MS.PAGE_LOAD,
    implicit: 1_500,
    script: 20_000,
  });
  return driver;
}

async function selectBankRealisations(driver) {
  const dropdown = await driver.wait(until.elementLocated(By.id("txt_selectBill")), MS.WAIT);
  await driver.executeScript(
    `
    const sel = arguments[0];
    const opts = Array.from(sel.options || []);
    const idx = opts.findIndex(o =>
      (o.textContent || "").toLowerCase().includes("bank realisations")
    );
    if (idx >= 0) {
      sel.selectedIndex = idx;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  `,
    dropdown
  );
  await sleep(MS.MEDIUM);
}

async function navigateToBillsRepository(driver) {
  const dashboard = await driver.wait(
    until.elementLocated(
      By.xpath("//a[contains(@class,'dropdown-toggle') and contains(.,'My Dashboard')]")
    ),
    MS.WAIT
  );
  await driver.executeScript("arguments[0].click()", dashboard);

  const repositories = await driver.wait(
    until.elementLocated(By.xpath("//a[contains(.,'Repositories')]")),
    MS.WAIT
  );
  await driver.executeScript("arguments[0].click()", repositories);
  await sleep(MS.MEDIUM);

  const billsRepo = await driver.wait(
    until.elementLocated(By.xpath("//a[contains(@onclick,'billRepository')]")),
    MS.WAIT
  );
  await driver.executeScript("arguments[0].click()", billsRepo);
  await sleep(MS.MEDIUM);

  await selectBankRealisations(driver);
}

async function solveCaptchaFromElement(driver, outputDir, attemptNo) {
  const captchaEl = await waitForCaptchaElement(driver);
  const captchaBuffer = await screenshotCaptcha(driver, captchaEl);
  const filePath = path.join(outputDir, `captcha-attempt-${attemptNo}.png`);
  await fs.writeFile(filePath, captchaBuffer);
  const text = await runNodeCaptcha(captchaBuffer);
  return { text, filePath };
}

async function hasVisibleElement(driver, selectorOrXpath, isXpath = false) {
  const nodes = await driver.findElements(isXpath ? By.xpath(selectorOrXpath) : By.css(selectorOrXpath));
  for (const node of nodes) {
    try {
      if (await node.isDisplayed()) return true;
    } catch {
      // ignore stale elements
    }
  }
  return false;
}

async function dismissPasswordResetPageIfPresent(driver) {
  const closeButtons = await driver.findElements(By.id("back"));
  if (!closeButtons.length) return false;

  for (const btn of closeButtons) {
    try {
      if (!(await btn.isDisplayed())) continue;
      await driver.executeScript("arguments[0].click()", btn);
      await sleep(MS.MEDIUM);
      return true;
    } catch {
      // ignore stale/hidden elements and try next match
    }
  }
  return false;
}

async function loginToDgft(driver, { username, password, maxRetries = 8, outputDir }) {
  await driver.get(DGFT_LOGIN_URL);
  await sleep(MS.MEDIUM);

  const openLogin = await driver.wait(until.elementLocated(By.id("skip")), MS.WAIT);
  await driver.executeScript("arguments[0].click()", openLogin);
  await sleep(MS.MEDIUM);

  const userEl = await driver.wait(until.elementLocated(By.id("username")), MS.WAIT);
  await driver.wait(until.elementIsVisible(userEl), MS.WAIT);
  const passEl = await driver.wait(until.elementLocated(By.id("password")), MS.WAIT);
  await userEl.clear();
  await userEl.sendKeys(username);
  await passEl.clear();
  await passEl.sendKeys(password);
  await waitForCaptchaElement(driver);

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const { text: captchaText } = await solveCaptchaFromElement(driver, outputDir, attempt);
    if (!captchaText || captchaText.length < 4) {
      const captchaImage = await waitForCaptchaElement(driver);
      await driver.executeScript("arguments[0].click()", captchaImage);
      await sleep(MS.SMALL);
      continue;
    }

    const captchaInput = await driver.findElement(By.id("txt_Captcha"));
    await captchaInput.clear();
    await captchaInput.sendKeys(captchaText);

    const submitBtn = await driver.findElement(By.xpath("//button[@onclick='fn_JLoginSubmit()']"));
    await driver.executeScript("arguments[0].click()", submitBtn);
    await sleep(1_500);

    const invalidCred = await hasVisibleElement(driver, "#incMainLogin");
    if (invalidCred) {
      throw new Error("DGFT login failed: invalid username or password");
    }

    const captchaError = await hasVisibleElement(driver, "#incCaptcha");
    if (captchaError) {
      const captchaImage = await waitForCaptchaElement(driver);
      await driver.executeScript("arguments[0].click()", captchaImage);
      await sleep(MS.SMALL);
      continue;
    }

    const loggedIn = await hasVisibleElement(
      driver,
      "//a[contains(@class,'dropdown-toggle') and contains(.,'My Dashboard')]",
      true
    );
    if (loggedIn) return true;

    // Some accounts are redirected to a password-reset screen after login.
    // Close it via button id="back" and continue to the main page.
    const closedResetPage = await dismissPasswordResetPageIfPresent(driver);
    if (closedResetPage) {
      const loggedInAfterClose = await hasVisibleElement(
        driver,
        "//a[contains(@class,'dropdown-toggle') and contains(.,'My Dashboard')]",
        true
      );
      if (loggedInAfterClose) return true;
    }
  }

  throw new Error(`DGFT login failed after ${maxRetries} attempts`);
}

/**
 * Opens DGFT, solves captcha, and checks that user id + password work (no repository scrape).
 */
async function verifyDgftLogin(options = {}) {
  const {
    username = "",
    password = "",
    maxLoginRetries: maxLoginRetriesRaw,
    seleniumGridUrl = DEFAULT_GRID_URL,
  } = options;

  const maxLoginRetries = getDgftMaxLoginRetries(maxLoginRetriesRaw);

  const user = String(username ?? "").trim();
  const pass = String(password ?? "");
  if (!user || !pass) {
    throw new Error("DGFT user id and password are required.");
  }

  const captchaTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dgft-captcha-"));
  const driver = await createDriver(seleniumGridUrl);
  try {
    await loginToDgft(driver, {
      username: user,
      password: pass,
      maxRetries: maxLoginRetries,
      outputDir: captchaTempDir,
    });
    return { ok: true };
  } finally {
    try {
      await driver.quit();
    } catch {
      // ignore
    }
    await fs.rm(captchaTempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function fillSearchForm(driver, input) {
  await selectBankRealisations(driver);

  const sbNumberInput = await driver.wait(until.elementLocated(By.id("sbNumber")), MS.WAIT);
  await sbNumberInput.clear();
  await sbNumberInput.sendKeys(input.sbNumber);

  const sbDateInput = await driver.wait(until.elementLocated(By.id("sbDate")), MS.WAIT);
  await sbDateInput.clear();
  await sbDateInput.sendKeys(input.sbDate);

  const chosen = await driver.wait(until.elementLocated(By.id("exportPortCode_chosen")), MS.WAIT);
  const chosenOpen = await chosen.findElement(By.css("a.chosen-single"));
  await driver.executeScript("arguments[0].click()", chosenOpen);
  const searchInput = await chosen.findElement(By.css("input.chosen-search-input"));
  await searchInput.clear();
  await searchInput.sendKeys(input.port);
  await sleep(MS.SMALL);
  await searchInput.sendKeys(Key.RETURN);
}

async function extractSearchTableRows(driver) {
  await driver.wait(until.elementLocated(By.id("eBRCTable")), MS.WAIT);
  await sleep(MS.MEDIUM);

  return driver.executeScript(`
    const table = document.getElementById("eBRCTable");
    if (!table) return { noData: true, rows: [] };
    const noDataTd = table.querySelector("tbody td");
    if (noDataTd && /no data available/i.test((noDataTd.textContent || "").trim())) {
      return { noData: true, rows: [] };
    }
    const headers = Array.from(table.querySelectorAll("thead th")).map(th =>
      (th.textContent || "").replace(/\\s+/g, " ").trim()
    );
    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    const rows = bodyRows.map(tr => {
      const tds = Array.from(tr.querySelectorAll("td"));
      const row = {};
      tds.forEach((td, idx) => {
        const key = headers[idx] || ("col_" + (idx + 1));
        row[key] = (td.textContent || "").replace(/\\s+/g, " ").trim();
      });
      const link = tr.querySelector("a");
      row.__brNumber = link ? (link.textContent || "").replace(/\\s+/g, " ").trim() : "";
      return row;
    });
    return { noData: rows.length === 0, rows };
  `);
}

async function copyPdfToFlatFolder(srcPath, flatPdfDir) {
  if (!flatPdfDir || !srcPath) return null;
  await ensureDir(flatPdfDir);
  const baseName = path.basename(srcPath);
  let destPath = path.join(flatPdfDir, baseName);
  try {
    await fs.access(destPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { name, ext } = path.parse(baseName);
    destPath = path.join(flatPdfDir, `${name}_${stamp}${ext || ".pdf"}`);
  } catch {
    // dest does not exist
  }
  await fs.copyFile(srcPath, destPath);
  console.log(`[dgft] PDF mirrored to: ${destPath}`);
  return destPath;
}

async function extractBrcDetailForm(driver, brNumber, options = {}) {
  const { pdfDir = null, flatPdfDir = null, s3Upload = null, savePdf = false } = options;
  const brLiteral = toXPathLiteral(brNumber);
  const link = await driver.wait(
    until.elementLocated(
      By.xpath(
        `//a[contains(@href,'getBankRealisationData') and contains(normalize-space(.), ${brLiteral})]`
      )
    ),
    MS.WAIT
  );
  await driver.executeScript("arguments[0].click()", link);
  await driver.wait(until.elementLocated(By.id("eBrcForm")), MS.WAIT);
  await sleep(MS.SMALL);

  const details = await driver.executeScript(`
    const form = document.getElementById("eBrcForm") || document;
    const out = {};
    const els = form.querySelectorAll("input, select, textarea");
    for (const el of els) {
      const type = (el.type || "").toLowerCase();
      if (type === "hidden") continue;
      const id = el.id || "";
      const name = el.name || "";
      let key = id || name || "";
      if (!key) continue;
      key = key.trim();
      let value = "";
      if (el.tagName === "SELECT") {
        const opt = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
        value = (opt ? opt.textContent : el.value || "").trim();
      } else {
        value = (el.value || "").trim();
      }
      out[key] = value;
    }
    return out;
  `);

  let pdfPath = null;
  let pdfS3Key = null;
  let pdfUrl = null;
  let pdfError = null;
  if (savePdf && s3Upload?.putPdf) {
    try {
      const pr = await fetchBrcPdfBufferFromPrint(driver, brNumber);
      if (pr.saved) {
        const fileName = `${safeBrFileName(brNumber)}.pdf`;
        const up = await s3Upload.putPdf(pr.buffer, fileName);
        pdfS3Key = up.key;
        pdfUrl = up.url;
        console.log(`[dgft] PDF uploaded to S3: ${pdfS3Key}`);
      } else {
        pdfError = pr.reason || "pdf_save_failed";
        console.warn(`[dgft] PDF not uploaded for BRC ${brNumber}: ${pdfError}`);
      }
    } catch (err) {
      pdfError = err instanceof Error ? err.message : String(err);
      console.warn(`[dgft] PDF S3 error for BRC ${brNumber}:`, pdfError);
    }
  } else if (savePdf && pdfDir) {
    try {
      const pr = await saveBrcPdfViaPrint(driver, brNumber, pdfDir);
      if (pr.saved) {
        pdfPath = pr.pdfPath;
        if (flatPdfDir) {
          try {
            await copyPdfToFlatFolder(pr.pdfPath, flatPdfDir);
          } catch (copyErr) {
            console.warn(
              "[dgft] PDF mirror failed:",
              copyErr instanceof Error ? copyErr.message : String(copyErr)
            );
          }
        }
      } else {
        pdfError = pr.reason || "pdf_save_failed";
        console.warn(`[dgft] PDF not saved for BRC ${brNumber}: ${pdfError}`);
      }
    } catch (err) {
      pdfError = err instanceof Error ? err.message : String(err);
      console.warn(`[dgft] PDF save error for BRC ${brNumber}:`, pdfError);
    }
  }

  const backBtn = await driver.findElement(
    By.xpath("//button[contains(.,'Back To Search Result') or contains(@onclick,'hideView')]")
  );
  await driver.executeScript("arguments[0].click()", backBtn);
  await sleep(MS.SMALL);
  return {
    ...details,
    ...(pdfPath ? { pdfPath } : {}),
    ...(pdfS3Key ? { pdfS3Key } : {}),
    ...(pdfUrl ? { pdfUrl } : {}),
    ...(pdfError ? { pdfError } : {}),
  };
}

function mergeTableRowsWithBrcDetails(tableRowsRaw, details) {
  const byBr = new Map();
  for (const d of details) {
    const key = safeText(d.brNumber);
    if (key) byBr.set(key, d);
  }

  return tableRowsRaw.map((row) => {
    const br = safeText(row.__brNumber || row["Bank Realisation Number"]);
    const copy = { ...row };
    delete copy.__brNumber;
    const detail = br ? byBr.get(br) : null;
    return {
      ...copy,
      /** One search row ↔ one BRC detail object (not an array). */
      brcDetail: detail ?? null,
    };
  });
}

async function processOneInput(driver, input, { pdfDir = null, flatPdfDir = null, s3Upload = null, savePdf = true } = {}) {
  await fillSearchForm(driver, input);
  const searchBtn = await driver.wait(until.elementLocated(By.id("repSearchBtn")), MS.WAIT);
  await driver.executeScript("arguments[0].click()", searchBtn);

  const table = await extractSearchTableRows(driver);
  if (table.noData) {
    return { status: "no_data", input, tableRows: [] };
  }

  const pdfOpts = {
    pdfDir,
    flatPdfDir,
    s3Upload,
    savePdf: Boolean(savePdf && (pdfDir || s3Upload?.putPdf)),
  };
  const details = [];
  for (const row of table.rows) {
    const br = safeText(row.__brNumber);
    if (!br) continue;
    try {
      const formData = await extractBrcDetailForm(driver, br, pdfOpts);
      details.push({ brNumber: br, ...formData });
    } catch (error) {
      details.push({
        brNumber: br,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const resetBtn = await driver.findElements(By.id("resetBtn"));
  if (resetBtn.length) {
    await driver.executeScript("arguments[0].click()", resetBtn[0]);
    await sleep(MS.MEDIUM);
  }

  return {
    status: "success",
    input,
    tableRows: mergeTableRowsWithBrcDetails(table.rows, details),
  };
}

async function runDgftScrapeBatch(options = {}) {
  const {
    inputs = [],
    companyId = null,
    username = process.env.DGFT_USERNAME || "",
    password = process.env.DGFT_PASSWORD || "",
    maxLoginRetries: maxLoginRetriesRaw,
    outputRoot = path.resolve(process.cwd(), "dgft_output"),
    seleniumGridUrl = DEFAULT_GRID_URL,
    savePdf = process.env.DGFT_SAVE_PDF !== "false",
    pdfOutputFolder: pdfOutputFolderOption = null,
    /** If true (default when companyId set), do not write dgft_output JSON/PDF; use S3 + Mongo only. */
    cloudOnly = Boolean(companyId),
    /**
     * Called after each input is processed (before driver quit). Use to persist one row at a time.
     * @param {object} rowResult — { status, input, tableRows?, errorMessage? }
     * @param {number} inputIndex — 0-based index in this batch
     * @param {object} meta — { batchId, dayKey, s3Bucket, s3PdfKeyPrefix, outputDir, pdfDir, resultJsonPath }
     */
    onEachResult = null,
  } = options;

  const maxLoginRetries = getDgftMaxLoginRetries(maxLoginRetriesRaw);

  const companyIdStr = companyId != null ? String(companyId).trim() : "";

  /** Legacy: optional flat local folder when not cloudOnly. */
  const pdfFlatRoot =
    !cloudOnly &&
    ((pdfOutputFolderOption != null && String(pdfOutputFolderOption).trim()
      ? path.resolve(process.cwd(), String(pdfOutputFolderOption).trim())
      : null) ||
      (process.env.DGFT_PDF_OUTPUT_FOLDER && String(process.env.DGFT_PDF_OUTPUT_FOLDER).trim()
        ? path.resolve(process.cwd(), String(process.env.DGFT_PDF_OUTPUT_FOLDER).trim())
        : null));

  if (!username || !password) {
    throw new Error("DGFT credentials are required (body username/password or env DGFT_USERNAME/DGFT_PASSWORD).");
  }

  const normalizedInputs = Array.isArray(inputs)
    ? inputs.map(normalizeInputRow).filter((x) => x.port && x.sbNumber && x.sbDate)
    : [];
  if (!normalizedInputs.length) {
    throw new Error("At least one valid input row is required: { port, sbNumber, sbDate }.");
  }

  if (cloudOnly && savePdf && !isS3Configured()) {
    throw new Error(
      "PDF upload requires S3: set BUCKET_NAME (or AWS_S3_BUCKET), ACCESS_KEY, SECRET_KEY, and AWS_REGION if needed."
    );
  }

  const batchId = crypto.randomUUID();
  const dayKey = toDayKey();
  const bucket = getDefaultBucket();
  /** S3 object key: `{companyId}/{fileName}` → public URL `{AWS_S3_PUBLIC_URL_BASE}/{companyId}/file.pdf` */
  const s3PdfKeyPrefix = companyIdStr ? companyIdStr.replace(/\/+/g, "").trim() : "";

  let batchDir = null;
  let pdfDir = null;
  let flatPdfDir = null;
  let captchaTempDir = null;

  if (cloudOnly) {
    captchaTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dgft-captcha-"));
  } else {
    batchDir = await ensureDir(path.join(outputRoot, `batch-${batchId}`));
    pdfDir = savePdf ? await ensureDir(path.join(batchDir, "pdfs")) : null;
    flatPdfDir = savePdf && pdfFlatRoot ? await ensureDir(pdfFlatRoot) : null;
    captchaTempDir = batchDir;
    await fs.writeFile(
      path.join(batchDir, "input.json"),
      JSON.stringify({ batchId, inputs: normalizedInputs, savePdf }, null, 2)
    );
  }

  const s3Upload =
    cloudOnly && savePdf && companyIdStr && isS3Configured()
      ? {
          async putPdf(buffer, fileName) {
            const safeName = String(fileName || "brc.pdf").replace(/^\//, "");
            const key = `${s3PdfKeyPrefix}/${safeName}`.replace(/\/+/g, "/").replace(/^\/+/, "");
            return putObject({
              bucket,
              key,
              body: buffer,
              contentType: "application/pdf",
            });
          },
        }
      : null;

  const persistMeta = {
    batchId,
    dayKey,
    s3Bucket: cloudOnly && savePdf ? bucket : "",
    s3PdfKeyPrefix: cloudOnly && savePdf ? s3PdfKeyPrefix : "",
    outputDir: batchDir || "",
    pdfDir: pdfDir || "",
    resultJsonPath: "",
  };

  const driver = await createDriver(seleniumGridUrl);
  const results = [];
  try {
    await loginToDgft(driver, {
      username,
      password,
      maxRetries: maxLoginRetries,
      outputDir: captchaTempDir,
    });
    await navigateToBillsRepository(driver);

    const onRow = typeof onEachResult === "function" ? onEachResult : null;

    for (let i = 0; i < normalizedInputs.length; i += 1) {
      const input = normalizedInputs[i];
      let rowResult;
      try {
        rowResult = await processOneInput(driver, input, {
          pdfDir,
          flatPdfDir,
          s3Upload,
          savePdf,
        });
      } catch (error) {
        rowResult = {
          status: "error",
          input,
          errorMessage: error instanceof Error ? error.message : String(error),
          tableRows: [],
        };
      }
      results.push(rowResult);
      if (onRow) {
        await onRow(rowResult, i, persistMeta);
      }
    }
  } finally {
    try {
      await driver.quit();
    } catch {
      // ignore driver quit errors
    }
    if (cloudOnly && captchaTempDir) {
      await fs.rm(captchaTempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const payload = {
    batchId,
    companyId: companyIdStr || null,
    dayKey,
    generatedAt: new Date().toISOString(),
    savePdf,
    s3Bucket: cloudOnly && savePdf ? bucket : "",
    s3PdfKeyPrefix: cloudOnly && savePdf ? s3PdfKeyPrefix : "",
    outputDir: batchDir || "",
    pdfDir: pdfDir || "",
    flatPdfDir: flatPdfDir || "",
    total: normalizedInputs.length,
    successCount: results.filter((r) => r.status === "success").length,
    noDataCount: results.filter((r) => r.status === "no_data").length,
    errorCount: results.filter((r) => r.status === "error").length,
    results,
  };

  if (!cloudOnly && batchDir) {
    const resultJsonPath = path.join(batchDir, "result.json");
    await fs.writeFile(resultJsonPath, JSON.stringify(payload, null, 2));
    return { ...payload, resultJsonPath };
  }

  return { ...payload, resultJsonPath: "" };
}

module.exports = {
  runDgftScrapeBatch,
  verifyDgftLogin,
  getDgftMaxLoginRetries,
  saveBrcPdfViaPrint,
  fetchBrcPdfBufferFromPrint,
};
