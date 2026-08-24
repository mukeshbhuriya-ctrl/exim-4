const { simpleParser } = require("mailparser");
const MsgReader = require("@kenjiuno/msgreader").default;

function isPdfAttachment(attachment) {
  const mime = String(attachment?.contentType || attachment?.mime || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  const filename = String(attachment?.filename || attachment?.fileName || "").toLowerCase();
  return mime === "application/pdf" || filename.endsWith(".pdf");
}

function isNestedEmlAttachment(attachment) {
  const mime = String(attachment?.contentType || "").toLowerCase().split(";")[0].trim();
  const filename = String(attachment?.filename || "").toLowerCase();
  return (
    mime === "message/rfc822" ||
    mime === "message/rfc822-eml" ||
    filename.endsWith(".eml")
  );
}

function isNestedMsgAttachment(attachment) {
  const mime = String(attachment?.contentType || attachment?.mime || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  const filename = String(attachment?.filename || attachment?.fileName || "").toLowerCase();
  return mime === "application/vnd.ms-outlook" || filename.endsWith(".msg");
}

function toBuffer(content) {
  if (!content) return null;
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  if (typeof content === "string") return Buffer.from(content);
  return null;
}

function attachmentDisplayName(attachment, fallbackBase, index) {
  const filename = String(attachment?.filename || attachment?.fileName || "").trim();
  if (filename) return filename;
  return `${fallbackBase}-attachment-${index + 1}.pdf`;
}

/**
 * Walk parsed MIME tree and collect PDF attachment buffers.
 * @param {import('mailparser').ParsedMail} parsed
 * @param {string} mailLabel
 * @param {{ buffer: Buffer, originalname: string }[]} out
 */
async function collectPdfAttachmentsFromParsed(parsed, mailLabel, out) {
  const attachments = Array.isArray(parsed?.attachments) ? parsed.attachments : [];

  for (const attachment of attachments) {
    const content = toBuffer(attachment?.content);
    if (!content?.length) continue;

    if (isPdfAttachment(attachment)) {
      out.push({
        buffer: content,
        originalname: attachmentDisplayName(attachment, mailLabel, out.length),
      });
      continue;
    }

    if (isNestedEmlAttachment(attachment)) {
      const nestedLabel =
        String(attachment.filename || mailLabel)
          .replace(/\.eml$/i, "")
          .trim() || mailLabel;
      const nested = await simpleParser(content);
      await collectPdfAttachmentsFromParsed(nested, nestedLabel, out);
      continue;
    }

    if (isNestedMsgAttachment(attachment)) {
      const nestedLabel =
        String(attachment.filename || attachment.fileName || mailLabel)
          .replace(/\.msg$/i, "")
          .trim() || mailLabel;
      const nestedPdfs = await extractPdfAttachmentsFromMsgBuffer(content, `${nestedLabel}.msg`);
      out.push(...nestedPdfs);
    }
  }
}

function isEmlUpload(file) {
  const name = String(file?.originalname || "").toLowerCase();
  const mime = String(file?.mimetype || "").toLowerCase();
  return (
    name.endsWith(".eml") ||
    mime === "message/rfc822" ||
    mime === "message/rfc822-eml"
  );
}

function isMsgUpload(file) {
  const name = String(file?.originalname || "").toLowerCase();
  const mime = String(file?.mimetype || "").toLowerCase();
  return name.endsWith(".msg") || mime === "application/vnd.ms-outlook";
}

function isMailUpload(file) {
  return isEmlUpload(file) || isMsgUpload(file);
}

/**
 * Extract PDF attachments from a raw .eml buffer.
 * @param {Buffer} buffer
 * @param {string} [emlOriginalName]
 * @returns {Promise<{ buffer: Buffer, originalname: string }[]>}
 */
async function extractPdfAttachmentsFromEml(buffer, emlOriginalName = "message.eml") {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    return [];
  }

  const mailLabel =
    String(emlOriginalName || "message.eml")
      .replace(/\.eml$/i, "")
      .trim() || "message";
  const parsed = await simpleParser(buffer);
  const pdfs = [];
  await collectPdfAttachmentsFromParsed(parsed, mailLabel, pdfs);
  return pdfs;
}

async function collectPdfAttachmentsFromMsgReader(reader, attachments, mailLabel, out) {
  const list = Array.isArray(attachments) ? attachments : [];

  for (const attachmentMeta of list) {
    let attachment;
    try {
      attachment = reader.getAttachment(attachmentMeta);
    } catch {
      continue;
    }

    const content = toBuffer(attachment?.content);
    if (!content?.length) continue;

    const fileName = String(
      attachment?.fileName || attachmentMeta?.fileName || attachmentMeta?.name || ""
    ).trim();
    const lowerName = fileName.toLowerCase();

    if (lowerName.endsWith(".pdf") || isPdfAttachment({ fileName, mime: attachmentMeta?.mime })) {
      out.push({
        buffer: content,
        originalname: fileName || `${mailLabel}-attachment-${out.length + 1}.pdf`,
      });
      continue;
    }

    if (lowerName.endsWith(".eml")) {
      const nestedPdfs = await extractPdfAttachmentsFromEml(content, fileName || `${mailLabel}.eml`);
      out.push(...nestedPdfs);
      continue;
    }

    if (lowerName.endsWith(".msg") || attachmentMeta?.innerMsgContent === true) {
      const nestedLabel = fileName.replace(/\.msg$/i, "").trim() || mailLabel;
      const nestedReader = new MsgReader(content);
      const nestedData = nestedReader.getFileData();
      await collectPdfAttachmentsFromMsgReader(
        nestedReader,
        nestedData?.attachments || [],
        nestedLabel,
        out
      );
    }
  }
}

async function extractPdfAttachmentsFromMsgBuffer(buffer, msgOriginalName = "message.msg") {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    return [];
  }

  const mailLabel =
    String(msgOriginalName || "message.msg")
      .replace(/\.msg$/i, "")
      .trim() || "message";
  const reader = new MsgReader(buffer);
  const fileData = reader.getFileData();
  const pdfs = [];
  await collectPdfAttachmentsFromMsgReader(reader, fileData?.attachments || [], mailLabel, pdfs);
  return pdfs;
}

/**
 * Extract PDF attachments from a raw Outlook .msg buffer.
 * @param {Buffer} buffer
 * @param {string} [msgOriginalName]
 * @returns {Promise<{ buffer: Buffer, originalname: string }[]>}
 */
async function extractPdfAttachmentsFromMsg(buffer, msgOriginalName = "message.msg") {
  return extractPdfAttachmentsFromMsgBuffer(buffer, msgOriginalName);
}

/**
 * Expand multipart upload files: direct PDFs pass through; mail files decode to PDF attachments.
 * @param {{ buffer: Buffer, originalname?: string, mimetype?: string }[]} files
 */
async function expandUploadFilesToPdfFiles(files) {
  const pdfFiles = [];
  const mailSkipped = [];

  for (const file of files) {
    if (!file?.buffer?.length) continue;

    if (isEmlUpload(file)) {
      const extracted = await extractPdfAttachmentsFromEml(
        file.buffer,
        file.originalname || "message.eml"
      );
      if (!extracted.length) {
        mailSkipped.push({
          source_file: file.originalname || "message.eml",
          file_type: "eml",
          reason: "no_pdf_attachment",
        });
        continue;
      }

      const sourceMail = file.originalname || "message.eml";
      for (const pdf of extracted) {
        pdfFiles.push({
          buffer: pdf.buffer,
          originalname: pdf.originalname,
          sourceMail,
        });
      }
      continue;
    }

    if (isMsgUpload(file)) {
      const extracted = await extractPdfAttachmentsFromMsg(
        file.buffer,
        file.originalname || "message.msg"
      );
      if (!extracted.length) {
        mailSkipped.push({
          source_file: file.originalname || "message.msg",
          file_type: "msg",
          reason: "no_pdf_attachment",
        });
        continue;
      }

      const sourceMail = file.originalname || "message.msg";
      for (const pdf of extracted) {
        pdfFiles.push({
          buffer: pdf.buffer,
          originalname: pdf.originalname,
          sourceMail,
        });
      }
      continue;
    }

    pdfFiles.push(file);
  }

  return { pdfFiles, mailSkipped };
}

module.exports = {
  isEmlUpload,
  isMsgUpload,
  isMailUpload,
  extractPdfAttachmentsFromEml,
  extractPdfAttachmentsFromMsg,
  expandUploadFilesToPdfFiles,
};
