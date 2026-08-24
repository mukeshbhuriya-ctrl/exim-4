"use strict";

const { By } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

const CAPTCHA_WAIT_MS = 25_000;
const IMAGE_READY_MS = 8_000;

const CAPTCHA_LOCATORS = [
  By.css("img#captcha"),
  By.id("captcha"),
  By.css('img[alt="Captcha"]'),
  By.css("img.img-chptcha"),
  By.css('img[src*="SimpleCaptcha"]'),
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildChromeOptions() {
  const options = new chrome.Options();
  options.addArguments(
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--start-maximized",
    "--no-sandbox",
    "--disable-dev-shm-usage"
  );
  try {
    options.excludeSwitches("enable-automation");
  } catch {
    // older selenium-webdriver builds only accept the array form
    try {
      options.excludeSwitches(["enable-automation"]);
    } catch {
      /* ignore */
    }
  }
  return options;
}

async function findCaptchaInCurrentContext(driver) {
  for (const locator of CAPTCHA_LOCATORS) {
    const nodes = await driver.findElements(locator);
    for (const node of nodes) {
      try {
        const tag = String((await node.getTagName()) || "").toLowerCase();
        const src = String((await node.getAttribute("src")) || "");
        const id = String((await node.getAttribute("id")) || "");
        if (tag === "img" || id === "captcha" || src.includes("SimpleCaptcha")) {
          return node;
        }
      } catch {
        // stale node — try next
      }
    }
  }
  return null;
}

/**
 * DGFT login captcha is:
 *   <img src="SimpleCaptcha?…" id="captcha" alt="Captcha" class="img-chptcha …">
 * It can appear after the login modal opens, sometimes inside an iframe.
 */
async function waitForCaptchaElement(driver, timeoutMs = CAPTCHA_WAIT_MS) {
  const prev = await driver.manage().getTimeouts();
  await driver.manage().setTimeouts({ implicit: 0 });
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      try {
        await driver.switchTo().defaultContent();
      } catch {
        /* ignore */
      }

      const top = await findCaptchaInCurrentContext(driver);
      if (top) return top;

      const frames = await driver.findElements(By.css("iframe, frame"));
      for (let i = 0; i < frames.length; i += 1) {
        try {
          await driver.switchTo().defaultContent();
          await driver.switchTo().frame(i);
          const nested = await findCaptchaInCurrentContext(driver);
          if (nested) return nested;
        } catch {
          /* closed / stale frame */
        }
      }

      await sleep(400);
    }
  } finally {
    await driver.manage().setTimeouts({
      implicit: prev?.implicit ?? 1_500,
    });
  }

  throw new Error(
    `Waiting for DGFT captcha image (img#captcha src=SimpleCaptcha) timed out after ${timeoutMs}ms`
  );
}

async function waitForCaptchaImageReady(driver, captchaEl, timeoutMs = IMAGE_READY_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await driver.executeScript(
      `
      const img = arguments[0];
      if (!img) return false;
      const src = String(img.getAttribute("src") || "");
      return src.indexOf("SimpleCaptcha") !== -1 && img.complete && img.naturalWidth > 0;
      `,
      captchaEl
    );
    if (ready) return;
    await sleep(200);
  }
}

async function screenshotCaptcha(driver, captchaEl) {
  await driver.executeScript(
    "arguments[0].scrollIntoView({block:'center', inline:'center'});",
    captchaEl
  );
  await waitForCaptchaImageReady(driver, captchaEl);
  const base64Png = await captchaEl.takeScreenshot(true);
  return Buffer.from(base64Png, "base64");
}

module.exports = {
  CAPTCHA_WAIT_MS,
  buildChromeOptions,
  waitForCaptchaElement,
  waitForCaptchaImageReady,
  screenshotCaptcha,
};
