const express = require("express");

const {
  changeDefaultPassword,
  loginCompanyUser,
} = require("#controllers/company/auth");

const router = express.Router();

router.post("/login", loginCompanyUser);
router.post("/default-password-change", changeDefaultPassword);

module.exports = router;
