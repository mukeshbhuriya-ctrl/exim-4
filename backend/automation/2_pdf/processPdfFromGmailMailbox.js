const { getCompanyPdfGmailAccessSession } = require("#fetch_utils/gmail");
const {
  listMessagesInLabel,
  extractPdfAttachmentFromMessage,
  moveMessageBetweenLabels,
} = require("#fetch_utils/gmail");
const { runPdfMailboxIngestion } = require("./processPdfMailboxCore");

/**
 * Gmail adapter for the shared PDF mailbox pipeline.
 *
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @param {{ maxMessages?: number }} [options]
 */
async function processPdfDataFromGmailMailbox(companyId, options = {}) {
  const gmailSession = await getCompanyPdfGmailAccessSession(companyId);
  const { accessToken, fromLabelName, toLabelName } = gmailSession;
  const labelListing = await listMessagesInLabel(accessToken, fromLabelName, {
    maxMessages: options.maxMessages,
  });

  return runPdfMailboxIngestion({
    companyId,
    provider: "gmail",
    accessToken,
    fromMailboxName: fromLabelName,
    toMailboxName: toLabelName,
    messages: labelListing.messages,
    extractPdfAttachment: extractPdfAttachmentFromMessage,
    moveProcessedMessage: moveMessageBetweenLabels,
  });
}

module.exports = {
  processPdfDataFromGmailMailbox,
};
