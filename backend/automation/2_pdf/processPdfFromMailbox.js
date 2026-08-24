const { getPdfMailboxProvider } = require("#utils/configure");
const { processPdfDataFromGmailMailbox } = require("./processPdfFromGmailMailbox");
const { processPdfDataFromOutlookMailbox } = require("./processPdfFromOutlookMailbox");

/**
 * Fetch PDF attachments using the company's active mailbox provider.
 * Only one provider runs at a time: gmail or outlook.
 *
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @param {{ maxMessages?: number }} [options]
 */
async function processPdfDataFromMailbox(companyId, options = {}) {
  if (!companyId) {
    throw new Error("processPdfDataFromMailbox: companyId is required.");
  }

  const provider = await getPdfMailboxProvider(companyId);

  if (provider === "gmail") {
    return processPdfDataFromGmailMailbox(companyId, options);
  }

  if (provider === "outlook") {
    return processPdfDataFromOutlookMailbox(companyId, options);
  }

  // Soft-skip so automation continues to later steps (3_process, CHA, …).
  return {
    success: true,
    skipped: true,
    provider: "",
    message:
      "PDF mailbox provider is not configured — skipping PDF fetch and continuing.",
    data: {
      provider: "",
      fromMailboxName: "",
      toMailboxName: "",
      total_mails: 0,
      processed_mails: 0,
      reconciled_mails: 0,
      skipped_mails: 0,
      failed_mails: 0,
      stored_rows: 0,
      uploadIds: [],
      mails: [],
      reconciled: [],
      skipped: [],
      errors: [],
    },
  };
}

module.exports = {
  processPdfDataFromMailbox,
  processPdfDataFromGmailMailbox,
  processPdfDataFromOutlookMailbox,
};
