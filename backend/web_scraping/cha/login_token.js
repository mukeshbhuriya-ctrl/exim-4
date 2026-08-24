const { Builder, By, until } = require("selenium-webdriver");
const {
  tryFetchLatestOtpWithAccessToken,
  waitForLatestOtpFromGmail,
} = require("#fetch_utils/gmail");

const ICEGATE_LOGIN_URL = "https://foservices.icegate.gov.in/#/login";

const ICEGATE_LOGIN_XPATH = {
  icegateId: '//*[@id="icegateId"]',
  password: '//*[@id="password"]',
  loginButton: '//*[@id="login-box"]/div[1]/form/div[7]/button',
};

const ICEGATE_LOGIN_BUTTON_FALLBACKS = [
  '//*[@id="login-box"]/motion.div[1]/form/div[7]/button',
  '//*[@id="login-box"]//form//button[@type="submit"]',
  '//*[@id="login-box"]//button[contains(., "Login") or contains(., "Sign")]',
];

const ICEGATE_OTP_DIGIT_COUNT = 6;

/** Six digit boxes: otp_0_<suffix> … otp_5_<suffix> (suffix changes per ICEGATE build). */
const ICEGATE_OTP_XPATH = {
  otpDigitPattern: "//app-internal-verification//input[starts-with(@id,'otp_')]",
  otpDigit0: "//*[starts-with(@id, 'otp_0_')]",
  otpInputSingle: '//*[@id="c_k4gf19ckk9mp6ge92z"]',
  otpSubmit:
    "/html/body/app-root/app-layout/div/div[2]/app-login-layout/div/app-internal-verification/div/form/div[2]/motion.div[2]/motion.div[3]/button",
};

const DEFAULT_OTP_INPUT_XPATHS = [
  ICEGATE_OTP_XPATH.otpDigit0,
  ICEGATE_OTP_XPATH.otpInputSingle,
  "//app-internal-verification//input[not(@type='hidden')]",
];

const DEFAULT_OTP_SUBMIT_XPATHS = [
  ICEGATE_OTP_XPATH.otpSubmit,
  "/html/body/app-root/app-layout/div/div[2]/app-login-layout/div/app-internal-verification/div/form/div[2]/div[2]/motion.div[3]/button",
  "/html/body/app-root/app-layout/div/div[2]/app-login-layout/div/app-internal-verification/div/form/div[2]/div[2]/div[3]/button",
  "/html/body/app-root/app-layout/div/div[2]/app-login-layout/div/app-internal-verification/div/form/div[2]/motion.div[2]/motion.div[3]/button",
  "//app-internal-verification//button[@type='submit']",
  "//app-internal-verification//button[contains(normalize-space(.),'Submit') or contains(normalize-space(.),'Verify') or contains(normalize-space(.),'Continue')]",
];

const DEFAULT_TIMEOUT_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads all keys from the current origin's sessionStorage (ICEGATE SPA tokens, etc.).
 * @param {import('selenium-webdriver').WebDriver} driver
 * @returns {Promise<Record<string, string>>}
 */
async function getBrowserSessionStorage(driver) {
  const snapshot = await driver.executeScript(() => {
    const out = {};
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key != null) {
          out[key] = sessionStorage.getItem(key);
        }
      }
    } catch {
      /* cross-origin or unavailable */
    }
    return out;
  });
  return snapshot && typeof snapshot === "object" ? snapshot : {};
}

/**
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {string[]} xpaths
 * @param {number} timeoutMs
 * @returns {Promise<import('selenium-webdriver').WebElement|null>}
 */
async function findFirstDisplayedByXpaths(driver, xpaths, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const xp of xpaths) {
      try {
        const els = await driver.findElements(By.xpath(xp));
        for (const el of els) {
          const shown = await el.isDisplayed().catch(() => false);
          if (shown) {
            return el;
          }
        }
      } catch {
        /* try next */
      }
    }
    await sleep(350);
  }
  return null;
}

/**
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {string[]} xpaths
 * @param {number} timeoutMs
 */
async function clickFirstDisplayedByXpaths(driver, xpaths, timeoutMs) {
  const el = await findFirstDisplayedByXpaths(driver, xpaths, timeoutMs);
  if (!el) {
    throw new Error(`clickFirstDisplayedByXpaths: no visible element for: ${xpaths.slice(0, 3).join(" | ")}`);
  }
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
  await driver.wait(until.elementIsVisible(el), timeoutMs);
  await driver.wait(until.elementIsEnabled(el), timeoutMs);
  try {
    await el.click();
  } catch {
    await driver.executeScript("arguments[0].click();", el);
  }
}

/**
 * Finds 6 visible digit boxes `otp_0_*` … `otp_5_*` (suffix is dynamic).
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {number} timeoutMs
 * @returns {Promise<import('selenium-webdriver').WebElement[]|null>}
 */
async function findSplitOtpDigitInputs(driver, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const candidates = await driver.findElements(By.xpath(ICEGATE_OTP_XPATH.otpDigitPattern));
      const indexed = [];
      for (const el of candidates) {
        const id = (await el.getAttribute("id").catch(() => "")) || "";
        const m = /^otp_(\d+)_/.exec(id);
        if (!m) continue;
        const shown = await el.isDisplayed().catch(() => false);
        if (!shown) continue;
        indexed.push({ index: Number(m[1]), el });
      }
      indexed.sort((a, b) => a.index - b.index);
      const zeroToFive = indexed.filter((x) => x.index >= 0 && x.index < ICEGATE_OTP_DIGIT_COUNT);
      if (zeroToFive.length === ICEGATE_OTP_DIGIT_COUNT) {
        return zeroToFive.map((x) => x.el);
      }
    } catch {
      /* retry */
    }

    const boxes = [];
    for (let i = 0; i < ICEGATE_OTP_DIGIT_COUNT; i++) {
      const el = await findFirstDisplayedByXpaths(
        driver,
        [`//*[starts-with(@id, 'otp_${i}_')]`, `//*[@id="otp_${i}_k4gf19ckk9mp6ge92z"]`],
        1200
      );
      if (!el) {
        boxes.length = 0;
        break;
      }
      boxes.push(el);
    }
    if (boxes.length === ICEGATE_OTP_DIGIT_COUNT) {
      return boxes;
    }

    await sleep(350);
  }
  return null;
}

/**
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {import('selenium-webdriver').WebElement} inputEl
 * @param {string} digit - single character
 * @param {number} timeoutMs
 */
async function fillOtpDigitBox(driver, inputEl, digit, timeoutMs) {
  const ch = String(digit || "").trim().slice(0, 1);
  if (!/^\d$/.test(ch)) {
    throw new Error(`fillOtpDigitBox: expected one digit, got "${digit}".`);
  }

  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", inputEl);
  await driver.wait(until.elementIsVisible(inputEl), timeoutMs);
  await driver.wait(until.elementIsEnabled(inputEl), timeoutMs);

  try {
    await inputEl.click();
  } catch {
    await driver.executeScript("arguments[0].focus();", inputEl);
  }

  await inputEl.clear().catch(() => {});
  await inputEl.sendKeys(ch);

  await driver.executeScript(
    `const el = arguments[0];
     const v = arguments[1];
     el.value = v;
     el.dispatchEvent(new Event("input", { bubbles: true }));
     el.dispatchEvent(new Event("change", { bubbles: true }));
     el.dispatchEvent(new Event("keyup", { bubbles: true }));`,
    inputEl,
    ch
  );
}

/**
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {import('selenium-webdriver').WebElement[]} inputs - length 6
 * @param {string} otp
 * @param {number} timeoutMs
 */
async function fillSplitOtpInputs(driver, inputs, otp, timeoutMs) {
  const digits = String(otp || "").replace(/\D/g, "");
  if (digits.length !== ICEGATE_OTP_DIGIT_COUNT) {
    throw new Error(
      `fillSplitOtpInputs: expected ${ICEGATE_OTP_DIGIT_COUNT}-digit OTP, got "${otp}".`
    );
  }
  if (!inputs || inputs.length !== ICEGATE_OTP_DIGIT_COUNT) {
    throw new Error("fillSplitOtpInputs: six input elements are required.");
  }

  for (let i = 0; i < ICEGATE_OTP_DIGIT_COUNT; i++) {
    await fillOtpDigitBox(driver, inputs[i], digits[i], timeoutMs);
    await sleep(120);
  }
}

/**
 * Prefer 6-box OTP UI; fall back to a single input field.
 * @returns {Promise<'split'|'single'|'none'>}
 */
async function fillIcegateOtp(driver, otp, timeoutMs, opts = {}) {
  const inputXpaths = opts.inputXpaths || DEFAULT_OTP_INPUT_XPATHS;
  const detectMs = opts.detectMs ?? 8_000;

  const splitInputs = await findSplitOtpDigitInputs(driver, detectMs);
  if (splitInputs) {
    await fillSplitOtpInputs(driver, splitInputs, otp, timeoutMs);
    return "split";
  }

  const single = await findFirstDisplayedByXpaths(driver, inputXpaths, detectMs);
  if (single) {
    await fillOtpInput(driver, single, otp, timeoutMs);
    return "single";
  }

  return "none";
}

/**
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {number} timeoutMs
 * @param {string[]} [inputXpaths]
 * @returns {Promise<boolean>}
 */
async function isIcegateOtpUiVisible(driver, timeoutMs, inputXpaths = DEFAULT_OTP_INPUT_XPATHS) {
  const split = await findSplitOtpDigitInputs(driver, Math.min(timeoutMs, 2500));
  if (split) return true;
  const single = await findFirstDisplayedByXpaths(driver, inputXpaths, Math.min(timeoutMs, 2500));
  return Boolean(single);
}

/**
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {import('selenium-webdriver').WebElement} inputEl
 * @param {string} otp
 * @param {number} timeoutMs
 */
async function fillOtpInput(driver, inputEl, otp, timeoutMs) {
  const code = String(otp || "").trim();
  if (!code) {
    throw new Error("fillOtpInput: empty OTP.");
  }

  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", inputEl);
  await driver.wait(until.elementIsVisible(inputEl), timeoutMs);
  await driver.wait(until.elementIsEnabled(inputEl), timeoutMs);

  try {
    await inputEl.click();
  } catch {
    await driver.executeScript("arguments[0].focus();", inputEl);
  }

  await inputEl.clear().catch(() => {});
  await inputEl.sendKeys(code);

  await driver.executeScript(
    `const el = arguments[0];
     const v = arguments[1];
     el.value = v;
     el.dispatchEvent(new Event("input", { bubbles: true }));
     el.dispatchEvent(new Event("change", { bubbles: true }));
     el.dispatchEvent(new Event("keyup", { bubbles: true }));`,
    inputEl,
    code
  );

  const value = await inputEl.getAttribute("value").catch(() => "");
  if (value !== code) {
    await driver.executeScript(
      `const el = arguments[0];
       const v = arguments[1];
       el.value = v;
       el.dispatchEvent(new Event("input", { bubbles: true }));
       el.dispatchEvent(new Event("change", { bubbles: true }));`,
      inputEl,
      code
    );
  }
}

/**
 * After primary login click: wait for OTP UI and Gmail OTP in parallel, then fill and submit.
 *
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {number} sinceMs
 * @param {{ accessToken: string, labelsName: string, refreshAccessToken?: () => Promise<string> }} gmailAuth
 * @param {object} [opts]
 */
async function completeIcegateOtpWithGmailAuth(driver, sinceMs, gmailAuth, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxWaitMs = opts.gmailOtpMaxWaitMs ?? 180_000;
  const pollMs = opts.gmailOtpPollMs ?? 4_000;
  const maxMessages = opts.gmailOtpMaxMessages ?? 10;
  const otpPageDetectMs = opts.otpPageDetectMs ?? 90_000;

  const inputXpaths = (
    Array.isArray(opts.otpInputXpaths) && opts.otpInputXpaths.length > 0
      ? opts.otpInputXpaths
      : [opts.otpInputXpath, ...DEFAULT_OTP_INPUT_XPATHS].filter(Boolean)
  );
  const submitXpaths = (
    Array.isArray(opts.otpSubmitXpaths) && opts.otpSubmitXpaths.length > 0
      ? opts.otpSubmitXpaths
      : [opts.otpSubmitXpath, ...DEFAULT_OTP_SUBMIT_XPATHS].filter(Boolean)
  );

  let accessToken = String(gmailAuth.accessToken || "").trim();
  const labelsName = String(gmailAuth.labelsName || "").trim();
  if (!accessToken || !labelsName) {
    throw new Error("completeIcegateOtpWithGmailAuth: accessToken and labelsName are required.");
  }

  const refreshAccessToken =
    typeof gmailAuth.refreshAccessToken === "function" ? gmailAuth.refreshAccessToken : null;

  const deadline = Date.now() + Math.max(maxWaitMs, otpPageDetectMs);
  let otpUiReady = false;
  let otpCode = null;

  while (Date.now() < deadline) {
    if (!otpUiReady) {
      otpUiReady = await isIcegateOtpUiVisible(driver, Math.min(3000, pollMs), inputXpaths);
    }

    if (!otpCode) {
      otpCode = await tryFetchLatestOtpWithAccessToken(accessToken, labelsName, sinceMs, {
        maxMessages,
      });
    }

    if (otpUiReady && otpCode) {
      break;
    }

    await sleep(Math.min(pollMs, Math.max(1500, deadline - Date.now())));

    if (!otpCode && refreshAccessToken) {
      accessToken = await refreshAccessToken();
    }
  }

  if (!otpUiReady) {
    otpUiReady = await isIcegateOtpUiVisible(driver, 15_000, inputXpaths);
    if (!otpUiReady) {
      return { otpSubmitted: false, reason: "otp_page_not_found" };
    }
  }

  if (!otpCode) {
    const remainingMs = Math.max(30_000, deadline - Date.now());
    otpCode = await waitForLatestOtpFromGmail(
      { labelsName },
      sinceMs,
      {
        accessToken,
        refreshAccessToken,
        maxWaitMs: remainingMs,
        pollMs,
        maxMessages,
      }
    );
  }

  const fillMode = await fillIcegateOtp(driver, otpCode, timeoutMs, {
    inputXpaths,
    detectMs: 15_000,
  });
  if (fillMode === "none") {
    return { otpSubmitted: false, reason: "otp_inputs_not_found", otp: otpCode };
  }

  await clickFirstDisplayedByXpaths(driver, submitXpaths, timeoutMs);
  await sleep(opts.afterOtpSubmitSettleMs ?? 8000);

  return { otpSubmitted: true, otp: otpCode, otpFillMode: fillMode };
}

/**
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {number} timeoutMs
 */
async function clickIcegateLoginButton(driver, timeoutMs) {
  const xpaths = [ICEGATE_LOGIN_XPATH.loginButton, ...ICEGATE_LOGIN_BUTTON_FALLBACKS];
  await clickFirstDisplayedByXpaths(driver, xpaths, timeoutMs);
}

/**
 * @param {string} icegateId
 * @param {string} password
 * @param {object} [options]
 * @param {string} [options.gridUrl]
 * @param {number} [options.timeoutMs]
 * @param {{ accessToken: string, labelsName: string, refreshAccessToken?: () => Promise<string> }} [options.gmailAuth]
 *   Gmail OAuth access token from {@link startCurrentProcess} (refreshed during OTP poll if `refreshAccessToken` is set).
 * @param {{ provider?: string, payload?: object }} [options.otpcred] - Legacy; used only when `gmailAuth` is omitted.
 * @param {(import('selenium-webdriver').WebDriver) => Promise<void>} [options.afterLogin]
 * @returns {Promise<{ cookies: import('selenium-webdriver').IWebDriverOptionsCookie[], cookieHeader: string, sessionStorage: Record<string, string>, loginOtpSinceMs: number, otpResult?: { otpSubmitted: boolean, otp?: string, reason?: string } }>}
 */
async function icegateLoginAndGetCookies(icegateId, password, options = {}) {
  const gridUrl = options.gridUrl ?? process.env.SELENIUM_GRID_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const afterLogin = options.afterLogin;
  const gmailAuth = options.gmailAuth;
  const otpcred = options.otpcred;

  if (!gridUrl) {
    throw new Error("SELENIUM_GRID_URL is not set (see .env).");
  }
  if (!icegateId || !password) {
    throw new Error("icegateId and password are required.");
  }

  const driver = await new Builder().forBrowser("chrome").usingServer(gridUrl).build();
  let otpResult;

  try {
    await driver.manage().setTimeouts({
      implicit: 5000,
      pageLoad: timeoutMs,
      script: timeoutMs,
    });

    await driver.get(ICEGATE_LOGIN_URL);

    const idEl = await driver.wait(
      until.elementLocated(By.xpath(ICEGATE_LOGIN_XPATH.icegateId)),
      timeoutMs
    );
    await idEl.clear();
    await idEl.sendKeys(icegateId);

    const passEl = await driver.wait(
      until.elementLocated(By.xpath(ICEGATE_LOGIN_XPATH.password)),
      timeoutMs
    );
    await passEl.clear();
    await passEl.sendKeys(password);

    const loginOtpSinceMs = Date.now();
    await clickIcegateLoginButton(driver, timeoutMs);

    if (gmailAuth && gmailAuth.accessToken && gmailAuth.labelsName) {
      otpResult = await completeIcegateOtpWithGmailAuth(driver, loginOtpSinceMs, gmailAuth, {
        timeoutMs,
        otpPageDetectMs: options.otpPageDetectMs,
        otpInputXpath: options.otpInputXpath,
        otpInputXpaths: options.otpInputXpaths,
        otpSubmitXpath: options.otpSubmitXpath,
        otpSubmitXpaths: options.otpSubmitXpaths,
        gmailOtpMaxWaitMs: options.gmailOtpMaxWaitMs,
        gmailOtpPollMs: options.gmailOtpPollMs,
        gmailOtpMaxMessages: options.gmailOtpMaxMessages,
        afterOtpSubmitSettleMs: options.afterOtpSubmitSettleMs,
      });
    } else if (otpcred && String(otpcred.provider || "").trim().toLowerCase() === "gmail") {
      const payload = otpcred.payload && typeof otpcred.payload === "object" ? otpcred.payload : {};
      const otp = await waitForLatestOtpFromGmail(payload, loginOtpSinceMs, {
        maxWaitMs: options.gmailOtpMaxWaitMs ?? 180_000,
        pollMs: options.gmailOtpPollMs ?? 6_000,
        maxMessages: options.gmailOtpMaxMessages ?? 8,
      });
      const inputXpaths = [options.otpInputXpath, ...DEFAULT_OTP_INPUT_XPATHS].filter(Boolean);
      const submitXpaths = [options.otpSubmitXpath, ...DEFAULT_OTP_SUBMIT_XPATHS].filter(Boolean);
      const visible = await isIcegateOtpUiVisible(
        driver,
        options.otpPageDetectMs ?? 90_000,
        inputXpaths
      );
      if (visible) {
        const fillMode = await fillIcegateOtp(driver, otp, timeoutMs, {
          inputXpaths,
          detectMs: 15_000,
        });
        if (fillMode === "none") {
          otpResult = { otpSubmitted: false, reason: "otp_inputs_not_found", otp };
        } else {
          await clickFirstDisplayedByXpaths(driver, submitXpaths, timeoutMs);
          await sleep(options.afterOtpSubmitSettleMs ?? 8000);
          otpResult = { otpSubmitted: true, otp, otpFillMode: fillMode };
        }
      } else {
        otpResult = { otpSubmitted: false, reason: "otp_page_not_found" };
      }
    }

    if (typeof afterLogin === "function") {
      await afterLogin(driver);
    }

    const sessionStorage = await getBrowserSessionStorage(driver);
    const cookies = await driver.manage().getCookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    return { cookies, cookieHeader, sessionStorage, loginOtpSinceMs, otpResult };
  } finally {
    await driver.quit();
  }
}

module.exports = {
  icegateLoginAndGetCookies,
  getBrowserSessionStorage,
  completeIcegateOtpWithGmailAuth,
  ICEGATE_LOGIN_URL,
  ICEGATE_LOGIN_XPATH,
  ICEGATE_OTP_XPATH,
};
