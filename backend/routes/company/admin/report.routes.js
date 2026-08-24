const express = require("express");
const {
  getColumns,
  createTemplates,
  listTemplates,
  getTemplateById,
  updateTemplateById,
  getReportData,
  getReportExcel,
} = require("#controllers/company/admin/report/report");
const {
  filterDateHeaderMapping,
  getFilterDateHeaderMapping,
} = require("#controllers/company/admin/headerMapping");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.post("/filter-date-heder-mapping", requireCompanyAdmin, filterDateHeaderMapping);
router.get("/filter-date-heder-mapping", requireCompanyAdmin, getFilterDateHeaderMapping);

router.post("/columns", requireCompanyAdmin, getColumns);

router.post("/create-templates", requireCompanyAdmin, createTemplates);
router.post("/templates", requireCompanyAdmin, listTemplates);
router.post("/template-by-id", requireCompanyAdmin, getTemplateById);
router.post("/update-template", requireCompanyAdmin, updateTemplateById);


router.post("/data", requireCompanyAdmin, getReportData);
router.post("/excel", requireCompanyAdmin, getReportExcel);

module.exports = router;
