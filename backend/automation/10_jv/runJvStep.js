const { createPendingJvSalesDataForCompany } = require("./jv_data_creation");
const { runProcessJvDbkForCompany } = require("#controllers/company/admin/jv/jvdbk");
const { runProcessJvRodtpForCompany } = require("#controllers/company/admin/jv/rodtp");

/** Automation step 10_jv — create pending jvsalesdata, then process-jv-dbk + process-jv-rodtp. */
async function runJvAutomationStep(companyId, options = {}) {
  const dbkBody = options.dbkBody && typeof options.dbkBody === "object" ? options.dbkBody : {};
  const rodtpBody = options.rodtpBody && typeof options.rodtpBody === "object" ? options.rodtpBody : {};

  const jvData = await createPendingJvSalesDataForCompany(companyId);
  if (!jvData.success) {
    return {
      success: false,
      message: jvData.message,
      summary: {
        jv_data_creation: jvData.summary ?? null,
        dbk: null,
        rodtp: null,
      },
    };
  }

  const dbk = await runProcessJvDbkForCompany(companyId, dbkBody);
  if (!dbk.success) {
    return {
      success: false,
      message: dbk.message,
      summary: {
        jv_data_creation: jvData.summary ?? null,
        dbk: dbk.summary ?? null,
        rodtp: null,
      },
    };
  }

  const rodtp = await runProcessJvRodtpForCompany(companyId, rodtpBody);
  const summary = {
    jv_data_creation: jvData.summary ?? null,
    dbk: dbk.summary ?? null,
    rodtp: rodtp.summary ?? null,
  };

  if (!rodtp.success) {
    return {
      success: false,
      message: rodtp.message,
      summary,
    };
  }

  return {
    success: true,
    message: `${jvData.message} ${dbk.message} ${rodtp.message}`.trim(),
    summary,
  };
}

module.exports = {
  runJvAutomationStep,
};
