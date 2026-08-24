const express = require("express");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");
const {
  getSapCredential,
  getSapCredentialByCompanyId,
  createSapCredential,
} = require("#controllers/company/admin/configure/sales");

const router = express.Router();

router.get("/credential", requireCompanyAdmin, getSapCredential);
router.post("/credential", requireCompanyAdmin, createSapCredential);
router.get("/get-sap-credential", getSapCredentialByCompanyId);

module.exports = router;
