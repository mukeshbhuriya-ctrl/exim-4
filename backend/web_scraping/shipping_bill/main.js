/**
 * ICEGATE shipping bill scraper — basic flow: port, SB no, date, Search.
 * Change every delay/timeout in MS below (one place).
 */
const { Builder, By, Key, until } = require("selenium-webdriver");

// ---------------------------------------------------------------------------
// All timings in milliseconds — edit here only
// ---------------------------------------------------------------------------
const MS = {
  // WebDriver (lower IMPLICIT_WAIT_EXTRACT during 4-tab read so each findElement does not stall ~12s)
  IMPLICIT_WAIT: 8_000,
  IMPLICIT_WAIT_EXTRACT: 800,
  PAGE_LOAD: 4000,

  // Navigation
  AFTER_NAVIGATE: 400,

  // Wait for main form
  WAIT_FORM_LOCATION_SELECT: 25_000,
  WAIT_FORM_SB_INPUT: 25_000,
  WAIT_SB_FIELD_CLEAR: 10_000,

  // Location ng-select
  LOCATION_SELECT_LOCATED: 20_000,
  LOCATION_INPUT_LOCATED: 8_000,
  LOCATION_INPUT_LOCATED_FALLBACK: 6_000,
  LOC_AFTER_OPEN: 150,
  LOC_AFTER_TYPE_CLEAR: 200,
  LOC_AFTER_ENTER: 500,
  LOC_AFTER_ARROW_ENTER: 350,
  LOC_FALLBACK_OPEN: 150,
  LOC_FALLBACK_TYPE: 250,
  NG_OPTION_PANEL_WAIT: 8_000,
  LOC_AFTER_OPTION_CLICK: 350,

  // Date field
  DATE_INPUT_LOCATED: 15_000,
  AFTER_DATE_INPUT: 250,

  // Retries / refresh
  REFRESH_SLEEP: 500,
  RETRY_SLEEP: 600,

  // After Search — detect results or no-record
  SEARCH_OUTCOME_MAX: 10_000,
  SEARCH_OUTCOME_POLL: 60,
  AFTER_RESULTS_SETTLE: 30,

  // Bulk worker retry backoff: min(MS.DISTRIBUTED_RETRY_CAP, MS.DISTRIBUTED_RETRY_BASE * attempt)
  DISTRIBUTED_RETRY_BASE: 800,
  DISTRIBUTED_RETRY_CAP: 4_000,

  // Four tabs — avoid long double-overlay waits (was ~6s+ per tab). One short overlay poll + JS click.
  TAB_INITIAL_WAIT: 2_500,
  TAB_SWITCH_VISIBLE_MS: 1_000,
  TAB_ROW_WAIT_MS: 1_000,
  TAB_OVERLAY_QUICK: 450,
  TAB_OVERLAY_QUICK_MIN: 100,
  TAB_AFTER_JS_CLICK: 35,
  DRAWBACK_OVERLAY_QUICK: 450,
  DRAWBACK_OVERLAY_QUICK_MIN: 100,
  SAFE_CLICK_SCROLL_MS: 50,
};

const TARGET_URL =
  "https://foservices.icegate.gov.in/#/public-enquiries/document-status/ds-shipping-bill";
const DEFAULT_GRID_URL = process.env.SELENIUM_GRID_URL || "http://localhost:4444";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const safeText = (value) => (value ?? "").toString().replace(/\u00a0/g, " ").trim();

function durationMs(startedAt, endedAt = Date.now()) {
  return Math.max(0, endedAt - startedAt);
}

function pushTimingStep(steps, step, startedAt, extra = {}) {
  steps.push({
    step,
    durationMs: durationMs(startedAt),
    ...extra,
  });
}

function buildRowTiming(overallStartedAt, attemptTimings, successfulAttempt = null) {
  const latestAttempt = attemptTimings.length
    ? attemptTimings[attemptTimings.length - 1]
    : null;
  return {
    totalDurationMs: durationMs(overallStartedAt),
    attemptsUsed: attemptTimings.length,
    successfulAttempt,
    steps: latestAttempt?.steps || [],
    attempts: attemptTimings,
  };
}

function logRowTiming(label, timing) {
  if (!timing) return;
  const steps = Array.isArray(timing.steps)
    ? timing.steps.map((step) => `${step.step}=${step.durationMs}ms`).join(", ")
    : "";
  const stepsPart = steps ? ` | ${steps}` : "";
  console.log(
    `    ${label}: total=${timing.totalDurationMs}ms, attempts=${timing.attemptsUsed}${stepsPart}`
  );
}

function isSessionLostMessage(message) {
  const msg = String(message || "").toLowerCase();
  return (
    msg.includes("nosuchsession") ||
    msg.includes("unable to find session") ||
    msg.includes("invalidsession") ||
    msg.includes("invalid session")
  );
}

function isPromiseCollectedMessage(message) {
  return String(message || "").toLowerCase().includes("promise was collected");
}

function isLocationCodeWaitTimeoutMessage(message) {
  const msg = String(message || "").toLowerCase();
  return (
    msg.includes(
      "waiting for element to be located by(css selector, ng-select[formcontrolname='locationcode'])"
    ) ||
    (msg.includes("ng-select[formcontrolname='locationcode']") &&
      msg.includes("wait timed out"))
  );
}

function parseSbDateParts(sbDate) {
  const raw = safeText(sbDate).toUpperCase();
  const normalized = raw.includes(" ") ? raw.split(" ")[0] : raw;
  if (!normalized) return null;

  const monMap = {
    JAN: "01",
    FEB: "02",
    MAR: "03",
    APR: "04",
    MAY: "05",
    JUN: "06",
    JUL: "07",
    AUG: "08",
    SEP: "09",
    OCT: "10",
    NOV: "11",
    DEC: "12",
  };

  let match = normalized.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (match) {
    return { yyyy: match[1], mm: match[2], dd: match[3], source: "ymd" };
  }

  match = normalized.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (match) {
    return { dd: match[1], mm: match[2], yyyy: match[3], source: "dmy" };
  }

  match = normalized.match(/^(\d{2})-([A-Z]{3})-(\d{2}|\d{4})$/);
  if (match) {
    const dd = match[1];
    const mm = monMap[match[2]];
    const yy = match[3];
    if (!mm) return null;
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    return { dd, mm, yyyy, source: "d-mon-y" };
  }

  return null;
}

function normalizeSbDate(sbDate) {
  const parts = parseSbDateParts(sbDate);
  if (!parts) {
    return safeText(sbDate).replace(/\//g, "-");
  }
  return `${parts.dd}-${parts.mm}-${parts.yyyy}`;
}

function candidateDateFormats(sbDate) {
  const parts = parseSbDateParts(sbDate);
  if (!parts) {
    const fallback = safeText(sbDate).replace(/\//g, "-");
    return fallback ? [fallback] : [];
  }

  const dmyDash = `${parts.dd}-${parts.mm}-${parts.yyyy}`;
  const dmySlash = `${parts.dd}/${parts.mm}/${parts.yyyy}`;
  const ymdDash = `${parts.yyyy}-${parts.mm}-${parts.dd}`;
  return [...new Set([dmyDash, dmySlash, ymdDash])];
}

async function safeDriverGet(driver, url) {
  try {
    await driver.get(url);
  } catch (error) {
    const msg = String(error?.message || error);
    if (isSessionLostMessage(msg)) {
      throw new Error(`Session lost: ${error.message || error}`);
    }
    throw error;
  }
}

async function safeRefresh(driver) {
  try {
    await driver.navigate().refresh();
    await sleep(MS.REFRESH_SLEEP);
    return true;
  } catch (error) {
    const msg = String(error?.message || error);
    if (isSessionLostMessage(msg)) {
      throw new Error(`Session lost during refresh: ${error.message || error}`);
    }
    console.warn(`    Refresh failed: ${error?.message || error}`);
    return false;
  }
}

async function selectLocationCode(driver, portCode) {
  const code = safeText(portCode).toUpperCase();
  const locationSelect = await driver.wait(
    until.elementLocated(By.css("ng-select[formcontrolname='locationCode']")),
    MS.LOCATION_SELECT_LOCATED
  );
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", locationSelect);

  const selectedText = async () => {
    try {
      return safeText(await locationSelect.getText()).toUpperCase();
    } catch {
      return "";
    }
  };

  for (let i = 0; i < 3; i += 1) {
    try {
      await locationSelect.click();
    } catch {
      await driver.executeScript("arguments[0].click();", locationSelect);
    }
    await sleep(MS.LOC_AFTER_OPEN);

    const searchInput = await driver.wait(
      until.elementLocated(By.css("ng-select[formcontrolname='locationCode'] input[type='text']")),
      MS.LOCATION_INPUT_LOCATED
    );
    await searchInput.sendKeys(Key.chord(Key.CONTROL, "a"), Key.BACK_SPACE, code);
    await sleep(MS.LOC_AFTER_TYPE_CLEAR);
    await searchInput.sendKeys(Key.ENTER);
    await sleep(MS.LOC_AFTER_ENTER);
    if ((await selectedText()).includes(code)) {
      console.log(`    Location selected by type+enter: ${code}`);
      return;
    }

    await searchInput.sendKeys(Key.ARROW_DOWN, Key.ENTER);
    await sleep(MS.LOC_AFTER_ARROW_ENTER);
    if ((await selectedText()).includes(code)) {
      console.log(`    Location selected by type+arrow+enter: ${code}`);
      return;
    }
  }

  try {
    await locationSelect.click();
  } catch {
    await driver.executeScript("arguments[0].click();", locationSelect);
  }
  await sleep(MS.LOC_FALLBACK_OPEN);

  try {
    const searchInput = await driver.wait(
      until.elementLocated(By.css("ng-select[formcontrolname='locationCode'] input[type='text']")),
      MS.LOCATION_INPUT_LOCATED_FALLBACK
    );
    await searchInput.sendKeys(Key.chord(Key.CONTROL, "a"), Key.BACK_SPACE, code);
    await sleep(MS.LOC_FALLBACK_TYPE);
  } catch {
    // list fallback
  }

  const options = await driver.wait(
    async () => {
      const elements = await driver.findElements(By.css("div.ng-dropdown-panel div.ng-option"));
      return elements.length ? elements : null;
    },
    MS.NG_OPTION_PANEL_WAIT
  );

  let chosen = null;
  for (const option of options) {
    const txt = safeText(await option.getText()).toUpperCase();
    const match = txt.match(/\(([A-Z0-9]+)\)/);
    const codeInText = match ? match[1] : "";
    if (code === codeInText || txt === code || txt.includes(code)) {
      chosen = option;
      break;
    }
  }
  if (!chosen && options.length) chosen = options[0];

  if (chosen) {
    await driver.executeScript("arguments[0].click();", chosen);
    await sleep(MS.LOC_AFTER_OPTION_CLICK);
    if ((await selectedText()).includes(code)) {
      console.log(`    Location selected by fallback click: ${code}`);
      return;
    }
  }

  throw new Error(`Could not select location code: ${code}. Visible selection: '${await selectedText()}'`);
}

async function setShippingBillDate(driver, formattedDate) {
  const dateInput = await driver.wait(
    until.elementLocated(By.css("input[formcontrolname='shippingBillDate']")),
    MS.DATE_INPUT_LOCATED
  );
  await driver.executeScript(
    "arguments[0].removeAttribute('readonly');" +
      "arguments[0].scrollIntoView({block:'center', inline:'nearest'});",
    dateInput
  );
  await safeClick(
    driver,
    dateInput,
    "shippingBillDate",
    MS.DATE_INPUT_LOCATED,
    150
  );
  await driver.executeScript(
    "arguments[0].focus();" +
      "arguments[0].value='';" +
      "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
    dateInput
  );
  try {
    await dateInput.sendKeys(
      Key.chord(Key.CONTROL, "a"),
      Key.BACK_SPACE,
      formattedDate,
      Key.ENTER
    );
  } catch (err) {
    console.warn(
      `    Date input sendKeys fallback for ${formattedDate}: ${err instanceof Error ? err.message : err}`
    );
  }
  const currentValue = safeText(await dateInput.getAttribute("value"));
  if (currentValue !== safeText(formattedDate)) {
    await driver.executeScript(
      "arguments[0].removeAttribute('readonly');" +
        "arguments[0].focus();" +
        "arguments[0].value = arguments[1];" +
        "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));" +
        "arguments[0].dispatchEvent(new Event('change', {bubbles: true}));" +
        "arguments[0].dispatchEvent(new Event('blur', {bubbles: true}));",
      dateInput,
      formattedDate
    );
  }
  await driver.executeScript(
    "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));" +
      "arguments[0].dispatchEvent(new Event('change', {bubbles: true}));" +
      "arguments[0].dispatchEvent(new Event('blur', {bubbles: true}));",
    dateInput
  );
  await sleep(MS.AFTER_DATE_INPUT);
}

/**
 * Wait for ICEGATE frontend to show either no-record or results chrome after Search.
 */
async function waitForShippingBillSearchUiAfterSearch(driver) {
  const maxMs = MS.SEARCH_OUTCOME_MAX;
  const pollMs = MS.SEARCH_OUTCOME_POLL;
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    try {
      const noRecordEls = await driver.findElements(By.css("div.no-record-available"));
      for (const el of noRecordEls) {
        try {
          if (!(await el.isDisplayed())) continue;
        } catch {
          continue;
        }
        let msg = "";
        try {
          msg = safeText(await el.getText());
        } catch {
          msg = "";
        }
        return {
          outcome: "no_record",
          message: msg || "No record available",
        };
      }

      const tabRoots = await driver.findElements(By.id("tablerecords"));
      if (tabRoots.length) {
        try {
          if (await tabRoots[0].isDisplayed()) {
            return { outcome: "has_results" };
          }
        } catch {
          // stale
        }
      }

      const borderButtons = await driver.findElements(
        By.css(
          "div.row-border button[mat-raised-button], div.row-border button.px-5, div.row-border button"
        )
      );
      for (const btn of borderButtons) {
        try {
          if (await btn.isDisplayed()) {
            return { outcome: "has_results" };
          }
        } catch {
          // stale
        }
      }
    } catch {
      // transient
    }

    await sleep(pollMs);
  }

  return { outcome: "timeout" };
}

const TABLE_RECORDS_XPATH = {
  shippingBillDetailsButton: '//*[@id="tablerecords"]/div[1]/button[1]',
  shippingBillDetailsInner: '//*[@id="tablerecords"]/div[1]/button[1]/span/span',
  queueTabButton: '//*[@id="tablerecords"]/div[1]/button[3]',
  queueTabInner: '//*[@id="tablerecords"]/div[1]/button[3]/span/span',
  egmTabButton: '//*[@id="tablerecords"]/div[1]/button[4]',
  egmTabInner: '//*[@id="tablerecords"]/div[1]/button[4]/span/span',
  drawbackQueryTabButton: '//*[@id="tablerecords"]/div[1]/button[5]',
  drawbackQueryTabInner: '//*[@id="tablerecords"]/div[1]/button[5]/span/span',
  panelTableBodyRows: '//*[@id="tablerecords"]/div[2]/table/tbody/tr',
};

const PANEL2_TABLE_ROW_CSS =
  '#tablerecords > div:nth-child(2) table tbody tr[role="row"]';

async function getIcegateOverlayDebugSnapshot(driver) {
  try {
    const overlays = await driver.findElements(By.css("div.overlay"));
    if (!overlays.length) return "no div.overlay nodes in DOM";
    const parts = [];
    for (let i = 0; i < overlays.length; i += 1) {
      const el = overlays[i];
      let displayed = false;
      try {
        displayed = await el.isDisplayed();
      } catch {
        parts.push(`#${i}: stale`);
        continue;
      }
      const cls = ((await el.getAttribute("class")) || "").replace(/\s+/g, " ").trim();
      const text = ((await el.getText()) || "").replace(/\s+/g, " ").trim().slice(0, 80);
      parts.push(`#${i} displayed=${displayed} class="${cls.slice(0, 100)}" text="${text}"`);
    }
    return parts.join(" || ");
  } catch (e) {
    return `overlay snapshot failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function waitForIcegateOverlayToClear(driver, waitMs, minFloorMs = 3000) {
  const raw = Number(waitMs);
  const cap = Number.isFinite(raw) && raw > 0 ? raw : 25_000;
  const floor =
    Number.isFinite(Number(minFloorMs)) && Number(minFloorMs) >= 0
      ? Number(minFloorMs)
      : 3000;
  const ms = Math.max(floor, cap);
  try {
    await driver.wait(
      async () => {
        const overlays = await driver.findElements(By.css("div.overlay"));
        if (!overlays.length) return true;
        for (const el of overlays) {
          try {
            if (!(await el.isDisplayed())) continue;
            const cls = (await el.getAttribute("class")) || "";
            if (cls.includes("ng-animating")) return false;
            return false;
          } catch {
            continue;
          }
        }
        return true;
      },
      ms,
      "ICEGATE overlay wait"
    );
  } catch (e) {
    const snap = await getIcegateOverlayDebugSnapshot(driver);
    throw new Error(
      `ICEGATE overlay did not clear within ${ms}ms (${e instanceof Error ? e.message : e}). ${snap}`
    );
  }
}

async function safeClick(driver, el, context = "", overlayWaitMs = 25_000, overlayMinFloorMs = 3000) {
  const label = context ? `${context}: ` : "";
  await waitForIcegateOverlayToClear(driver, overlayWaitMs, overlayMinFloorMs);
  try {
    await driver.executeScript(
      'arguments[0].scrollIntoView({block:"center", inline:"nearest"})',
      el
    );
    await sleep(MS.SAFE_CLICK_SCROLL_MS);
    await el.click();
  } catch (err) {
    const msg = String(err?.message || err || "");
    const lower = msg.toLowerCase();
    if (lower.includes("element click intercepted") || lower.includes("not clickable")) {
      try {
        await driver.executeScript("arguments[0].click()", el);
        return;
      } catch (err2) {
        const snap = await getIcegateOverlayDebugSnapshot(driver);
        throw new Error(
          `${label}${msg} | JS click: ${err2 instanceof Error ? err2.message : err2} | ${snap}`
        );
      }
    }
    const snap = await getIcegateOverlayDebugSnapshot(driver);
    throw new Error(`${label}${msg} | ${snap}`);
  }
}

async function parseMatRowDynamic(rowEl) {
  const out = {};
  const tds = await rowEl.findElements(By.css('td[role="gridcell"], td[class*="mat-column-"]'));
  for (const td of tds) {
    const cls = (await td.getAttribute("class")) || "";
    const text = safeText(await td.getText());
    const keys = new Set();
    for (const p of cls.split(/\s+/).filter(Boolean)) {
      const mat = p.match(/^mat-column-([\w-]+)$/);
      if (mat) keys.add(mat[1]);
      const cdk = p.match(/^cdk-column-([\w-]+)$/);
      if (cdk) keys.add(cdk[1]);
    }
    for (const key of keys) {
      if (out[key] === undefined) out[key] = text;
      else if (out[key] !== text) out[key] = `${out[key]} | ${text}`;
    }
  }
  return out;
}

/** One short overlay poll + JS click (no second safeClick overlay — that doubled wait to ~6s/tab). */
async function clickTablerecordsTab(
  driver,
  buttonXPath,
  innerSpanXPath,
  visibleWaitMs = MS.TAB_SWITCH_VISIBLE_MS,
  overlayQuickMax = MS.TAB_OVERLAY_QUICK,
  overlayQuickMin = MS.TAB_OVERLAY_QUICK_MIN
) {
  try {
    await waitForIcegateOverlayToClear(driver, overlayQuickMax, overlayQuickMin);
  } catch {
    // proceed; JS click often works while a slow overlay probe would stall
  }
  const btn = await driver.findElement(By.xpath(buttonXPath));
  await driver.wait(until.elementIsVisible(btn), visibleWaitMs);
  await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', btn);
  try {
    await driver.executeScript("arguments[0].click()", btn);
  } catch {
    const inner = await driver.findElement(By.xpath(innerSpanXPath));
    await driver.executeScript("arguments[0].click()", inner);
  }
  await sleep(MS.TAB_AFTER_JS_CLICK);
}

async function fetchShippingBillDetailsRows(driver) {
  const iw = MS.TAB_INITIAL_WAIT;
  const vw = MS.TAB_SWITCH_VISIBLE_MS;
  const rw = MS.TAB_ROW_WAIT_MS;
  await driver.wait(until.elementLocated(By.id("tablerecords")), iw);
  const root = await driver.findElement(By.id("tablerecords"));
  await driver.wait(until.elementIsVisible(root), iw);

  try {
    await clickTablerecordsTab(
      driver,
      TABLE_RECORDS_XPATH.shippingBillDetailsButton,
      TABLE_RECORDS_XPATH.shippingBillDetailsInner,
      vw,
      MS.TAB_OVERLAY_QUICK,
      MS.TAB_OVERLAY_QUICK_MIN
    );
  } catch {
    try {
      await waitForIcegateOverlayToClear(driver, MS.TAB_OVERLAY_QUICK, MS.TAB_OVERLAY_QUICK_MIN);
    } catch {
      // ignore
    }
    const detailsBtn = await driver.findElement(
      By.xpath(
        '//*[@id="tablerecords"]//button[.//span[contains(normalize-space(.), "Shipping Bill Details")]]'
      )
    );
    await driver.wait(until.elementIsVisible(detailsBtn), vw);
    await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', detailsBtn);
    try {
      await driver.executeScript("arguments[0].click()", detailsBtn);
    } catch {
      const inner = await detailsBtn.findElement(By.xpath(".//span/span"));
      await driver.executeScript("arguments[0].click()", inner);
    }
    await sleep(MS.TAB_AFTER_JS_CLICK);
  }

  await driver
    .wait(
      async () => (await driver.findElements(By.css("#tablerecords tr.mat-row"))).length > 0,
      rw
    )
    .catch(() => {});

  const rowEls = await driver.findElements(
    By.css('#tablerecords tr.mat-row[role="row"], #tablerecords tr.mat-mdc-row[role="row"]')
  );
  const rows = [];
  for (const row of rowEls) {
    rows.push(await parseMatRowDynamic(row));
  }
  return rows;
}

async function fetchPanel2TableForTab(
  driver,
  tabButtonXPath,
  tabInnerXPath,
  skipRootWait,
  overlayQuickMax,
  overlayQuickMin
) {
  const iw = MS.TAB_INITIAL_WAIT;
  const vw = MS.TAB_SWITCH_VISIBLE_MS;
  const rw = MS.TAB_ROW_WAIT_MS;

  if (!skipRootWait) {
    await driver.wait(until.elementLocated(By.id("tablerecords")), iw);
    const root = await driver.findElement(By.id("tablerecords"));
    await driver.wait(until.elementIsVisible(root), iw);
  }

  await clickTablerecordsTab(driver, tabButtonXPath, tabInnerXPath, vw, overlayQuickMax, overlayQuickMin);

  await driver
    .wait(
      async () => (await driver.findElements(By.css(PANEL2_TABLE_ROW_CSS))).length > 0,
      rw
    )
    .catch(() => {});

  let rowEls = await driver.findElements(By.css(PANEL2_TABLE_ROW_CSS));
  if (!rowEls.length) {
    rowEls = await driver.findElements(By.xpath(TABLE_RECORDS_XPATH.panelTableBodyRows));
  }

  const rows = [];
  for (const row of rowEls) {
    rows.push(await parseMatRowDynamic(row));
  }
  return rows;
}

async function fetchQueueTableRows(driver, skipRootWait = true) {
  return fetchPanel2TableForTab(
    driver,
    TABLE_RECORDS_XPATH.queueTabButton,
    TABLE_RECORDS_XPATH.queueTabInner,
    skipRootWait,
    MS.TAB_OVERLAY_QUICK,
    MS.TAB_OVERLAY_QUICK_MIN
  );
}

async function fetchEgmTableRows(driver, skipRootWait = true) {
  return fetchPanel2TableForTab(
    driver,
    TABLE_RECORDS_XPATH.egmTabButton,
    TABLE_RECORDS_XPATH.egmTabInner,
    skipRootWait,
    MS.TAB_OVERLAY_QUICK,
    MS.TAB_OVERLAY_QUICK_MIN
  );
}

async function fetchDrawbackQueryRows(driver, skipRootWait = true) {
  return fetchPanel2TableForTab(
    driver,
    TABLE_RECORDS_XPATH.drawbackQueryTabButton,
    TABLE_RECORDS_XPATH.drawbackQueryTabInner,
    skipRootWait,
    MS.DRAWBACK_OVERLAY_QUICK,
    MS.DRAWBACK_OVERLAY_QUICK_MIN
  );
}

async function fetchFourShippingBillTabTables(driver) {
  let prevImplicit = MS.IMPLICIT_WAIT;
  try {
    const t = await driver.manage().getTimeouts();
    if (t && Number.isFinite(Number(t.implicit))) prevImplicit = Number(t.implicit);
  } catch {
    // keep MS.IMPLICIT_WAIT
  }
  try {
    await driver.manage().setTimeouts({ implicit: MS.IMPLICIT_WAIT_EXTRACT });
  } catch {
    // ignore
  }

  const out = {
    rows: [],
    queueRows: [],
    egmRows: [],
    drawbackQueryRows: [],
  };

  const run = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.warn(`    Tab fetch failed [${label}]: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  };

  try {
    out.rows = await run("Shipping Bill Details", () => fetchShippingBillDetailsRows(driver));
    out.queueRows = await run("Current Status", () => fetchQueueTableRows(driver, true));
    out.egmRows = await run("EGM / LEGM", () => fetchEgmTableRows(driver, true));
    out.drawbackQueryRows = await run("Drawback Query", () => fetchDrawbackQueryRows(driver, true));
  } finally {
    try {
      await driver.manage().setTimeouts({ implicit: prevImplicit });
    } catch {
      // ignore
    }
  }

  return out;
}

/**
 * Reads four ICEGATE tabs (frontend tables): Shipping Bill Details, Current Status, EGM, Drawback Query.
 * Gateway tab skipped for speed. Tune MS.TAB_* and MS.DRAWBACK_* for wait times.
 */
async function extractResultsTable(driver, portCode, sbNo, sbDate, _outputDir = null) {
  void _outputDir;
  try {
    console.log(`    Fetching 4 tab tables for SB: ${sbNo}...`);
    const { rows, queueRows, egmRows, drawbackQueryRows } = await fetchFourShippingBillTabTables(driver);
    const gatewayExportRows = [];

    const sbRow = rows[0] || {};
    const currentRow = queueRows[0] || {};
    const egmRow = egmRows[0] || {};
    const dbkRow = drawbackQueryRows[0] || {};
    const gatewayRow = {};

    const combinedCols = [
      "SB_NO",
      "IEC",
      "CHA No.",
      "Job No.",
      "Job Date",
      "Port of Discharge",
      "Total Package",
      "Gross Weight (Kg)",
      "FOB(INR)",
      "Total Cess (INR)",
      "Drawback",
      "STR",
      "Total (DBK+STR)",
      "CIN NO.",
      "CIN DT.",
      "Reward Flag",
      "Current Que",
      "LEO Date",
      "EP Copy Print Status",
      "DBK Scroll No",
      "Scroll Date",
      "EGM Integration Status",
      "EGM No.",
      "EGM Date",
      "Container No.",
      "Seal No.",
      "Error Message",
      "Query No.",
      "Query Date",
      "Query Text",
      "Pending With",
      "Officer Name",
      "Reply Date",
      "Gateway Port",
      "Gateway EGM No.",
      "Gateway EGM Date",
      "Gateway Site Id",
      "AWB No.",
    ];

    const combined = {};
    for (const col of combinedCols) combined[col] = "";
    combined.SB_NO = safeText(sbNo);
    combined.Location = safeText(portCode);
    combined.SB_DT = safeText(sbDate);

    const mappings = [
      [
        sbRow,
        {
          iec: "IEC",
          chaNo: "CHA No.",
          jobNo: "Job No.",
          jobDate: "Job Date",
          portOfDischarge: "Port of Discharge",
          totalPackage: "Total Package",
          grossWeight: "Gross Weight (Kg)",
          fob: "FOB(INR)",
          totalCess: "Total Cess (INR)",
          drawback: "Drawback",
          str: "STR",
          total: "Total (DBK+STR)",
          cinNo: "CIN NO.",
          cinDate: "CIN DT.",
          rewardFlag: "Reward Flag",
        },
      ],
      [
        currentRow,
        {
          currQueue: "Current Que",
          leoDate: "LEO Date",
          epCopy: "EP Copy Print Status",
          custScrollNo: "DBK Scroll No",
          scrollDate: "Scroll Date",
          egmFiled: "EGM Integration Status",
        },
      ],
      [
        egmRow,
        {
          egmNo: "EGM No.",
          egmDate: "EGM Date",
          containerNo: "Container No.",
          sealNo: "Seal No.",
          errorMsg: "Error Message",
        },
      ],
      [
        dbkRow,
        {
          queryNo: "Query No.",
          queryDate: "Query Date",
          queryText: "Query Text",
          pendingWith: "Pending With",
          officerName: "Officer Name",
          replyDate: "Reply Date",
        },
      ],
      [
        gatewayRow,
        {
          awbNo: "AWB No.",
          custGatewayPort: "Gateway Port",
          custGatewayEgmNo: "Gateway EGM No.",
          custGatewayEgmDate: "Gateway EGM Date",
          gatewaySiteId: "Gateway Site Id",
          errorCode: "Error Message",
        },
      ],
    ];

    for (const [src, mapping] of mappings) {
      for (const [srcKey, targetKey] of Object.entries(mapping)) {
        const value = safeText(src[srcKey]);
        if (value) combined[targetKey] = value;
      }
    }

    const orderedKeys = ["SB_NO", "Location", "SB_DT", ...combinedCols.filter((c) => c !== "SB_NO")];
    const orderedCombined = {};
    for (const key of orderedKeys) orderedCombined[key] = combined[key] ?? "";

    const chaNo = safeText(orderedCombined["CHA No."]);
    const hasData = Object.entries(orderedCombined).some(
      ([k, v]) => !["SB_NO", "Location", "SB_DT"].includes(k) && safeText(v)
    );

    if (!hasData) {
      console.log("    Warning: No table cell data beyond SB/Location/Date.");
    }

    return {
      summary: `Extracted 1 row with ${Object.keys(orderedCombined).length} columns (4 tabs)`,
      data: orderedCombined,
      cha_no: chaNo,
      has_data: hasData,
      rows,
      queueRows,
      egmRows,
      drawbackQueryRows,
      gatewayExportRows,
    };
  } catch (error) {
    console.error("    Warning: Could not extract results tables:", error);
    return {
      summary: `Error extracting tables: ${error.message || error}`,
      data: {},
      cha_no: "",
      has_data: false,
      rows: [],
      queueRows: [],
      egmRows: [],
      drawbackQueryRows: [],
      gatewayExportRows: [],
    };
  }
}

/** Optional fast path by column fingerprint; main flow uses extractResultsTable → fetchFourShippingBillTabTables. */
async function captureShippingBillTabs(_driver, _timeoutMs) {
  void _driver;
  void _timeoutMs;
  return {};
}

async function scrapeData(driver, portCode, sbNo, sbDate, outputDir = null, maxRetries = 10) {
  const overallStartedAt = Date.now();
  const attemptTimings = [];

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const attemptStartedAt = Date.now();
    const stepTimings = [];
    let dateFormatUsed = "";

    try {
      console.log(
        `  Scraping: Port Code=${portCode}, SB No=${sbNo}, SB Date=${sbDate} (Attempt ${
          attempt + 1
        }/${maxRetries})`
      );

      let stepStartedAt = Date.now();
      await safeDriverGet(driver, TARGET_URL);
      await sleep(MS.AFTER_NAVIGATE);
      pushTimingStep(stepTimings, "open_page", stepStartedAt);

      stepStartedAt = Date.now();
      await driver.wait(
        until.elementLocated(By.css("ng-select[formcontrolname='locationCode']")),
        MS.WAIT_FORM_LOCATION_SELECT
      );
      await driver.wait(
        until.elementLocated(By.css("input[formcontrolname='shippingBillNo']")),
        MS.WAIT_FORM_SB_INPUT
      );
      console.log("    Shipping Bill form loaded");
      pushTimingStep(stepTimings, "wait_for_form", stepStartedAt);

      stepStartedAt = Date.now();
      await selectLocationCode(driver, portCode);
      pushTimingStep(stepTimings, "select_location_code", stepStartedAt, {
        portCode: safeText(portCode).toUpperCase(),
      });

      stepStartedAt = Date.now();
      const sbNoField = await driver.wait(
        until.elementLocated(By.css("input[formcontrolname='shippingBillNo']")),
        MS.WAIT_SB_FIELD_CLEAR
      );
      await sbNoField.clear();
      await sbNoField.sendKeys(safeText(sbNo));
      pushTimingStep(stepTimings, "enter_shipping_bill_no", stepStartedAt);

      stepStartedAt = Date.now();
      let searchButton = null;
      const dateCandidates = candidateDateFormats(sbDate);
      for (const dateCandidate of dateCandidates) {
        await setShippingBillDate(driver, dateCandidate);
        const candidates = await driver.findElements(
          By.xpath("//form//button[contains(@class,'btn-grey') and not(@disabled)]")
        );
        searchButton = candidates[0] || null;
        if (!searchButton) {
          const fallback = await driver.findElements(
            By.xpath("//button[contains(@class,'btn-grey') and not(@disabled)]")
          );
          searchButton = fallback[0] || null;
        }
        if (searchButton) {
          dateFormatUsed = dateCandidate;
          console.log(`    Using date format: ${dateCandidate}`);
          break;
        }
      }
      pushTimingStep(stepTimings, "set_shipping_bill_date", stepStartedAt, {
        dateFormatUsed: dateFormatUsed || null,
        dateCandidatesTried: dateCandidates.length,
        searchButtonReady: Boolean(searchButton),
      });

      if (!searchButton) {
        throw new Error(
          `Search button remained disabled after trying date formats: ${dateCandidates.join(", ")}`
        );
      }

      stepStartedAt = Date.now();
      await safeClick(driver, searchButton, "search_button", MS.SEARCH_OUTCOME_MAX, 150);
      console.log("    Search submitted");
      pushTimingStep(stepTimings, "submit_search", stepStartedAt);

      stepStartedAt = Date.now();
      const searchUi = await waitForShippingBillSearchUiAfterSearch(driver);
      pushTimingStep(stepTimings, "wait_search_ui", stepStartedAt, {
        outcome: searchUi.outcome,
      });

      if (searchUi.outcome === "no_record") {
        throw new Error(
          `No data returned by portal: ${searchUi.message || "No record available"}`
        );
      }
      if (searchUi.outcome === "timeout") {
        throw new Error(
          `Portal did not show results or no-record within ${MS.SEARCH_OUTCOME_MAX}ms after search`
        );
      }

      await sleep(MS.AFTER_RESULTS_SETTLE);

      stepStartedAt = Date.now();
      const tableData = await extractResultsTable(driver, portCode, sbNo, sbDate, outputDir);
      pushTimingStep(stepTimings, "extract_results_table", stepStartedAt, {
        hasData: Boolean(tableData?.has_data),
      });

      if (!tableData?.has_data) {
        const msgs = await driver.findElements(By.css("div.no-record-available"));
        const noRecordText = (
          await Promise.all(
            msgs.map(async (m) => {
              try {
                return safeText(await m.getText());
              } catch {
                return "";
              }
            })
          )
        )
          .filter(Boolean)
          .join(" | ");
        if (noRecordText) throw new Error(`No data returned by portal: ${noRecordText}`);
        throw new Error("No data returned by portal");
      }

      const attemptTiming = {
        attempt: attempt + 1,
        ok: true,
        totalDurationMs: durationMs(attemptStartedAt),
        steps: stepTimings,
      };
      if (dateFormatUsed) attemptTiming.dateFormatUsed = dateFormatUsed;
      attemptTimings.push(attemptTiming);

      const timing = buildRowTiming(overallStartedAt, attemptTimings, attempt + 1);
      logRowTiming("Fetch timing", timing);

      return {
        port_code: portCode,
        sb_no: sbNo,
        sb_date: sbDate,
        result: tableData.summary || "",
        copy_status: "not_applicable",
        status: "submitted",
        tableData,
        timing,
      };
    } catch (error) {
      const attemptTiming = {
        attempt: attempt + 1,
        ok: false,
        totalDurationMs: durationMs(attemptStartedAt),
        steps: stepTimings,
        error: error?.message || String(error),
      };
      if (dateFormatUsed) attemptTiming.dateFormatUsed = dateFormatUsed;
      attemptTimings.push(attemptTiming);

      const errorMessage = String(error?.message || error).toLowerCase();
      const isNoRecord =
        errorMessage.includes("no record available") ||
        errorMessage.includes("no data returned by portal");
      const shouldRefreshBeforeRetry =
        isPromiseCollectedMessage(errorMessage) ||
        isLocationCodeWaitTimeoutMessage(errorMessage);
      const timing = buildRowTiming(overallStartedAt, attemptTimings, null);

      if (isNoRecord) {
        logRowTiming("Fetch timing (no data)", timing);
        console.log(
          `    Non-retryable (no record) for Port Code=${portCode}, SB No=${sbNo}, SB Date=${sbDate}: ${error?.message || error}`
        );
        return {
          port_code: portCode,
          sb_no: sbNo,
          sb_date: sbDate,
          result: "",
          copy_status: "error",
          status: "error",
          error: error?.message || String(error),
          timing,
        };
      }

      if (attempt < maxRetries - 1) {
        if (shouldRefreshBeforeRetry) {
          const refreshReason = isPromiseCollectedMessage(errorMessage)
            ? "Inspector promise error"
            : "Location selector load timeout";
          console.log(`    ${refreshReason} detected. Refreshing page before retry.`);
          await safeRefresh(driver);
        }
        console.log(
          `    Attempt ${attempt + 1} failed: ${String(error?.message || error).slice(0, 150)}... Retrying...`
        );
        await sleep(MS.RETRY_SLEEP);
      } else {
        console.error(
          `  Error scraping Port Code=${portCode}, SB No=${sbNo}, SB Date=${sbDate} after ${maxRetries} attempts:`,
          error
        );
        logRowTiming("Fetch timing (failed)", timing);
        return {
          port_code: portCode,
          sb_no: sbNo,
          sb_date: sbDate,
          result: "",
          copy_status: "error",
          status: "error",
          error: error?.message || String(error),
          timing,
        };
      }
    }
  }

  const timing = buildRowTiming(overallStartedAt, attemptTimings, null);
  logRowTiming("Fetch timing (unexpected termination)", timing);

  return {
    port_code: portCode,
    sb_no: sbNo,
    sb_date: sbDate,
    result: "",
    copy_status: "error",
    status: "error",
    error: "Unexpected scraper termination",
    timing,
  };
}

async function buildDriver({ gridUrl, implicitWaitMs, pageLoadTimeoutMs } = {}) {
  const base = String(gridUrl || DEFAULT_GRID_URL).replace(/\/$/, "");
  const driver = await new Builder().forBrowser("chrome").usingServer(base).build();
  await driver.manage().setTimeouts({
    implicit: implicitWaitMs ?? MS.IMPLICIT_WAIT,
    pageLoad: pageLoadTimeoutMs ?? MS.PAGE_LOAD,
  });
  return driver;
}

async function safeQuit(driver, context = "") {
  if (!driver) return true;
  try {
    await driver.quit();
    return true;
  } catch {
    return false;
  }
}

function buildScrapeFailure(result) {
  const err = new Error(result?.error || "Scrape failed");
  if (result?.timing) err.timing = result.timing;
  return err;
}

function formatScrapeSuccess({ sbNo, sbDate, sbLocation }, result) {
  const tableData = result?.tableData || {};
  return {
    ok: true,
    sbNo: String(sbNo || "").trim(),
    sbDate: String(sbDate || "").trim(),
    sbDateNormalized: normalizeSbDate(sbDate) || String(sbDate || "").trim(),
    sbLocation: String(sbLocation || "").trim(),
    rows: tableData.rows || [],
    queueRows: tableData.queueRows || [],
    egmRows: tableData.egmRows || [],
    drawbackQueryRows: tableData.drawbackQueryRows || [],
    gatewayExportRows: tableData.gatewayExportRows || [],
    timing: result?.timing || null,
  };
}

async function scrapeShippingBillWithDriver(driver, options = {}) {
  const {
    sbNo,
    sbDate,
    sbLocation,
    rowMaxRetries = Number(process.env.SB_ROW_MAX_RETRIES || 4),
  } = options;

  const result = await scrapeData(
    driver,
    String(sbLocation || "").trim(),
    String(sbNo || "").trim(),
    String(sbDate || "").trim(),
    null,
    Math.max(1, Number(rowMaxRetries) + 1)
  );

  if (result?.status !== "submitted") {
    throw buildScrapeFailure(result);
  }

  return formatScrapeSuccess({ sbNo, sbDate, sbLocation }, result);
}

function isRetryableDistributedError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("stale element reference") ||
    msg.includes("promise was collected") ||
    msg.includes("timed out receiving message from renderer") ||
    msg.includes("err_connection_refused") ||
    msg.includes("connection refused") ||
    msg.includes("timeout") ||
    msg.includes("nosuchsession") ||
    msg.includes("invalid session") ||
    msg.includes("disconnected")
  );
}

async function scrapeShippingBill(options = {}) {
  const {
    gridUrl = DEFAULT_GRID_URL,
    implicitWaitMs = Number(process.env.SB_IMPLICIT_WAIT_MS || MS.IMPLICIT_WAIT),
    pageLoadTimeoutMs = MS.PAGE_LOAD,
    ...rest
  } = options;

  const driver = await buildDriver({ gridUrl, implicitWaitMs, pageLoadTimeoutMs });
  try {
    return await scrapeShippingBillWithDriver(driver, rest);
  } finally {
    await safeQuit(driver, "single-row");
  }
}

async function scrapeShippingBillsDistributed(options = {}) {
  const {
    items = [],
    rowsPerSession = Number(process.env.SB_ROWS_PER_SESSION || 5),
    maxSessions = Number(process.env.SB_MAX_SESSIONS || 5),
    onRowResult,
    ...rest
  } = options;

  const list = Array.isArray(items) ? items : [];
  const chunkSize = Math.max(1, Number(rowsPerSession) || 1);
  const concurrency = Math.max(1, Number(maxSessions) || 1);
  const chunks = [];
  for (let start = 0; start < list.length; start += chunkSize) {
    chunks.push({ start, items: list.slice(start, start + chunkSize) });
  }

  const results = [];
  const errors = [];
  let nextChunk = 0;

  async function runChunk(chunk) {
    let driver = null;

    async function recycleDriver(reason = "") {
      if (!driver) return;
      const quitOk = await safeQuit(driver, reason);
      if (!quitOk) {
        console.warn(
          `[scrapeShippingBillsDistributed] driver quit reported failure${reason ? ` (${reason})` : ""}`
        );
      }
      driver = null;
    }

    async function ensureDriver() {
      if (driver) return driver;
      driver = await buildDriver({
        gridUrl: rest.gridUrl ?? DEFAULT_GRID_URL,
        implicitWaitMs:
          rest.implicitWaitMs ??
          Number(process.env.SB_IMPLICIT_WAIT_MS || MS.IMPLICIT_WAIT),
        pageLoadTimeoutMs: rest.pageLoadTimeoutMs ?? MS.PAGE_LOAD,
      });
      return driver;
    }

    try {
      for (let i = 0; i < chunk.items.length; i += 1) {
        const index = chunk.start + i;
        const input = chunk.items[i] || {};
        const maxAttempts = Math.max(
          1,
          Number(process.env.SB_DISTRIBUTED_SESSION_RETRY_ATTEMPTS ?? 2) || 2
        );
        let lastErr = null;
        let okData = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const activeDriver = await ensureDriver();
            okData = await scrapeShippingBillWithDriver(activeDriver, {
              ...input,
              ...rest,
            });
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (isRetryableDistributedError(err)) {
              await recycleDriver(
                `row index=${index} attempt=${attempt} reason=${err?.message || err}`
              );
            }
            const canRetry = attempt < maxAttempts && isRetryableDistributedError(err);
            if (!canRetry) break;
            console.warn(
              `[scrapeShippingBillsDistributed] retry row index=${index} attempt=${attempt}/${maxAttempts} reason=${err?.message || err}`
            );
            await sleep(Math.min(MS.DISTRIBUTED_RETRY_CAP, MS.DISTRIBUTED_RETRY_BASE * attempt));
          }
        }

        if (lastErr) {
          const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
          const timing = lastErr?.timing || null;
          errors.push({ index, input, message, timing });
          if (typeof onRowResult === "function") {
            await onRowResult({ ok: false, index, input, message, timing });
          }
        } else {
          results.push({ index, input, data: okData });
          if (typeof onRowResult === "function") {
            await onRowResult({ ok: true, index, input, data: okData });
          }
        }
      }
    } finally {
      await recycleDriver(`chunk start=${chunk.start} completed`);
    }
  }

  async function worker() {
    while (true) {
      const idx = nextChunk;
      nextChunk += 1;
      if (idx >= chunks.length) return;
      await runChunk(chunks[idx]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker())
  );

  results.sort((a, b) => a.index - b.index);
  errors.sort((a, b) => a.index - b.index);
  return {
    results,
    errors,
    rowsPerSession: chunkSize,
    maxSessions: Math.min(concurrency, chunks.length),
  };
}

module.exports = {
  MS,
  DEFAULT_GRID_URL,
  TARGET_URL,
  buildDriver,
  safeQuit,
  scrapeShippingBill,
  scrapeShippingBillsDistributed,
  scrapeData,
  extractResultsTable,
  captureShippingBillTabs,
};
