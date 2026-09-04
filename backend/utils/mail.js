const nodemailer = require("nodemailer");

const DEFAULT_SMTP_HOST = "smtp.gmail.com";
const DEFAULT_SMTP_PORT = 465;

function isMailConfigured() {
  return Boolean(process.env.SENDER_EMAIL && process.env.APP_PASSWORD);
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || DEFAULT_SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || DEFAULT_SMTP_PORT,
    secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true",
    auth: {
      user: process.env.SENDER_EMAIL,
      pass: process.env.APP_PASSWORD,
    },
  });
}

async function sendMail({ to, subject, text, html }) {
  if (!isMailConfigured()) {
    throw new Error("Mail transport is not configured.");
  }

  const transporter = createTransporter();

  return transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SENDER_EMAIL,
    to,
    subject,
    text,
    html,
  });
}

async function sendCompanyAdminWelcomeEmail({
  companyName,
  recipientEmail,
  recipientName,
  temporaryPassword,
}) {
  const safeRecipientName = recipientName || "Admin";
  const safeCompanyName = companyName || "your company";

  const subject = `Admin account created for ${safeCompanyName}`;
  const text = [
    `Hello ${safeRecipientName},`,
    "",
    `Your admin account for ${safeCompanyName} has been created.`,
    `Email: ${recipientEmail}`,
    `Temporary password: ${temporaryPassword}`,
    "",
    "Please sign in and change your password after the first login.",
  ].join("\n");

  const html = `
    <p>Hello ${safeRecipientName},</p>
    <p>Your admin account for <strong>${safeCompanyName}</strong> has been created.</p>
    <p><strong>Email:</strong> ${recipientEmail}</p>
    <p><strong>Temporary password:</strong> ${temporaryPassword}</p>
    <p>Please sign in and change your password after the first login.</p>
  `;

  return sendMail({
    to: recipientEmail,
    subject,
    text,
    html,
  });
}

module.exports = {
  createTransporter,
  isMailConfigured,
  sendCompanyAdminWelcomeEmail,
  sendMail,
};

async function sendUserWelcomeEmail({
  companyName,
  recipientEmail,
  recipientName,
  temporaryPassword,
  roleName
}) {
  const safeRecipientName = recipientName || "User";
  const safeCompanyName = companyName || "your company";
  const safeRoleName = roleName || "User";

  const subject = `Welcome to ${safeCompanyName} - Account Created`;
  const text = [
    `Hello ${safeRecipientName},`,
    "",
    `An account has been created for you at ${safeCompanyName} with the role: ${safeRoleName}.`,
    `Email: ${recipientEmail}`,
    `Temporary password: ${temporaryPassword}`,
    "",
    "Please sign in and change your password after the first login.",
  ].join("\n");

  const html = `
    <p>Hello ${safeRecipientName},</p>
    <p>An account has been created for you at <strong>${safeCompanyName}</strong> with the role: <strong>${safeRoleName}</strong>.</p>
    <p><strong>Email:</strong> ${recipientEmail}</p>
    <p><strong>Temporary password:</strong> ${temporaryPassword}</p>
    <p>Please sign in and change your password after the first login.</p>
  `;

  return sendMail({
    to: recipientEmail,
    subject,
    text,
    html,
  });
}

module.exports = {
  createTransporter,
  isMailConfigured,
  sendCompanyAdminWelcomeEmail,
  sendUserWelcomeEmail,
  sendMail,
};
