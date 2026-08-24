const express = require("express");

const {
  getSapInv,
  getPdfSb,
} = require("#controllers/company/admin/dashboard/dashboard");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.get("/get-sap-inv", requireCompanyAdmin, getSapInv);
router.get("/get-pdf-sb", requireCompanyAdmin, getPdfSb);

module.exports = router;


