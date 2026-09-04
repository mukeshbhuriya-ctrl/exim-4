const express = require("express");

const {
  getRoles
} = require("#controllers/company/admin/roles");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.use(requireCompanyAdmin);

router.get("/", getRoles);

module.exports = router;
