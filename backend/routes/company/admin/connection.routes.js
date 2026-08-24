const express = require("express");

const {
  createConnection,
  getConnection,
} = require("#controllers/company/admin/connection");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.get("/", requireCompanyAdmin, getConnection);
router.post("/", requireCompanyAdmin, createConnection);

module.exports = router;
