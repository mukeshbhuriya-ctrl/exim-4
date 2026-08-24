const express = require("express");

const {
  startCurrentProcess,
  startCurrentProcessWithoutOtp,
  getChaData,
} = require("#controllers/company/admin/cha/cha");
const { mergeChaDataToSalesHandler } = require("#controllers/company/admin/cha/match_process");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.get("/start-current-month-process", requireCompanyAdmin, startCurrentProcess);

router.get("/start-current-month-process-without-otp", requireCompanyAdmin, startCurrentProcessWithoutOtp);

router.get("/get-cha-data", requireCompanyAdmin, getChaData);

router.get("/merge-cha-data-to-sales", requireCompanyAdmin, mergeChaDataToSalesHandler);

module.exports = router;

