const express = require("express");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");
const {
  listDgftPdfs,
  getDgftPdfById,
} = require("#controllers/company/admin/pdf/dgftPdf");

const router = express.Router();

/**
 * GET /dgft?page=1&limit=20&search=<sbNo|brc|port>
 * Lists DGFT eBRC PDF rows (from dgftprocess.scrapedData.brcDetail.pdfUrl).
 */
router.get("/dgft", requireCompanyAdmin, listDgftPdfs);

/**
 * GET /dgft/:id
 * Single DGFT PDF row by process id.
 */
router.get("/dgft/:id", requireCompanyAdmin, getDgftPdfById);

module.exports = router;
