"use strict";

require("dotenv").config();

const {
  getGmailOAuthCredentials,
  fetchOtpEmailsFromLabelAfterTimestamp,
  parseSinceTimestampInput,
  formatEpochMsAsIst,
} = require("#fetch_utils/gmail");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const clientId = process.env.GMAIL_OTP_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OTP_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OTP_REFRESH_TOKEN;
  const redirectUri = process.env.GMAIL_OTP_REDIRECT_URI || undefined;

  if (!clientId || !clientSecret || !refreshToken) {
    console.error(
      "Missing env: set GMAIL_OTP_CLIENT_ID, GMAIL_OTP_CLIENT_SECRET, and GMAIL_OTP_REFRESH_TOKEN in .env"
    );
    process.exit(1);
  }

  let creds = await getGmailOAuthCredentials({
    clientId,
    clientSecret,
    refreshToken,
    redirectUri,
  });

  console.log("OK: Gmail OAuth credentials refreshed.");
  console.log("token_type:", creds.token_type);
  console.log("expiry_date (ms since epoch):", creds.expiry_date);
  console.log("scope:", creds.scope);
  console.log("access_token length:", creds.access_token ? creds.access_token.length : 0);

  const labelName = (process.env.GMAIL_OTP_LABEL_NAME || "").trim();
  if (!labelName) {
    console.log(
      "Tip: set GMAIL_OTP_LABEL_NAME (nested: parent/child). Optional: GMAIL_OTP_SINCE_TIMESTAMP, GMAIL_OTP_MAX_MESSAGES, GMAIL_OTP_WAIT_MS, GMAIL_OTP_POLL_MAX_ATTEMPTS, GMAIL_OTP_FETCH_PLAIN_IF_OTP_MISSING, GMAIL_OTP_DEBUG_BODY=true (prints decoded full body)."
    );
    return;
  }

  const sinceRaw = process.env.GMAIL_OTP_SINCE_TIMESTAMP;
  let sinceTimestamp;
  try {
    sinceTimestamp =
      sinceRaw !== undefined && String(sinceRaw).trim() !== ""
        ? parseSinceTimestampInput(sinceRaw)
        : Date.now() - 60 * 60 * 1000;
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
  const maxMessages = Number(process.env.GMAIL_OTP_MAX_MESSAGES || "1");
  const max = Number.isFinite(maxMessages) && maxMessages > 0 ? maxMessages : 20;

  const waitMs = Number(process.env.GMAIL_OTP_WAIT_MS || String(3 * 60 * 1000));
  const waitMsSafe = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 3 * 60 * 1000;
  const maxAttempts = Number(process.env.GMAIL_OTP_POLL_MAX_ATTEMPTS || "10");
  const maxAttemptsSafe =
    Number.isFinite(maxAttempts) && maxAttempts >= 1 ? Math.floor(maxAttempts) : 10;

  const fetchPlain =
    String(process.env.GMAIL_OTP_FETCH_PLAIN_IF_OTP_MISSING || "true").toLowerCase() !== "false";

  const debugBodyRaw = String(process.env.GMAIL_OTP_DEBUG_BODY || "").trim().toLowerCase();
  const debugBody = debugBodyRaw === "true" || debugBodyRaw === "1" || debugBodyRaw === "yes";

  let rows = [];
  for (let attempt = 1; attempt <= maxAttemptsSafe; attempt++) {
    rows = await fetchOtpEmailsFromLabelAfterTimestamp({
      accessToken: creds.access_token,
      sinceTimestamp,
      labelName,
      maxMessages: max,
      fetchPlainBodyIfOtpMissing: fetchPlain,
      includeDebugBodyText: debugBody,
    });

    if (rows.length > 0) {
      break;
    }

    if (attempt < maxAttemptsSafe) {
      console.log(
        `No matching mail yet (attempt ${attempt}/${maxAttemptsSafe}). Waiting ${Math.round(
          waitMsSafe / 1000
        )} seconds, then refreshing token and retrying…`
      );
      await sleep(waitMsSafe);
      creds = await getGmailOAuthCredentials({
        clientId,
        clientSecret,
        refreshToken,
        redirectUri,
      });
    }
  }

  if (rows.length === 0) {
    console.log(
      `Stopped after ${maxAttemptsSafe} attempt(s) with no mail newer than sinceTimestamp. Adjust GMAIL_OTP_SINCE_TIMESTAMP or GMAIL_OTP_POLL_MAX_ATTEMPTS if needed.`
    );
  }

  console.log(
    `sinceTimestamp: UTC epoch ms=${sinceTimestamp} → India (IST): ${formatEpochMsAsIst(sinceTimestamp)} (epoch ms is not "in" a timezone; IST is for reading clocks only).`
  );

  console.log(
    `OK: fetchOtpEmailsFromLabelAfterTimestamp (label="${labelName}", since=${sinceTimestamp}, max=${max}) -> ${rows.length} message(s).`
  );
  for (const row of rows) {
    console.log("---");
    console.log("id:", row.id);
    console.log(
      "internalDate (ms):",
      row.internalDate,
      `→ IST: ${formatEpochMsAsIst(row.internalDate)}`
    );
    console.log("subject:", row.subject);
    console.log("snippet:", row.snippet);
    console.log("digitCodes:", row.digitCodes.join(", ") || "(none)");
    console.log("otp:", row.otp != null ? row.otp : "(none)");
    if (debugBody && row.debugBodyText != null) {
      console.log("--- DEBUG decoded body (plain + HTML fallback, for troubleshooting) ---");
      console.log(row.debugBodyText);
      console.log("--- END DEBUG body ---");
    }
  }

  const primary = rows[0];
  console.log(JSON.stringify({ otp: primary && primary.otp ? primary.otp : null }));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
