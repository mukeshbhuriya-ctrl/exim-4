const express = require("express");
const {
  getJvDbkFormat,
  postJvDbkFormat,
  processJvDbk,
  getJvDbkDates,
  getJvDbkDateWiseData,
  getJvDbkDateWiseDataIntoExcel,
  getJvDbkDateWiseDataIntoExcelForSap,
  addSapNoInToJvDbk,
} = require("#controllers/company/admin/jv/jvdbk");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.get("/jv-dbk-format", requireCompanyAdmin, getJvDbkFormat);
router.post("/create-jv-dbk-format", requireCompanyAdmin, postJvDbkFormat);

router.post("/process-jv-dbk", requireCompanyAdmin, processJvDbk);

router.post("/get-jv-dbk-dates", requireCompanyAdmin, getJvDbkDates);
router.post("/get-jv-dbk-date-wise-data", requireCompanyAdmin, getJvDbkDateWiseData);

router.post("/get-jv-dbk-date-wise-data-into-excel", requireCompanyAdmin, getJvDbkDateWiseDataIntoExcel);


router.post("/get-jv-dbk-date-wise-data-into-excel-for-sap", getJvDbkDateWiseDataIntoExcelForSap);

router.post("/add-sap-no-in-to-jv-dbk", addSapNoInToJvDbk);


const {
  getJvRodtpFormat,
  postJvRodtpFormat,
  processJvRodtp,
  getJvRodtpDates,
  getJvRodtpDateWiseData,
  getJvRodtpDateWiseDataIntoExcel,
  getJvRodtpDateWiseDataIntoExcelForSap,
  addSapNoInToJvRodtp,
} = require("#controllers/company/admin/jv/rodtp");


router.get("/jv-rodtp-format", requireCompanyAdmin, getJvRodtpFormat);
router.post("/create-jv-rodtp-format", requireCompanyAdmin, postJvRodtpFormat);

router.post("/process-jv-rodtp", requireCompanyAdmin, processJvRodtp);

router.post("/get-jv-rodtp-dates", requireCompanyAdmin, getJvRodtpDates);
router.post("/get-jv-rodtp-date-wise-data", requireCompanyAdmin, getJvRodtpDateWiseData);
router.post("/get-jv-rodtp-date-wise-data-into-excel", requireCompanyAdmin, getJvRodtpDateWiseDataIntoExcel);


router.post("/get-jv-rodtp-date-wise-data-into-excel-for-sap", getJvRodtpDateWiseDataIntoExcelForSap);

router.post("/add-sap-no-in-to-jv-rodtp", addSapNoInToJvRodtp);







module.exports = router;