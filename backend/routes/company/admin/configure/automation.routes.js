const express = require("express");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");
const {
  getAutomationSettings,
  saveAutomationSettings,
  getSalesCoolingDays,
  getAutomationLogs,
  getSapMissingDatesLogs,
} = require("#controllers/company/admin/configure/automation");

const router = express.Router();

router.get("/", requireCompanyAdmin, getAutomationSettings);
router.post("/", requireCompanyAdmin, saveAutomationSettings);

router.get("/get-automation-logs", requireCompanyAdmin, getAutomationLogs);
router.post("/sap-missing-dates-logs", requireCompanyAdmin, getSapMissingDatesLogs);

router.post("/sales-cooling-days", getSalesCoolingDays);

module.exports = router;
