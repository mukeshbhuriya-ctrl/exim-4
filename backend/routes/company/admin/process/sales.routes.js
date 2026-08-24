const express = require("express");
const { upload } = require("#utils/multer");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");


const {
    uploadSalesFile,
    getAllSalesData,
    getSalesDataInToExcel,
    fetchFormSap,
    getSapMissingDates,
    withoutBillingDateInvoice,
} = require("#controllers/company/admin/process/sales/salesdata");


const router = express.Router();

router.get("/get-sales-data", requireCompanyAdmin, getAllSalesData);
router.get("/get-sales-data-in-to-excel", requireCompanyAdmin, getSalesDataInToExcel);

router.post("/upload-sales-file",
    requireCompanyAdmin,
    upload.fields([
        { name: "salesFile", maxCount: 50 },
        { name: "salesFiles", maxCount: 50 },
    ]),
    uploadSalesFile
);

router.post("/data-from-sap", fetchFormSap);
router.post("/sap-missing-dates", getSapMissingDates);

router.post("/without-billing-date-invoice", withoutBillingDateInvoice);


// router.get("/health-check", healthCheck);
// function healthCheck(req, res) {
//     res.status(200).json({
//         success: true,
//         message: "Sales data API is running",
//     });
// }

module.exports = router;
