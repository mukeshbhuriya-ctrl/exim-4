const express = require("express");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");
const {
  getMatchedInvData,
  getMatchedInvDataByInvoice,
  getMatchedInvDataBySbNo,
} = require("#controllers/company/admin/inv/inv_data");

const router = express.Router();

/**
 * GET /matched?page=1&limit=20&search=<inv or sbNo>
 * Combined search (invoice or SB No).
 */
router.get("/matched", requireCompanyAdmin, getMatchedInvData);

/** GET /matched-by-invoice?page=1&limit=20&search=<invoice> */
router.get("/matched-by-invoice", requireCompanyAdmin, getMatchedInvDataByInvoice);

/** GET /matched-by-sb?page=1&limit=20&search=<sbNo> */
router.get("/matched-by-sb", requireCompanyAdmin, getMatchedInvDataBySbNo);

module.exports = router;
