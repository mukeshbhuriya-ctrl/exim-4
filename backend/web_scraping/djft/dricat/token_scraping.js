const os = require("node:os");
const fs = require("node:fs/promises");
const path = require("node:path");
const Tesseract = require("tesseract.js");
const { Builder, By, until } = require("selenium-webdriver");
const {
  buildChromeOptions,
  waitForCaptchaElement,
  screenshotCaptcha,
} = require("../dgftCaptcha");

const DGFT_LOGIN_URL = "https://www.dgft.gov.in/CP/?opt=view-any-ice";
const DEFAULT_GRID_URL = process.env.SELENIUM_GRID_URL || "http://localhost:4444/wd/hub";

const MS = {
  PAGE_LOAD: 30_000,
  WAIT: 12_000,
  SMALL: 300,
  MEDIUM: 900,
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

async function exportSiteCookies(driver) {
  const cookies = await driver.manage().getCookies();
  return Array.isArray(cookies) ? cookies : [];
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

    const loginErrSpan = await hasVisibleElement(driver, '//*[@id="span_err_login"]', true);
    if (loginErrSpan) {
      throw new Error("Invalid id pass");
    }

    const invalidCred = await hasVisibleElement(driver, "#incMainLogin");
    if (invalidCred) {
      throw new Error("Invalid id pass");
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

async function fetchcookie(options = {}) {
  const {
    username = "",
    password = "",
    maxLoginRetries: maxLoginRetriesRaw,
    seleniumGridUrl = DEFAULT_GRID_URL,
  } = options;

  const user = String(username ?? "").trim();
  const pass = String(password ?? "");
  const maxLoginRetries = getDgftMaxLoginRetries(maxLoginRetriesRaw);

  if (!user || !pass) {
    throw new Error("DGFT credentials are required (username and password).");
  }
  const captchaTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dgft-captcha-"));

  const driver = await createDriver(seleniumGridUrl);
  let cookies = [];
  try {
    await loginToDgft(driver, {
      username: user,
      password: pass,
      maxRetries: maxLoginRetries,
      outputDir: captchaTempDir,
    });
    cookies = await exportSiteCookies(driver);
  } finally {
    try {
      await driver.quit();
    } catch {
      // ignore driver quit errors
    }
    await fs.rm(captchaTempDir, { recursive: true, force: true }).catch(() => {});
  }

  return { cookies };
}

module.exports = {
  fetchcookie,
};
