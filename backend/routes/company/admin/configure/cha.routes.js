const express = require("express");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");
const {
  createcredential,
  getcredential,
  getGmailOtp,
  postGmailOtp,
  getPasswordAlertEmails,
  savePasswordAlertEmails,
} = require("#controllers/company/admin/configure/cha");

const router = express.Router();

router.get("/credential", requireCompanyAdmin, getcredential);
router.post("/credential", requireCompanyAdmin, createcredential);
router.get("/otp/credential", requireCompanyAdmin, getGmailOtp);
router.post("/otp/credential", requireCompanyAdmin, postGmailOtp);
router.get("/password-alert-emails", requireCompanyAdmin, getPasswordAlertEmails);
router.post("/password-alert-emails", requireCompanyAdmin, savePasswordAlertEmails);

module.exports = router;
