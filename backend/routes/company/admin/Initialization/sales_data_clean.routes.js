const express = require("express");
const {
  getSalesDataClean,
  createSalesDataClean,
  updateSalesDataClean,
} = require("#controllers/company/admin/initialization/salesDataClean");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.get("/", requireCompanyAdmin, getSalesDataClean);
router.post("/", requireCompanyAdmin, createSalesDataClean);
router.put("/", requireCompanyAdmin, updateSalesDataClean);

module.exports = router;
