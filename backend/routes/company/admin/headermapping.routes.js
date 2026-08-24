const express = require("express");

const {
  createHeaderMapping,
  createFinancialYearHeaderMapping,
  createJvProcessHeaderMapping,
  createManualMatchDescriptionHeaderMapping,
  createSalesUniqeColumn,
  getFinancialYearHeaderMapping,
  getHeaderMapping,
  getJvProcessHeaderMapping,
  getManualMatchDescriptionHeaderMapping,
  getSalesUniqeColumn,
  getColumnMapping,
  storeColumnMapping,
} = require("#controllers/company/admin/headerMapping");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.get("/", requireCompanyAdmin, getHeaderMapping);
router.post("/", requireCompanyAdmin, createHeaderMapping);

router.get("/jv-process-header-mapping", requireCompanyAdmin, getJvProcessHeaderMapping);
router.post("/jv-process-header-mapping", requireCompanyAdmin, createJvProcessHeaderMapping);

router.get("/sales-uniqe-column", requireCompanyAdmin, getSalesUniqeColumn);
router.post("/sales-uniqe-column", requireCompanyAdmin, createSalesUniqeColumn);

router.get("/financial-year-header-mapping", requireCompanyAdmin, getFinancialYearHeaderMapping);
router.post("/financial-year-header-mapping", requireCompanyAdmin, createFinancialYearHeaderMapping);

router.get("/manual-match-description", requireCompanyAdmin, getManualMatchDescriptionHeaderMapping);
router.post("/manual-match-description", requireCompanyAdmin, createManualMatchDescriptionHeaderMapping);

router.post("/store-column-mapping", requireCompanyAdmin, storeColumnMapping);
router.get("/get-column-mapping", requireCompanyAdmin, getColumnMapping);

module.exports = router;
