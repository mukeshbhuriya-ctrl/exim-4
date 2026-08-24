const { computeSalesInvPdfMatchCounts } = require("#controllers/company/admin/dashboard/salesInvMatchCounts");
const { computePdfSbMatchCounts } = require("#controllers/company/admin/dashboard/pdfSbMatchCounts");

/**
 * GET /get-sap-inv
 * Unique sales invoice counts grouped by processmatch link status to PDF rows.
 */
async function getSapInv(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const data = await computeSalesInvPdfMatchCounts(companyId);

    return res.status(200).json({
      success: true,
      message:
        "Sales invoice match summary: each unique inv value is counted once as matched, unmatched, or partially_matched.",
      data,
    });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) console.error("[getSapInv]", error);
    if (code < 500) {
      return res.status(code).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return next(error);
  }
}

/**
 * GET /get-pdf-sb
 * Unique PDF SB No counts grouped by processmatch link status to sales rows.
 */
async function getPdfSb(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const data = await computePdfSbMatchCounts(companyId);

    return res.status(200).json({
      success: true,
      message:
        "PDF SB No match summary: each unique SB No is counted once by how many of its PDF rows are linked to sales rows in processmatch.",
      data,
    });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) console.error("[getPdfSb]", error);
    if (code < 500) {
      return res.status(code).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return next(error);
  }
}

module.exports = {
  getSapInv,
  getPdfSb,
};
