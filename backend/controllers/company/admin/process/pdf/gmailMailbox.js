const { processPdfDataFromMailbox } = require("../../../../../automation/2_pdf/processPdfFromMailbox");

/**
 * GET /get-pdf-data-from-mailbox
 * Reads PDF attachments from the active mailbox provider (Gmail or Outlook).
 *
 * Query:
 *   maxMessages — optional positive integer; e.g. maxMessages=1 processes one mail only.
 */
function parseMaxMessagesQuery(value) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("maxMessages must be a positive number.");
  }
  return Math.floor(parsed);
}

async function getPdfDataFromMailbox(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const maxMessages = parseMaxMessagesQuery(
      req.query.maxMessages ?? req.query.limit ?? req.query.mailLimit
    );

    const result = await processPdfDataFromMailbox(companyId, { maxMessages });

    return res.status(200).json({
      success: result.success,
      message: result.message,
      provider: result.provider,
      data: result.data,
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return next(error);
  }
}

module.exports = {
  getPdfDataFromMailbox,
};
