const express = require("express");

const {
  getSbOnlineDates,
  getShippingBillDateWiseDetail,
  searchShippingBillsBySbNo,
  scrapeShippingBill,
  processRandomTenShippingBills,
  processShippingBillByDate,
  listShippingBillExcelBatches,
  getShippingBillExcelBatchDetail,
  getCountOfUnfetchedShippingBills,
} = require("#controllers/company/admin/sb/sb");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");
const { upload } = require("#utils/multer");

const router = express.Router();

router.get(
  "/process-shipping-bill-dates",
  requireCompanyAdmin,
  getSbOnlineDates
);
router.get(
  "/process-shipping-bill-date-wise-detail",
  requireCompanyAdmin,
  getShippingBillDateWiseDetail
);

router.post("/search-by-sb-no", requireCompanyAdmin, searchShippingBillsBySbNo);

router.post("/process-shipping-bill", requireCompanyAdmin, scrapeShippingBill);

router.post("/process-random-ten-shipping-bills", requireCompanyAdmin, processRandomTenShippingBills);

router.get("/get-count-of-unfetched-shipping-bills", requireCompanyAdmin, getCountOfUnfetchedShippingBills);



router.post(
  "/batch-process-shipping",
  requireCompanyAdmin,
  upload.fields([
    { name: "excel", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  processShippingBillByDate
);



router.get(
  "/batch-process-shipping-batches",
  requireCompanyAdmin,
  listShippingBillExcelBatches
);
router.get(
  "/batch-process-shipping-batch-detail",
  requireCompanyAdmin,
  getShippingBillExcelBatchDetail
);





module.exports = router;
