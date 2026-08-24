const express = require("express");
const { upload } = require("#utils/multer");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");



const {
  startProcess,
  listProcessBatches,
  getProcessBatchDetail,
  getUnmatchedRows,
  getUnmatchedInvoices,
  getUnmatchedRowsByInvoice,
  manualMatchRowsByInvoice,
  updateRowStatus,
  mergeRows,
} = require("#controllers/company/admin/process/process");






const router = express.Router();








router.post("/start-process", requireCompanyAdmin, startProcess);

router.get("/process-dates", requireCompanyAdmin, listProcessBatches);
router.get("/datiles-date-data", requireCompanyAdmin, getProcessBatchDetail);

router.get("/get-unmatched-rows", requireCompanyAdmin, getUnmatchedRows);


// maunal matching
// get unmatched invoice
router.get("/get-unmatched-invoices", requireCompanyAdmin, getUnmatchedInvoices);

// get unmatched rows by invoice 
router.get("/get-unmatched-rows-by-invoice", requireCompanyAdmin, getUnmatchedRowsByInvoice);

// match rows by invoice
router.post("/manual-match-rows-by-invoice", requireCompanyAdmin, manualMatchRowsByInvoice);

// update Available row status -> Exception / Ignored
router.post("/update-row-status", requireCompanyAdmin, updateRowStatus);

// merger rows
router.post("/merge-rows", requireCompanyAdmin, mergeRows);

module.exports = router;
