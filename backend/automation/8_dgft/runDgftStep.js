const { runProcessAllDgftMarkedForCompany } = require("#controllers/company/admin/djft/djft");

/** Automation step 8_dgft — process all shippingbillno rows where dgft=true. */
async function runDgftAutomationStep(companyId, options = {}) {
  const result = await runProcessAllDgftMarkedForCompany(companyId, {
    treatEmptyAsSuccess: true,
    fetchUsing: options.fetchUsing || "dricat",
    body: options.body || {},
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
    summary: result.summary ?? null,
  };
}

module.exports = {
  runDgftAutomationStep,
};
