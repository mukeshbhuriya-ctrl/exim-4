const { runScrapeShippingBillForCompany } = require("#controllers/company/admin/sb/sb");

/** Automation step 6_sbonline — POST /process-shipping-bill (unfetched SBs from PDF registry). */
async function runSbAutomationStep(companyId, options = {}) {
  const result = await runScrapeShippingBillForCompany(companyId, {
    onlyUnprocessed: true,
    treatEmptyAsSuccess: true,
    fetchUsing: options.fetchUsing || "dricat",
  });

  if (!result.success) {
    return {
      success: false,
      message: result.message,
      summary: result.summary ?? null,
    };
  }

  return {
    success: true,
    message: result.message,
    summary: result.summary,
  };
}

module.exports = {
  runSbAutomationStep,
};
