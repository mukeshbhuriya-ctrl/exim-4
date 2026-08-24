const { Builder, By, Key, until } = require("selenium-webdriver");

const ICEGATE_LOGIN_URL = "https://foservices.icegate.gov.in/#/login";

const ICEGATE_LOGIN_XPATH = {
  icegateId: '//*[@id="icegateId"]',
  password: '//*[@id="password"]',
  loginButton: '//*[@id="login-box"]/div[1]/form/div[7]/button',
};

/** ICEGATE swaps `div` vs `motion.div` between builds — try all known selectors. */
const ICEGATE_LOGIN_BUTTON_XPATHS = [
  ICEGATE_LOGIN_XPATH.loginButton,
  '//*[@id="login-box"]/motion.div[1]/form/div[7]/button',
  '//*[@id="login-box"]//form//button[@type="submit"]',
  '//*[@id="login-box"]//button[contains(normalize-space(.),"Login")]',
  '//*[@id="login-box"]//button[contains(., "Sign")]',
  '//*[@id="login-box"]//form//button',
];

const DEFAULT_TIMEOUT_MS = 60_000;
const EXT_LOGIN_PATH = "/identity/ext-login";

const EXT_LOGIN_CAPTURE_SCRIPT = `
(function() {
  if (window.__icegateExtLoginCaptureInstalled) return;
  window.__icegateExtLoginCaptureInstalled = true;

  const LOGIN_MARK = "${EXT_LOGIN_PATH}";

  function tryJson(v) {
    if (v == null || v === "") return v;
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch (e) { return v; }
  }

  function store(url, method, requestBody) {
    if (!url || String(url).indexOf(LOGIN_MARK) === -1) return;
    window.__icegateExtLoginCapture = {
      url: String(url),
      method: method || "POST",
      requestBody: tryJson(requestBody),
      capturedAt: Date.now(),
    };
  }

  if (typeof window.fetch === "function") {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function(input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      let reqBody = init && init.body;
      if (reqBody && typeof reqBody !== "string") {
        try { reqBody = await new Response(reqBody).text(); } catch (e) {}
      }
      if (String(url).indexOf(LOGIN_MARK) !== -1) {
        store(url, method, reqBody);
      }
      return nativeFetch(input, init);
    };
  }

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__icegateUrl = url;
    this.__icegateMethod = method;
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const url = this.__icegateUrl;
    if (url && String(url).indexOf(LOGIN_MARK) !== -1) {
      store(url, this.__icegateMethod, body);
    }
    return send.apply(this, arguments);
  };
})();
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFirstDisplayedByXpaths(driver, xpaths, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const xp of xpaths) {
      try {
        const els = await driver.findElements(By.xpath(xp));
        for (const el of els) {
          const shown = await el.isDisplayed().catch(() => false);
          if (shown) return el;
        }
      } catch {
        /* try next */
      }
    }
    await sleep(350);
  }
  return null;
}

async function clickElement(driver, el, timeoutMs) {
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
  await driver.wait(until.elementIsVisible(el), timeoutMs);
  await driver.wait(until.elementIsEnabled(el), timeoutMs);
  try {
    await el.click();
  } catch {
    await driver.executeScript("arguments[0].click();", el);
  }
}

async function clickLoginButtonViaDom(driver) {
  return driver.executeScript(`
    const box = document.getElementById("login-box");
    if (!box) return false;
    const buttons = Array.from(box.querySelectorAll("button"));
    const btn =
      box.querySelector('form button[type="submit"]') ||
      buttons.find((b) => /login|sign\\s*in/i.test((b.textContent || "").trim())) ||
      buttons[buttons.length - 1];
    if (!btn) return false;
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  `);
}

/**
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {import('selenium-webdriver').WebElement} [passwordEl]
 */
async function clickIcegateLoginButton(driver, timeoutMs, passwordEl) {
  const el = await findFirstDisplayedByXpaths(driver, ICEGATE_LOGIN_BUTTON_XPATHS, timeoutMs);
  if (el) {
    await clickElement(driver, el, timeoutMs);
    return;
  }

  const viaDom = await clickLoginButtonViaDom(driver);
  if (viaDom) {
    return;
  }

  if (passwordEl) {
    await passwordEl.sendKeys(Key.ENTER);
    await sleep(800);
    return;
  }

  throw new Error(
    `clickIcegateLoginButton: no visible login button. Tried: ${ICEGATE_LOGIN_BUTTON_XPATHS.slice(0, 3).join(" | ")}`
  );
}

async function installExtLoginCapture(driver) {
  if (typeof driver.sendDevToolsCommand === "function") {
    try {
      await driver.sendDevToolsCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: EXT_LOGIN_CAPTURE_SCRIPT,
      });
    } catch {
      /* remote grid may not support CDP */
    }
  }
  await driver.executeScript(EXT_LOGIN_CAPTURE_SCRIPT);
}

async function waitForExtLoginCapture(driver, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const cap = await driver.executeScript("return window.__icegateExtLoginCapture || null;");
    if (cap && cap.requestBody != null) {
      return cap.requestBody;
    }
    await sleep(400);
  }
  return null;
}

/**
 * Opens ICEGATE login in Selenium, fills credentials, clicks Login, and captures
 * the encrypted POST body for /identity/ext-login (does not return API response).
 *
 * @param {string} icegateId
 * @param {string} password - plain password from DB (ICEGATE encrypts in-browser)
 * @param {object} [options]
 * @returns {Promise<{ icegateId: string, password: string, usertype: string }>}
 */
async function captureExtLoginRequestBody(icegateId, password, options = {}) {
  const gridUrl = options.gridUrl ?? process.env.SELENIUM_GRID_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const captureTimeoutMs = options.captureTimeoutMs ?? timeoutMs;

  if (!gridUrl) {
    throw new Error("SELENIUM_GRID_URL is not set (see .env).");
  }
  if (!icegateId || !password) {
    throw new Error("icegateId and password are required.");
  }

  const driver = await new Builder().forBrowser("chrome").usingServer(gridUrl).build();

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
    await sleep(600);

    await installExtLoginCapture(driver);
    await clickIcegateLoginButton(driver, timeoutMs, passEl);

    const requestBody = await waitForExtLoginCapture(driver, captureTimeoutMs);
    if (!requestBody) {
      throw new Error("Failed to capture ext-login request body from browser.");
    }

    return requestBody;
  } finally {
    await driver.quit();
  }
}

module.exports = {
  captureExtLoginRequestBody,
  EXT_LOGIN_PATH,
  ICEGATE_LOGIN_URL,
};
