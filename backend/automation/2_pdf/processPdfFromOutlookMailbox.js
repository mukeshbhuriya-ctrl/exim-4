const { getCompanyPdfOutlookAccessSession } = require("#fetch_utils/outlook");
const {
  listMessagesInFolder,
  extractPdfAttachmentFromMessage,
  moveMessageBetweenFolders,
} = require("#fetch_utils/outlook");
const { runPdfMailboxIngestion } = require("./processPdfMailboxCore");

/**
 * Outlook adapter for the shared PDF mailbox pipeline.
 *
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @param {{ maxMessages?: number }} [options]
 */
async function processPdfDataFromOutlookMailbox(companyId, options = {}) {
  const outlookSession = await getCompanyPdfOutlookAccessSession(companyId);
  const { accessToken, mailboxEmail, fromFolderName, toFolderName } = outlookSession;
  const folderListing = await listMessagesInFolder(
    accessToken,
    mailboxEmail,
    fromFolderName,
    { maxMessages: options.maxMessages }
  );

  return runPdfMailboxIngestion({
    companyId,
    provider: "outlook",
    accessToken,
    fromMailboxName: fromFolderName,
    toMailboxName: toFolderName,
    messages: folderListing.messages,
    extractPdfAttachment: (token, messageId) =>
      extractPdfAttachmentFromMessage(token, mailboxEmail, messageId),
    moveProcessedMessage: (token, messageId, fromName, toName) =>
      moveMessageBetweenFolders(token, mailboxEmail, messageId, fromName, toName),
  });
}

module.exports = {
  processPdfDataFromOutlookMailbox,
};
