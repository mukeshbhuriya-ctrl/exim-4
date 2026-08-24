const express = require("express");
const { upload } = require("#utils/multer");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");


const {
    uploadMultiplePdf,
    getAllPdfData,
    getPdfDataInToExcel,
} = require("#controllers/company/admin/process/pdf/pdfdata");
const { getPdfDataFromMailbox } = require("#controllers/company/admin/process/pdf/gmailMailbox");

const router = express.Router();

router.get("/get-pdf-data", requireCompanyAdmin, getAllPdfData);
router.get("/get-pdf-data-in-to-excel", requireCompanyAdmin, getPdfDataInToExcel);


router.get("/get-pdf-data-from-mailbox", requireCompanyAdmin, getPdfDataFromMailbox);

router.post("/upload-pdf",
    requireCompanyAdmin,
    upload.fields([
        { name: "pdfFile", maxCount: 50 },
        { name: "pdfFiles", maxCount: 50 },
        { name: "emlFile", maxCount: 50 },
        { name: "emlFiles", maxCount: 50 },
        { name: "msgFile", maxCount: 50 },
        { name: "msgFiles", maxCount: 50 },
    ]),
    uploadMultiplePdf
);


module.exports = router;
