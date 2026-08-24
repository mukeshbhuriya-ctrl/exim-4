const express = require("express");

const {
  getCurrentSiteAdmin,
  loginSiteAdmin,
  logoutSiteAdmin,
} = require("#controllers/siteadmin/auth");
const { requireSiteAdminAuth } = require("#utils/siteadmin");

const router = express.Router();

router.post("/login", loginSiteAdmin);
router.post("/logout", logoutSiteAdmin);
router.get("/me", requireSiteAdminAuth, getCurrentSiteAdmin);

module.exports = router;
