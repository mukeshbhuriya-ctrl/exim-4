const { Company } = require("#utils/company");
const { sendMail, isMailConfigured } = require("#utils/mail");
const {
  getChaPasswordAlertEmails,
  getDgftPasswordAlertEmails,
  normalizePasswordAlertEmails,
  setChaSectionPasswordIsWrong,
  setDgftPasswordIsWrong,
} = require("#utils/configure");

function normalizeEmailList(value) {
  return normalizePasswordAlertEmails(value);
}

function isValidEmailList(emails) {
  const list = normalizeEmailList(emails);
  return list.length === (Array.isArray(emails) ? emails.length : list.length);
}

function isWrongPasswordError(error, portal) {
  const message = String(error?.message || error || "").toLowerCase();
  const status = Number(error?.status);

  if (portal === "cha") {
    return (
      status === 401 ||
      message.includes("invalid credentials") ||
      message.includes("invalid credential") ||
      message.includes("password is wrong") ||
      message.includes("passwordiswrong")
    );
  }

  if (portal === "dgft") {
    return (
      message.includes("invalid username or password") ||
      message.includes("invalid id pass") ||
      message.includes("invalid user") ||
      message.includes("password is wrong") ||
      message.includes("passwordiswrong") ||
      (message.includes("login failed") && message.includes("password"))
    );
  }

  return false;
}

async function markPasswordIsWrong({ companyId, portal, accountId }) {
  if (!companyId) return;
  try {
    if (portal === "cha") {
      await setChaSectionPasswordIsWrong(companyId, accountId, true);
    } else if (portal === "dgft") {
      await setDgftPasswordIsWrong(companyId, true);
    }
  } catch (err) {
    console.warn(
      "[passwordAlert] failed to set passwordIsWrong:",
      err instanceof Error ? err.message : err
    );
  }
}

async function getCompanyDisplayName(companyId) {
  if (!companyId) return "Company";
  try {
    const company = await Company.findById(companyId).select("name").lean();
    return String(company?.name || companyId).trim() || String(companyId);
  } catch {
    return String(companyId);
  }
}

async function notifyWrongPassword({ companyId, portal, accountId, error, knownWrong = false }) {
  if (!companyId) {
    return { sent: false, reason: "missing_company" };
  }

  const classified = knownWrong || isWrongPasswordError(error, portal);
  if (!classified) {
    return { sent: false, reason: "not_wrong_password" };
  }

  // Persist lock so automation can skip login until password is fixed.
  await markPasswordIsWrong({ companyId, portal, accountId });

  const emails =
    portal === "cha"
      ? await getChaPasswordAlertEmails(companyId)
      : await getDgftPasswordAlertEmails(companyId);

  if (!emails.length) {
    return { sent: false, reason: "no_recipients", passwordIsWrongSet: true };
  }

  if (!isMailConfigured()) {
    console.warn("[passwordAlert] SMTP is not configured; skipping alert email.");
    return { sent: false, reason: "mail_not_configured", passwordIsWrongSet: true };
  }

  const companyName = await getCompanyDisplayName(companyId);
  const portalLabel = portal === "cha" ? "CHA / ICEGATE" : "DGFT";
  const accountLabel = String(accountId || "").trim() || "—";
  const errorMessage = String(error?.message || error || "Wrong password").trim();
  const when = new Date().toISOString();
  const skipNote = knownWrong
    ? "Automation skipped login because passwordIsWrong=true in configure."
    : "";

  const subject = `[${companyName}] ${portalLabel} password is wrong`;
  const text = [
    `${portalLabel} login failed due to wrong password.`,
    "",
    `Company: ${companyName}`,
    `Account: ${accountLabel}`,
    `Time (UTC): ${when}`,
    `Details: ${errorMessage}`,
    skipNote,
    "",
    "Update credentials in Configure → CHA or DGFT.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `
    <p><strong>${portalLabel}</strong> login failed due to <strong>wrong password</strong>.</p>
    <ul>
      <li><strong>Company:</strong> ${companyName}</li>
      <li><strong>Account:</strong> ${accountLabel}</li>
      <li><strong>Time (UTC):</strong> ${when}</li>
      <li><strong>Details:</strong> ${errorMessage}</li>
      ${knownWrong ? "<li><strong>Note:</strong> Automation skipped login (passwordIsWrong=true).</li>" : ""}
    </ul>
    <p>Please update credentials in Configure → ${portal === "cha" ? "CHA" : "DGFT"}.</p>
  `;

  const results = await Promise.allSettled(
    emails.map((to) =>
      sendMail({
        to,
        subject,
        text,
        html,
      })
    )
  );

  const sentCount = results.filter((r) => r.status === "fulfilled").length;
  if (sentCount < emails.length) {
    console.warn(
      `[passwordAlert] sent ${sentCount}/${emails.length} alert email(s) for ${portalLabel}`
    );
  }

  return {
    sent: sentCount > 0,
    count: sentCount,
    recipients: emails,
    passwordIsWrongSet: true,
  };
}

function fireWrongPasswordAlert(payload) {
  void notifyWrongPassword(payload).catch((err) => {
    console.warn(
      "[passwordAlert] notify failed:",
      err instanceof Error ? err.message : err
    );
  });
}

module.exports = {
  normalizeEmailList,
  isValidEmailList,
  isWrongPasswordError,
  notifyWrongPassword,
  fireWrongPasswordAlert,
  markPasswordIsWrong,
};
