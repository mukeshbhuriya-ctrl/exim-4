const express = require("express");
const {
  processDgft,
  processRandomTenDgft,
  processAllDgftMarkedShippingBills,
  listDgftProcessInputs,
  listDgftProcessDays,
  getDgftProcessDayDetail,
  searchDgftBySbNo,
  getDgftProcessTableRowsById,
  getCountOfUnfetchedDgftShippingBills,
  processDgftShippingBill,
} = require("#controllers/company/admin/djft/djft");
const { requireCompanyAdmin } = require("#utils/companyUserAuth");

const router = express.Router();

router.post("/process-random-ten", requireCompanyAdmin, processRandomTenDgft);


router.post("/process-all-dgft-marked", requireCompanyAdmin, processAllDgftMarkedShippingBills);



// get api for GDFT record page
router.get("/process-inputs", requireCompanyAdmin, listDgftProcessInputs);

// day-wise batch list + detail (like SB process-shipping-bill-dates / date-wise-detail)
router.get("/process-days", requireCompanyAdmin, listDgftProcessDays);
router.get("/process-day-detail", requireCompanyAdmin, getDgftProcessDayDetail);

router.post("/search-by-sb-no", requireCompanyAdmin, searchDgftBySbNo);

router.get("/process-table-rows", requireCompanyAdmin, getDgftProcessTableRowsById);

router.get("/get-count-of-unfetched-dgft-shipping-bills", requireCompanyAdmin, getCountOfUnfetchedDgftShippingBills);

// scrap api for gfl data insert
// router.post("/process-dgft-shipping-bill", requireCompanyAdmin, processDgftShippingBill);

// manual process page api
router.post("/process", requireCompanyAdmin, processDgft);

module.exports = router;
