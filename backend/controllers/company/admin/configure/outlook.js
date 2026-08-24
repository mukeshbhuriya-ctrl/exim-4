const {
  normalizePdfOutlookFetchCredBody,
  sanitizePdfSection,
  savePdfOutlookCred,
  getPdfOutlookCred,
} = require("#utils/pdfOutlookFetchCred");
const { loadConfigure } = require("#utils/configure");

async function createOutlookCredential(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const payload = normalizePdfOutlookFetchCredBody(req.body);

    if (!payload.tenantId || !payload.clientId || !payload.clientSecret) {
      return res.status(400).json({
        success: false,
        message: "tenantId, clientId, and clientSecret are required.",
      });
    }

    if (!payload.mailboxEmail) {
      return res.status(400).json({
        success: false,
        message: "mailboxEmail is required.",
      });
    }

    if (!payload.fromFolderName || !payload.toFolderName) {
      return res.status(400).json({
        success: false,
        message: "fromFolderName and toFolderName are required.",
      });
    }

    const existing = await getPdfOutlookCred(companyId);
    const doc = await savePdfOutlookCred(companyId, payload);

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? "Outlook credentials updated." : "Outlook credentials created.",
      pdf: sanitizePdfSection(doc.pdf || { outlook: payload }, { updatedAt: doc.updatedAt }),
    });
  } catch (error) {
    return next(error);
  }
}

async function getOutlookCredential(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const doc = await loadConfigure(companyId);
    const pdf = sanitizePdfSection(doc?.pdf || {});

    return res.status(200).json({
      success: true,
      pdf,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createOutlookCredential,
  getOutlookCredential,
};
