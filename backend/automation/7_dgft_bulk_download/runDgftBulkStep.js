const {
  getLastWeekMondayToSunday,
  getYesterdayDateRange,
  formatDdMmYyyy,
  isMonday,
  createPendingRequest,
  processPendingEbrcDownloadRequests,
} = require("#utils/ebrcBulkDownloadRequest");
const {
  runSubmitEbrcBulkDownloadForCompany,
  runFetchEbrcBulkDownloadRequestsForCompany,
  runDownloadEbrcAttachmentForCompany,
} = require("#controllers/company/admin/eBRC_Bulk_Download");

/**
 * Env `DGFT_BULK_DOWNLOAD_MODE`:
 * - `daily`  — submit every run for yesterday (from = to = yesterday)
 * - `weekly` — submit only on Monday for last week Mon–Sun (default)
 */
function resolveDgftBulkDownloadMode() {
  const raw = String(process.env.DGFT_BULK_DOWNLOAD_MODE || "weekly").trim().toLowerCase();
  if (raw === "daily" || raw === "day") return "daily";
  return "weekly";
}

function shouldSubmitDgftBulkRequest(referenceDate, mode) {
  if (mode === "daily") return true;
  return isMonday(referenceDate);
}

function getDgftBulkSubmitDateRange(referenceDate, mode) {
  if (mode === "daily") {
    return getYesterdayDateRange(referenceDate);
  }
  return getLastWeekMondayToSunday(referenceDate);
}

/**
 * Step 7 — eBRC bulk download automation.
 * 1. Submit request based on DGFT_BULK_DOWNLOAD_MODE:
 *    - daily: every run, yesterday only
 *    - weekly: Monday only, last week Mon–Sun
 * 2. Every run: fetch DGFT table, process pending rows with attachId → download, store, dgft=true on shippingbillno.
 */
async function runDgftBulkAutomationStep(companyId, options = {}) {
  const referenceDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
  const mode = resolveDgftBulkDownloadMode();
  const shouldSubmit = shouldSubmitDgftBulkRequest(referenceDate, mode);
  const summary = {
    mode,
    isMonday: isMonday(referenceDate),
    shouldSubmit,
  };

  if (shouldSubmit) {
    const { fromDate, toDate } = getDgftBulkSubmitDateRange(referenceDate, mode);
    const irmFromDate = formatDdMmYyyy(fromDate);
    const irmToDate = formatDdMmYyyy(toDate);

    summary.fromDate = irmFromDate;
    summary.toDate = irmToDate;

    console.log(
      `[${companyId}] 7_dgft_bulk_download step 1/2 (${mode}): submit request ${irmFromDate} → ${irmToDate}...`
    );

    const submitResult = await runSubmitEbrcBulkDownloadForCompany(companyId, {
      irmFromDate,
      irmToDate,
      searchType: options.searchType ?? "1",
      forceRefresh: false,
    });

    summary.submit = submitResult.summary || null;

    if (!submitResult.success) {
      return {
        success: false,
        message: submitResult.message,
        failedSubStep: "submit",
        summary,
      };
    }

    await createPendingRequest(companyId, {
      fromDate: irmFromDate,
      toDate: irmToDate,
      searchType: options.searchType ?? "1",
    });

    console.log(
      `[${companyId}] 7_dgft_bulk_download step 1/2: saved pending request in ebrcBulkDownloadRequest.`
    );
  } else {
    summary.submit = {
      skipped: true,
      reason: mode === "weekly" ? "not_monday" : "submit_disabled",
    };
    console.log(
      `[${companyId}] 7_dgft_bulk_download step 1/2 (${mode}): skip submit (weekly mode and today is not Monday).`
    );
  }

  console.log(
    `[${companyId}] 7_dgft_bulk_download step 2/2: check pending requests and download attachments...`
  );

  const fetchResult = await runFetchEbrcBulkDownloadRequestsForCompany(companyId, {
    forceRefresh: false,
  });

  summary.fetch = fetchResult.summary || null;

  if (!fetchResult.success) {
    return {
      success: false,
      message: fetchResult.message,
      failedSubStep: "fetch",
      summary,
    };
  }

  const processResult = await processPendingEbrcDownloadRequests(
    companyId,
    fetchResult.rows || [],
    runDownloadEbrcAttachmentForCompany
  );

  summary.processPending = processResult;

  console.log(
    `[${companyId}] 7_dgft_bulk_download step 2/2: ` +
      `${processResult.successful} successful, ${processResult.failed} failed, ` +
      `${processResult.stillPending} still pending.`
  );

  const stepFailed = processResult.failed > 0;
  let message;
  if (shouldSubmit) {
    message =
      mode === "daily"
        ? `eBRC bulk download submitted for yesterday (${summary.fromDate}); processed ${processResult.pendingCount} pending request(s).`
        : `eBRC bulk download submitted for ${summary.fromDate}–${summary.toDate}; processed ${processResult.pendingCount} pending request(s).`;
  } else {
    message = `Processed ${processResult.pendingCount} pending eBRC request(s) (submit skipped — weekly mode, not Monday).`;
  }

  return {
    success: !stepFailed,
    message: stepFailed
      ? `eBRC bulk download finished with ${processResult.failed} failed attachment(s).`
      : message,
    summary,
  };
}

module.exports = {
  runDgftBulkAutomationStep,
  resolveDgftBulkDownloadMode,
};
