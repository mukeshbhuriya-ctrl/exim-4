const express = require("express");

const {
  createCombination,
  getCombination,
} = require("#controllers/company/admin/combination");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.get("/", requireCompanyAdmin, getCombination);
router.post("/", requireCompanyAdmin, createCombination);

module.exports = router;
