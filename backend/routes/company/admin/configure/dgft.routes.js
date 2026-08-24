const express = require("express");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");
const {
  getDgftIdPass,
  postVerifyDgftLogin,
  getDgftPasswordAlertEmailsHandler,
  saveDgftPasswordAlertEmailsHandler,
} = require("#controllers/company/admin/configure/dgft");

const router = express.Router();

router.post("/get-id-pass", requireCompanyAdmin, getDgftIdPass);
router.post("/add-id-pass", requireCompanyAdmin, postVerifyDgftLogin);
router.get("/password-alert-emails", requireCompanyAdmin, getDgftPasswordAlertEmailsHandler);
router.post("/password-alert-emails", requireCompanyAdmin, saveDgftPasswordAlertEmailsHandler);

module.exports = router;
