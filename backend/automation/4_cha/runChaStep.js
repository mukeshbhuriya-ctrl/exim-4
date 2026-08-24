const { getCurrentSbMonthAndYear } = require("#utils/chaData");
const { runChaFetchWithoutOtpForCompany } = require("#controllers/company/admin/cha/cha");

/** Automation step 4_cha — GET /start-current-month-process-without-otp. */
async function runChaAutomationStep(companyId, options = {}) {
  const sbMonthAndYear = options.sbMonthAndYear || getCurrentSbMonthAndYear();

  const result = await runChaFetchWithoutOtpForCompany(companyId, {
    sbMonthAndYear,
    apiTimeoutMs: options.apiTimeoutMs,
    sectionIndex: options.sectionIndex,
    roleId: options.roleId,
  });

  const summary = {
    sbMonthAndYear: result.sbMonthAndYear,
    totalSections: result.totalSections,
    processedSections: result.processedSections,
    failedSections: result.failedSections,
    accounts: result.accounts,
    errors: result.errors,
  };

  if (!result.success) {
    return {
      success: false,
      message: result.message,
      summary,
    };
  }

  return {
    success: true,
    message: result.message,
    summary,
  };
}

module.exports = {
  runChaAutomationStep,
};
