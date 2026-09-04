const express = require("express");

const {
  getUsers,
  createUser,
  updateUser,
  deleteUser
} = require("#controllers/company/admin/users");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.get("/", requireCompanyAdmin, getUsers);
router.post("/", requireCompanyAdmin, createUser);
router.put("/:id", requireCompanyAdmin, updateUser);
router.delete("/:id", requireCompanyAdmin, deleteUser);

module.exports = router;
