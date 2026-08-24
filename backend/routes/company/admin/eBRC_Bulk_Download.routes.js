const express = require("express");

const {
  eBRCBulkDownloadRequest,
  downloadAttachment,
  storeAttachment,
  listStoredAttachmentsHandler,
  exportStoredAttachmentExcel,
  submitBulkDownloadRequest,
} = require("#controllers/company/admin/eBRC_Bulk_Download");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.get("/eBRC-Bulk-Download-request", requireCompanyAdmin, eBRCBulkDownloadRequest);

router.post("/download-attachment", requireCompanyAdmin, downloadAttachment);

router.post("/submit-bulk-download-request", requireCompanyAdmin, submitBulkDownloadRequest);

/** Download from DGFT and store full attachment rows in ebrcstoredattachment. */
router.post("/store-attachment", requireCompanyAdmin, storeAttachment);

/** List stored attachments: id, fromDate, toDate, attachId. */
router.get("/stored-attachments", requireCompanyAdmin, listStoredAttachmentsHandler);

/** Export stored attachment rows as Excel by stored document id. */
router.get("/stored-attachments/:id/excel", requireCompanyAdmin, exportStoredAttachmentExcel);

module.exports = router;
