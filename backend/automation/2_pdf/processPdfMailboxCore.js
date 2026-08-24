const { processUploadedPdfFiles } = require("#controllers/company/admin/process/pdf/pdfdata");

/** Skip reasons where DB already has this SB — mail should still move to processed folder. */
const RECONCILE_MOVE_SKIP_REASONS = new Set([
  "duplicate_sb_no",
  "duplicate_sb_no_in_request",
]);

function shouldReconcileMoveOnSkip(skip = {}) {
  if (skip.data_already_stored) return true;
  return RECONCILE_MOVE_SKIP_REASONS.has(String(skip.reason || ""));
}

async function tryMoveProcessedMessage(
  moveProcessedMessage,
  accessToken,
  messageId,
  fromMailboxName,
  toMailboxName,
  { retries = 1 } = {}
) {
  let lastError = null;
  const attempts = Math.max(1, retries + 1);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await moveProcessedMessage(
        accessToken,
        messageId,
        fromMailboxName,
        toMailboxName
      );
      return { moved: true };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }

  return {
    moved: false,
    error: lastError?.message || "Unknown move error",
  };
}

/**
 * Shared PDF mailbox pipeline for any mail provider:
 * 1. For each message (sequential) → extract PDF attachment
 * 2. Extract data and save via processUploadedPdfFiles
 * 3. Move message to processed folder/label
 *
 * Reconcile path: if data was stored on a prior run but mail was never moved,
 * a later fetch hits duplicate_sb_no — we still move the mail to processed.
 *
 * @param {object} options
 * @param {import('mongoose').Types.ObjectId|string} options.companyId
 * @param {"gmail"|"outlook"} options.provider
 * @param {string} options.accessToken
 * @param {string} options.fromMailboxName
 * @param {string} options.toMailboxName
 * @param {{ id: string }[]} options.messages
 * @param {(accessToken: string, messageId: string) => Promise<{ buffer: Buffer, filename: string }|null>} options.extractPdfAttachment
 * @param {(accessToken: string, messageId: string, fromName: string, toName: string) => Promise<unknown>} options.moveProcessedMessage
 */
async function runPdfMailboxIngestion({
  companyId,
  provider,
  accessToken,
  fromMailboxName,
  toMailboxName,
  messages,
  extractPdfAttachment,
  moveProcessedMessage,
}) {
  if (!companyId) {
    throw new Error("runPdfMailboxIngestion: companyId is required.");
  }
  if (!accessToken) {
    throw new Error("runPdfMailboxIngestion: accessToken is required.");
  }
  if (!fromMailboxName || !toMailboxName) {
    throw new Error("runPdfMailboxIngestion: fromMailboxName and toMailboxName are required.");
  }
  if (typeof extractPdfAttachment !== "function" || typeof moveProcessedMessage !== "function") {
    throw new Error("runPdfMailboxIngestion: extractPdfAttachment and moveProcessedMessage are required.");
  }

  const skipped = [];
  const processedMails = [];
  const reconciledMails = [];
  const mailErrors = [];
  let totalStoredRows = 0;
  const uploadIds = [];

  for (const ref of messages) {
    const messageId = ref.id;
    let pdf = null;

    try {
      pdf = await extractPdfAttachment(accessToken, messageId);
      if (!pdf) {
        skipped.push({
          messageId,
          reason: "no_pdf_attachment",
        });
        continue;
      }

      const processResult = await processUploadedPdfFiles(companyId, [
        {
          buffer: pdf.buffer,
          originalname: pdf.filename,
          gmailMessageId: messageId,
        },
      ]);

      if (processResult.skipped?.length) {
        const skip = processResult.skipped[0] || {};

        if (shouldReconcileMoveOnSkip(skip)) {
          const moveResult = await tryMoveProcessedMessage(
            moveProcessedMessage,
            accessToken,
            messageId,
            fromMailboxName,
            toMailboxName
          );

          if (moveResult.moved) {
            reconciledMails.push({
              messageId,
              filename: pdf.filename,
              reason: skip.reason || "duplicate_sb_no",
              reconciled: true,
              data_already_stored: true,
              movedToMailbox: toMailboxName,
              sbNo: skip.sbNo || null,
            });
          } else {
            mailErrors.push({
              messageId,
              filename: pdf.filename,
              reason: "data_in_db_move_failed",
              data_already_stored: true,
              skip_reason: skip.reason || "duplicate_sb_no",
              sbNo: skip.sbNo || null,
              moveError: moveResult.error,
            });
          }
        } else {
          skipped.push({
            messageId,
            filename: pdf.filename,
            reason: skip.reason || "skipped",
            sbNo: skip.sbNo || null,
          });
        }
        continue;
      }

      if (processResult.errors?.length) {
        mailErrors.push({
          messageId,
          filename: pdf.filename,
          ...processResult.errors[0],
        });
        continue;
      }

      const moveResult = await tryMoveProcessedMessage(
        moveProcessedMessage,
        accessToken,
        messageId,
        fromMailboxName,
        toMailboxName
      );

      if (!moveResult.moved) {
        const hadNewData = (processResult.stored_rows ?? 0) > 0;
        mailErrors.push({
          messageId,
          filename: pdf.filename,
          reason: hadNewData ? "data_saved_move_failed" : "move_failed",
          data_saved: hadNewData,
          stored_rows: processResult.stored_rows ?? 0,
          uploadId: processResult.uploadId,
          moveError: moveResult.error,
          file: processResult.files?.[0] || null,
        });
        if (hadNewData) {
          totalStoredRows += processResult.stored_rows || 0;
          if (processResult.uploadId) uploadIds.push(processResult.uploadId);
        }
        continue;
      }

      totalStoredRows += processResult.stored_rows || 0;
      if (processResult.uploadId) uploadIds.push(processResult.uploadId);

      processedMails.push({
        messageId,
        filename: pdf.filename,
        movedToMailbox: toMailboxName,
        uploadId: processResult.uploadId,
        stored_rows: processResult.stored_rows,
        file: processResult.files?.[0] || null,
      });
    } catch (err) {
      mailErrors.push({
        messageId,
        filename: pdf?.filename || null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totalMails = messages.length;
  const providerLabel = provider === "gmail" ? "Gmail" : "Outlook";
  const movedCount = processedMails.length + reconciledMails.length;

  let message;
  if (movedCount > 0 && mailErrors.length === 0) {
    const reconciledNote =
      reconciledMails.length > 0
        ? ` (${reconciledMails.length} already in DB, mail moved to processed)`
        : "";
    message = `Processed ${movedCount} PDF mail(s) from ${providerLabel} and moved to "${toMailboxName}".${reconciledNote}`;
  } else if (movedCount > 0) {
    message = `Moved ${movedCount} PDF mail(s) to "${toMailboxName}"; ${mailErrors.length} had errors (see errors).`;
  } else if (totalMails === 0) {
    message = `No messages found in ${providerLabel} mailbox "${fromMailboxName}" — continuing.`;
  } else if (mailErrors.length === 0) {
    message = `No PDF attachments were processed from the ${providerLabel} mailbox — continuing.`;
  } else {
    message = `No PDF attachments were processed from the ${providerLabel} mailbox (${mailErrors.length} error(s)).`;
  }

  const noPdfFound = movedCount === 0 && totalStoredRows === 0 && mailErrors.length === 0;

  return {
    success: mailErrors.length === 0,
    skipped: noPdfFound,
    provider,
    message,
    data: {
      provider,
      fromMailboxName,
      toMailboxName,
      total_mails: totalMails,
      processed_mails: processedMails.length,
      reconciled_mails: reconciledMails.length,
      skipped_mails: skipped.length,
      failed_mails: mailErrors.length,
      stored_rows: totalStoredRows,
      uploadIds,
      mails: processedMails,
      reconciled: reconciledMails,
      skipped,
      errors: mailErrors,
    },
  };
}

module.exports = {
  runPdfMailboxIngestion,
  shouldReconcileMoveOnSkip,
  tryMoveProcessedMessage,
};
