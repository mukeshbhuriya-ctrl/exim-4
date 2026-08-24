const {
  normalizePdfOutlookBody,
  sanitizePdfOutlookCred,
  getPdfOutlookCred,
  savePdfOutlookCred,
  updatePdfOutlookOAuthTokens,
  formatRefreshTokenForResponse,
  loadConfigure,
  sanitizePdfSection,
} = require("#utils/configure");

function normalizePdfOutlookFetchCredBody(body = {}) {
  return normalizePdfOutlookBody(body);
}

function sanitizePdfOutlookFetchCred(doc) {
  if (!doc) return null;

  return {
    id: doc._id?.toString?.() || String(doc._id),
    companyId: doc.companyId?.toString?.() || String(doc.companyId),
    pdf: sanitizePdfSection(doc.pdf || {}, { updatedAt: doc.updatedAt }),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function getPdfOutlookFetchCred(companyId) {
  const doc = await loadConfigure(companyId);
  if (!doc?.pdf?.outlook) return null;

  const outlook = doc.pdf.outlook;
  const mailboxEmail = String(
    outlook.mailboxEmail || outlook.accountEmail || ""
  ).trim();
  const hasData =
    outlook.tenantId ||
    outlook.clientId ||
    outlook.clientSecret ||
    mailboxEmail ||
    outlook.fromFolderName ||
    outlook.toFolderName;

  if (!hasData) return null;
  return sanitizePdfOutlookFetchCred(doc);
}

module.exports = {
  normalizePdfOutlookFetchCredBody,
  sanitizePdfOutlookFetchCred,
  sanitizePdfOutlookCred,
  sanitizePdfSection,
  formatRefreshTokenForResponse,
  getPdfOutlookFetchCred,
  getPdfOutlookCred,
  savePdfOutlookCred,
  updatePdfOutlookOAuthTokens,
};
