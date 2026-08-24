const fetch = require("node-fetch");
const {
  getGmailOAuthCredentials,
  createGmailAccessSession,
  normalizeGmailOAuthConfig,
  DEFAULT_GMAIL_SCOPES,
} = require("./oauth");

const GMAIL_V1_ME = "https://gmail.googleapis.com/gmail/v1/users/me";

function toSinceMs(ts) {
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("fetchOtpEmailsFromLabelAfterTimestamp: sinceTimestamp must be a positive finite number (Unix seconds or ms).");
  }
  return n < 1e12 ? Math.floor(n * 1000) : Math.floor(n);
}

const HAS_EXPLICIT_TZ = /([zZ]$)|([+\-]\d{2}:?\d{2}$)/;

function parseSinceTimestampInput(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return toSinceMs(raw);
  }
  const s = String(raw ?? "").trim();
  if (!s) {
    throw new Error("parseSinceTimestampInput: empty value.");
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    return toSinceMs(s);
  }

  const normalized = s.replace(" ", "T");

  if (!HAS_EXPLICIT_TZ.test(normalized)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      const ms = Date.parse(`${normalized}T00:00:00+05:30`);
      if (Number.isFinite(ms)) return ms;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(normalized)) {
      const ms = Date.parse(`${normalized}+05:30`);
      if (Number.isFinite(ms)) return ms;
    }
  }

  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) {
    throw new Error(
      `parseSinceTimestampInput: cannot parse "${s}". Use UTC epoch (seconds or ms), or ISO datetime; without Z/offset, time is read as IST (+05:30).`
    );
  }
  return ms;
}

function formatEpochMsAsIst(ms) {
  if (!Number.isFinite(ms)) return "(invalid)";
  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(ms) + " IST"
  );
}

function extractDigitCodes(text) {
  if (!text) return [];
  const found = text.match(/\b\d{4,8}\b/g) || [];
  return [...new Set(found)];
}

function isLikelyCalendarYearFourDigits(code) {
  if (!code || code.length !== 4 || !/^\d{4}$/.test(code)) return false;
  const y = Number(code);
  return y >= 1990 && y <= 2100;
}

function isLikelyFalsePositiveOtp(code) {
  if (code == null || code === "") return true;
  if (isLikelyCalendarYearFourDigits(code)) return true;
  return false;
}

function pickOtpFromMailText(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();

  const ordered = [
    /(\d{4,8})\s+is\s+the\s+OTP\b/i,
    /\b(?:your\s+)?OTP\s+is\s+(\d{4,8})\b/i,
    /\bOTP\s*[:\-]\s*(\d{4,8})\b/i,
    /(?:verification|security)\s+code\s*[:\s]+(\d{4,8})\b/i,
    /(?:one[\s-]?time|one\s*time)\s+(?:password|passcode|PIN)\s*[:\s]+(\d{4,8})\b/i,
    /\bcode\s*[:\-]\s*(\d{4,8})\b/i,
  ];

  for (const re of ordered) {
    const m = t.match(re);
    if (m && m[1]) return m[1];
  }

  const lower = t.toLowerCase();
  const otpIdx = lower.search(/\botp\b/);
  if (otpIdx !== -1) {
    const slice = t.slice(Math.max(0, otpIdx - 30), otpIdx + 200);
    const six = slice.match(/\b(\d{6})\b/);
    if (six) return six[1];
    const allNums = [...slice.matchAll(/\b(\d{4,8})\b/g)].map((x) => x[1]);
    for (const n of allNums) {
      if (!isLikelyCalendarYearFourDigits(n)) return n;
    }
  }

  const codes = extractDigitCodes(t).filter((c) => !isLikelyCalendarYearFourDigits(c));
  if (codes.length === 1) return codes[0];
  return null;
}

function decodeBase64Url(data) {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64").toString("utf8");
}

function collectPlainTextFromPayload(part, out) {
  if (!part) return;
  if (part.mimeType === "text/plain" && part.body && part.body.data) {
    out.push(decodeBase64Url(part.body.data));
  }
  if (part.parts && part.parts.length) {
    for (const p of part.parts) {
      collectPlainTextFromPayload(p, out);
    }
  }
}

function plainTextFromFullMessage(msg) {
  const chunks = [];
  if (msg && msg.payload) {
    collectPlainTextFromPayload(msg.payload, chunks);
  }
  return chunks.join("\n\n");
}

function collectHtmlFromPayload(part, out) {
  if (!part) return;
  if (part.mimeType === "text/html" && part.body && part.body.data) {
    out.push(decodeBase64Url(part.body.data));
  }
  if (part.parts && part.parts.length) {
    for (const p of part.parts) {
      collectHtmlFromPayload(p, out);
    }
  }
}

function htmlToRoughPlain(html) {
  if (!html) return "";
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function bodyTextFromFullMessage(msg) {
  const plain = plainTextFromFullMessage(msg).trim();
  if (plain.length > 0) return plain;
  const htmlChunks = [];
  if (msg && msg.payload) {
    collectHtmlFromPayload(msg.payload, htmlChunks);
  }
  return htmlChunks.map(htmlToRoughPlain).filter(Boolean).join("\n\n");
}

async function gmailJson(accessToken, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...init.headers,
    },
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail API ${res.status} ${url}: ${bodyText}`);
  }
  return bodyText ? JSON.parse(bodyText) : {};
}

function labelLastSegment(name) {
  const n = String(name || "");
  const i = n.lastIndexOf("/");
  return i === -1 ? n : n.slice(i + 1);
}

function collectMimeParts(part, out) {
  if (!part) return;
  out.push(part);
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      collectMimeParts(child, out);
    }
  }
}

async function resolveLabelIdByName(accessToken, labelName) {
  const trimmed = String(labelName || "").trim();
  if (!trimmed) {
    throw new Error("fetchOtpEmailsFromLabelAfterTimestamp: labelName is required.");
  }
  const normalizedPath = trimmed.replace(/\\/g, "/").replace(/\s*\/\s*/g, "/");

  const data = await gmailJson(accessToken, `${GMAIL_V1_ME}/labels`);
  const labels = data.labels || [];
  const lower = normalizedPath.toLowerCase();

  const exact =
    labels.find((l) => l.name === normalizedPath) ||
    labels.find((l) => (l.name || "").toLowerCase() === lower);
  if (exact) {
    return exact.id;
  }

  const userLabels = labels.filter((l) => l.type === "user");
  const byLastSegment = userLabels.filter(
    (l) => labelLastSegment(l.name).toLowerCase() === lower
  );
  if (byLastSegment.length === 1) {
    return byLastSegment[0].id;
  }
  if (byLastSegment.length > 1) {
    throw new Error(
      `fetchOtpEmailsFromLabelAfterTimestamp: more than one user label ends with "${trimmed}": ${byLastSegment
        .map((l) => l.name)
        .join(", ")}. Use the full nested name from Gmail (parent/child), e.g. gfl/OTP.`
    );
  }

  const hints = userLabels
    .filter((l) => (l.name || "").toLowerCase().includes(lower))
    .map((l) => l.name);
  const hintStr =
    hints.length > 0
      ? ` Similar user labels: ${hints.slice(0, 15).join(", ")}${hints.length > 15 ? "…" : ""}.`
      : "";

  throw new Error(
    `fetchOtpEmailsFromLabelAfterTimestamp: no Gmail label named "${trimmed}". Nested labels use the full path with "/" (example: gfl/OTP).${hintStr}`
  );
}

function headerValue(headers, name) {
  const lower = name.toLowerCase();
  const h = (headers || []).find((x) => (x.name || "").toLowerCase() === lower);
  return (h && h.value) || "";
}

async function fetchOtpEmailsFromLabelAfterTimestamp({
  accessToken,
  sinceTimestamp,
  labelName,
  maxMessages = 50,
  fetchPlainBodyIfOtpMissing = true,
  includeDebugBodyText = false,
}) {
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("fetchOtpEmailsFromLabelAfterTimestamp: accessToken is required.");
  }
  const sinceMs =
    typeof sinceTimestamp === "string"
      ? parseSinceTimestampInput(sinceTimestamp)
      : toSinceMs(sinceTimestamp);
  const labelId = await resolveLabelIdByName(accessToken, labelName);

  const listParams = new URLSearchParams();
  listParams.append("labelIds", labelId);
  listParams.set("maxResults", String(Math.min(Math.max(1, maxMessages), 500)));

  const listData = await gmailJson(
    accessToken,
    `${GMAIL_V1_ME}/messages?${listParams.toString()}`
  );
  const messageRefs = listData.messages || [];
  if (messageRefs.length === 0) {
    return [];
  }

  const results = [];
  for (const ref of messageRefs) {
    const metaParams = new URLSearchParams({
      format: "metadata",
      metadataHeaders: "Subject",
    });
    const msg = await gmailJson(
      accessToken,
      `${GMAIL_V1_ME}/messages/${encodeURIComponent(ref.id)}?${metaParams.toString()}`
    );
    const internalDate = Number(msg.internalDate);
    if (!Number.isFinite(internalDate) || internalDate <= sinceMs) {
      continue;
    }
    const subject = headerValue(msg.payload && msg.payload.headers, "Subject");
    const snippet = msg.snippet || "";
    const fromSnippet = `${subject}\n${snippet}`;
    let otp = pickOtpFromMailText(fromSnippet);
    let bodyText = "";

    const needFullBody =
      includeDebugBodyText ||
      (fetchPlainBodyIfOtpMissing && (!otp || isLikelyFalsePositiveOtp(otp)));

    if (needFullBody) {
      const full = await gmailJson(
        accessToken,
        `${GMAIL_V1_ME}/messages/${encodeURIComponent(ref.id)}?format=full`
      );
      bodyText = bodyTextFromFullMessage(full);
      const fromFull = pickOtpFromMailText(`${subject}\n${bodyText}\n${snippet}`);
      if (fromFull) {
        otp = fromFull;
      } else if (otp != null && isLikelyFalsePositiveOtp(otp)) {
        otp = null;
      }
    }

    const forDigits = bodyText ? `${subject}\n${snippet}\n${bodyText}` : fromSnippet;

    const row = {
      id: msg.id,
      threadId: msg.threadId,
      internalDate,
      subject,
      snippet,
      digitCodes: extractDigitCodes(forDigits).filter((c) => !isLikelyCalendarYearFourDigits(c)),
      otp: otp || null,
    };

    if (includeDebugBodyText) {
      const raw =
        bodyText.trim().length > 0
          ? bodyText
          : "(no decoded text/plain or text/html body — message may be empty or use an unusual MIME structure)";
      row.debugBodyText =
        raw.length > 120000 ? `${raw.slice(0, 120000)}\n… [truncated at 120000 chars]` : raw;
    }

    results.push(row);
  }

  results.sort((a, b) => b.internalDate - a.internalDate);
  return results;
}

async function getFullGmailMessage(accessToken, messageId) {
  return gmailJson(
    accessToken,
    `${GMAIL_V1_ME}/messages/${encodeURIComponent(messageId)}?format=full`
  );
}

function findPdfAttachmentPart(payload) {
  const parts = [];
  collectMimeParts(payload, parts);
  const pdfParts = parts.filter((part) => {
    const mime = String(part.mimeType || "").toLowerCase();
    const filename = String(part.filename || "").toLowerCase();
    return mime === "application/pdf" || filename.endsWith(".pdf");
  });
  return (
    pdfParts.find((part) => part.body && part.body.attachmentId) ||
    pdfParts.find((part) => part.body && part.body.data) ||
    null
  );
}

async function downloadGmailAttachmentBuffer(accessToken, messageId, attachmentId) {
  const data = await gmailJson(
    accessToken,
    `${GMAIL_V1_ME}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
  );
  const normalized = String(data.data || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64");
}

async function listMessagesInLabel(accessToken, labelName, options = {}) {
  const labelId = await resolveLabelIdByName(accessToken, labelName);
  const rawLimit = options.maxMessages;
  const hasLimit =
    rawLimit != null &&
    rawLimit !== "" &&
    Number.isFinite(Number(rawLimit)) &&
    Number(rawLimit) > 0;
  const maxMessages = hasLimit ? Math.floor(Number(rawLimit)) : Infinity;
  const messages = [];
  let pageToken;

  while (messages.length < maxMessages) {
    const params = new URLSearchParams();
    params.append("labelIds", labelId);
    const remaining = maxMessages - messages.length;
    params.set(
      "maxResults",
      String(hasLimit ? Math.min(remaining, 500) : 500)
    );
    if (pageToken) params.set("pageToken", pageToken);

    const listData = await gmailJson(accessToken, `${GMAIL_V1_ME}/messages?${params.toString()}`);
    messages.push(...(listData.messages || []));
    pageToken = listData.nextPageToken;
    if (!pageToken) break;
  }

  return {
    labelId,
    labelName: String(labelName || "").trim(),
    messages: hasLimit ? messages.slice(0, maxMessages) : messages,
  };
}

async function extractPdfAttachmentFromMessage(accessToken, messageId) {
  const msg = await getFullGmailMessage(accessToken, messageId);
  const part = findPdfAttachmentPart(msg.payload);
  if (!part || !part.body) return null;

  let buffer;
  if (part.body.attachmentId) {
    buffer = await downloadGmailAttachmentBuffer(accessToken, messageId, part.body.attachmentId);
  } else if (part.body.data) {
    const normalized = String(part.body.data).replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    buffer = Buffer.from(normalized + pad, "base64");
  } else {
    return null;
  }

  if (!buffer || !buffer.length) return null;

  const filename = String(part.filename || "").trim() || `${messageId}.pdf`;
  return {
    messageId: msg.id,
    threadId: msg.threadId,
    filename,
    buffer,
  };
}

async function moveMessageBetweenLabels(accessToken, messageId, fromLabelName, toLabelName) {
  const fromLabelId = await resolveLabelIdByName(accessToken, fromLabelName);
  const toLabelId = await resolveLabelIdByName(accessToken, toLabelName);

  const modifyUrl = `${GMAIL_V1_ME}/messages/${encodeURIComponent(messageId)}/modify`;
  const fullBody = {
    addLabelIds: [toLabelId],
    removeLabelIds: [fromLabelId],
  };

  try {
    return await gmailJson(accessToken, modifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullBody),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cannotRemove =
      /invalid label|labelid not found|cannot remove|not found on message/i.test(msg);
    if (!cannotRemove) {
      throw err;
    }

    return gmailJson(accessToken, modifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds: [toLabelId] }),
    });
  }
}

function sleepGmail(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryFetchLatestOtpWithAccessToken(accessToken, labelsName, sinceMs, options = {}) {
  const rows = await fetchOtpEmailsFromLabelAfterTimestamp({
    accessToken,
    sinceTimestamp: sinceMs,
    labelName: labelsName,
    maxMessages: options.maxMessages ?? 8,
    fetchPlainBodyIfOtpMissing: true,
    includeDebugBodyText: false,
  });
  const hit = rows.find((r) => r.otp);
  return hit && hit.otp ? hit.otp : null;
}

async function waitForLatestOtpFromGmail(otpPayload, sinceMs, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? 180_000;
  const pollMs = options.pollMs ?? 6_000;
  const maxMessages = options.maxMessages ?? 8;

  const labelsName = String(otpPayload?.labelsName || otpPayload?.payload?.labelsName || "").trim();
  if (!labelsName) {
    throw new Error("waitForLatestOtpFromGmail: labelsName is required.");
  }

  let accessToken = String(options.accessToken || "").trim();
  let refreshAccessToken =
    typeof options.refreshAccessToken === "function" ? options.refreshAccessToken : null;
  let oauthConfig = normalizeGmailOAuthConfig(otpPayload);

  if (!accessToken) {
    const session = await createGmailAccessSession(otpPayload);
    accessToken = session.accessToken;
    oauthConfig = session.config;
    refreshAccessToken = session.refreshAccessToken;
  }

  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const otp = await tryFetchLatestOtpWithAccessToken(accessToken, labelsName, sinceMs, {
      maxMessages,
    });
    if (otp) {
      return otp;
    }

    const wait = Math.min(pollMs, Math.max(2000, deadline - Date.now()));
    await sleepGmail(wait);

    if (refreshAccessToken) {
      accessToken = await refreshAccessToken();
    } else if (oauthConfig.clientId && oauthConfig.clientSecret && oauthConfig.refreshToken) {
      const creds = await getGmailOAuthCredentials(oauthConfig);
      accessToken = creds.access_token;
    }
  }

  throw new Error("waitForLatestOtpFromGmail: timed out without a parseable OTP in the configured Gmail label.");
}

module.exports = {
  getGmailOAuthCredentials,
  fetchOtpEmailsFromLabelAfterTimestamp,
  listMessagesInLabel,
  extractPdfAttachmentFromMessage,
  moveMessageBetweenLabels,
  resolveLabelIdByName,
  pickOtpFromMailText,
  isLikelyFalsePositiveOtp,
  toSinceMs,
  parseSinceTimestampInput,
  formatEpochMsAsIst,
  waitForLatestOtpFromGmail,
  tryFetchLatestOtpWithAccessToken,
  DEFAULT_GMAIL_SCOPES,
};
