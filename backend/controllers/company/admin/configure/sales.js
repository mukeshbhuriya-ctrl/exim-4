const {
  getStoredSapCredentials,
  upsertSapCredentials,
  sanitizeSapCred,
  loadConfigure,
  sanitizeSalesConfigureSection,
} = require("#utils/configure");

/**
 * GET /api/company/admin/configure/sales/get-sap-credential?companyId=...
 * Returns SAP id, password, report TCODE, and upload TCODE for the given company.
 */
async function getSapCredentialByCompanyId(req, res, next) {
  try {
    const companyId = String(req.query.companyId ?? req.body?.companyId ?? "").trim();
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "Provide `companyId` as a query parameter.",
      });
    }

    const stored = await getStoredSapCredentials(companyId);
    if (!stored) {
      return res.status(404).json({
        success: false,
        companyId,
        message: "SAP credentials are not configured for this company.",
      });
    }

    return res.status(200).json({
      success: true,
      companyId,
      id: stored.id,
      password: stored.password,
      sapConnection: stored.sapConnection,
      SAP_CONNECTION: stored.SAP_CONNECTION,
      connection: stored.connection,
      reportTcode: stored.reportTcode,
      REPORT_TCODE: stored.REPORT_TCODE,
      uploadTcode: stored.uploadTcode,
      UPLOAD_TCODE: stored.UPLOAD_TCODE,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/company/admin/configure/sales/credential
 * Returns SAP id/password/reportTcode/uploadTcode for this company from `configure.sales.sap`.
 */
async function getSapCredential(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const doc = await loadConfigure(req.companyId);
    const sales = sanitizeSalesConfigureSection(doc);

    return res.status(200).json({
      success: true,
      sales,
      sap: sales.sap,
      configured: sales.sap.configured === true,
      source: sales.sap.configured ? "database" : "none",
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/company/admin/configure/sales/credential
 * Body: { id, password, sapConnection, reportTcode, uploadTcode } — stores SAP credentials in `configure.sales.sap`.
 */
async function createSapCredential(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const body = req.body || {};
    const id = body.id ?? body.username ?? body.userId ?? body.sapId ?? "";
    const password = body.password ?? "";
    const sapConnection =
      body.sapConnection ??
      body.sap_connection ??
      body.SAP_CONNECTION ??
      body.connection ??
      "";
    const reportTcode = body.reportTcode ?? body.report_tcode ?? body.REPORT_TCODE ?? "";
    const uploadTcode = body.uploadTcode ?? body.upload_tcode ?? body.UPLOAD_TCODE ?? "";

    if (
      !String(id).trim() ||
      !String(password).length ||
      !String(sapConnection).trim() ||
      !String(reportTcode).trim() ||
      !String(uploadTcode).trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Provide `id`, `password`, `sapConnection`, `reportTcode`, and `uploadTcode` for SAP (or `SAP_CONNECTION` / `REPORT_TCODE` / `UPLOAD_TCODE` aliases).",
      });
    }

    const existing = await getStoredSapCredentials(req.companyId);
    await upsertSapCredentials(
      req.companyId,
      String(id).trim(),
      String(password),
      String(reportTcode).trim(),
      String(uploadTcode).trim(),
      String(sapConnection).trim()
    );

    const doc = await loadConfigure(req.companyId);
    const sales = sanitizeSalesConfigureSection(doc);

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? "SAP credentials updated." : "SAP credentials saved.",
      sales,
      sap: sales.sap,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getSapCredential,
  getSapCredentialByCompanyId,
  createSapCredential,
};
