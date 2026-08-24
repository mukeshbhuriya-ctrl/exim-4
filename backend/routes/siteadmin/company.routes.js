const express = require("express");

const {
  createCompany,
  getCompanyById,
  getCompanyList,
} = require("#controllers/siteadmin/company");
const { requireSiteAdminAuth } = require("#utils/siteadmin");

const router = express.Router();

router.get("/", requireSiteAdminAuth, getCompanyList);
router.get("/:companyId", requireSiteAdminAuth, getCompanyById);
router.post("/", requireSiteAdminAuth, createCompany);
router.post("/create", requireSiteAdminAuth, createCompany);

module.exports = router;
