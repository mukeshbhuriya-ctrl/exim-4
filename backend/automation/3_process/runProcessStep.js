require("#controllers/company/admin/process/pdf/pdfdata");
require("#controllers/company/admin/process/sales/salesdata");

const { runStartProcessForCompany } = require("#controllers/company/admin/process/process");

function compactSummary(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  delete out.stillUnmatchedSales;
  delete out.stillUnmatchedPdf;
  return out;
}

/** Automation step 3_process — POST /start-process (match sales rows to PDF rows). */
async function runProcessAutomationStep(companyId) {
  const result = await runStartProcessForCompany(companyId);
  const summary = compactSummary(result);

  if (!result.success) {
    return {
      success: false,
      message: result.message,
      summary,
    };
  }

  return {
    success: true,
    message: `${result.matchesSaved} sales↔PDF match(es) saved.`,
    summary,
  };
}

module.exports = {
  runProcessAutomationStep,
};
