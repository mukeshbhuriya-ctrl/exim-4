require("#controllers/company/admin/process/pdf/pdfdata");
require("#controllers/company/admin/process/sales/salesdata");

const { getCurrentSbMonthAndYear } = require("#utils/chaData");
const { mergeChaDataToSales } = require("#controllers/company/admin/cha/match_process");

/** Automation step 5_merge_cha_data — GET /merge-cha-data-to-sales. */
async function runMergeChaAutomationStep(companyId, options = {}) {
  const sbMonthAndYear = options.sbMonthAndYear || getCurrentSbMonthAndYear();

  const result = await mergeChaDataToSales(companyId, {
    sbMonthAndYear,
    gstin: options.gstin,
  });

  const summary = {
    sbMonthAndYear: result.sbMonthAndYear,
    batchId: result.batchId,
    message: result.message,
    matched: result.matched,
    chaRowCount: result.chaRowCount,
    totalChaRowCount: result.totalChaRowCount,
    pending: result.pending,
    droppedGroups: result.droppedGroups,
  };

  return {
    success: true,
    message: result.message || `${result.matched ?? 0} CHA row(s) matched to sales.`,
    summary,
  };
}

module.exports = {
  runMergeChaAutomationStep,
};
