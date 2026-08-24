const express = require("express");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");
const {
  createGmailCredential,
  getGmailCredential,
  getGmailRefreshToken,
  gmailOAuthCallback,
  completeGmailOAuth,
} = require("#controllers/company/admin/configure/pdf");
const {
  createOutlookCredential,
  getOutlookCredential,
} = require("#controllers/company/admin/configure/outlook");
const {
  getPdfMailboxConfig,
  selectPdfMailboxProvider,
} = require("#controllers/company/admin/configure/pdfMailbox");

const router = express.Router();

router.post("/create-gmail-credential", requireCompanyAdmin, createGmailCredential);
router.get("/get-gmail-credential", requireCompanyAdmin, getGmailCredential);
router.get("/get-gmail-refresh-token", requireCompanyAdmin, getGmailRefreshToken);
router.get("/gmail-oauth/callback", gmailOAuthCallback);
router.post("/complete-gmail-oauth", requireCompanyAdmin, completeGmailOAuth);

router.post("/create-outlook-credential", requireCompanyAdmin, createOutlookCredential);
router.get("/get-outlook-credential", requireCompanyAdmin, getOutlookCredential);

router.get("/mailbox-status", requireCompanyAdmin, getPdfMailboxConfig);
router.post("/set-mailbox-provider", requireCompanyAdmin, selectPdfMailboxProvider);

module.exports = router;
