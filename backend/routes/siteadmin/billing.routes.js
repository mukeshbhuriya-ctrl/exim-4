const express = require("express");
const { requireSiteAdminAuth } = require("#utils/siteadmin");
const {
  getFullyMatchedSbByDate,
  createBilling,
} = require("#controllers/siteadmin/billing");

const router = express.Router();

// Fully matched invoices in date range → unique PDF SB Nos (requires companyId)
router.get("/fully-matched-sb-by-date", requireSiteAdminAuth, getFullyMatchedSbByDate);

// Create billing document + mark shippingbillno billing=completed + billingId
router.post("/create-billing", requireSiteAdminAuth, createBilling);

module.exports = router;
