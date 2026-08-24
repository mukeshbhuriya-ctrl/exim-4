const {
  getPdfMailboxStatus,
  setPdfMailboxProvider,
  sanitizePdfSection,
} = require("#utils/configure");

async function getPdfMailboxConfig(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const status = await getPdfMailboxStatus(companyId);

    return res.status(200).json({
      success: true,
      provider: status.provider,
      gmail: status.gmail,
      outlook: status.outlook,
      message: status.provider
        ? `Active PDF mailbox provider is ${status.provider}.`
        : "No active PDF mailbox provider selected.",
    });
  } catch (error) {
    return next(error);
  }
}

async function selectPdfMailboxProvider(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const provider = req.body?.provider;
    const doc = await setPdfMailboxProvider(companyId, provider);

    return res.status(200).json({
      success: true,
      message: `PDF mailbox provider set to ${provider}.`,
      pdf: sanitizePdfSection(doc?.pdf || {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, message });
  }
}

module.exports = {
  getPdfMailboxConfig,
  selectPdfMailboxProvider,
};
