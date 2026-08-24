const {
  normalizePdfGmailBody,
  sanitizePdfGmailCred,
  getPdfGmailCred,
  savePdfGmailCred,
  updatePdfGmailRefreshToken,
  formatRefreshTokenForResponse,
  loadConfigure,
  sanitizePdfSection,
} = require("#utils/configure");

function normalizePdfGmailFetchCredBody(body = {}) {
  return normalizePdfGmailBody(body);
}

function sanitizePdfGmailFetchCred(doc) {
  if (!doc) return null;

  return {
    id: doc._id?.toString?.() || String(doc._id),
    companyId: doc.companyId?.toString?.() || String(doc.companyId),
    pdf: sanitizePdfSection(doc.pdf || {}, { updatedAt: doc.updatedAt }),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function getPdfGmailFetchCred(companyId) {
  const doc = await loadConfigure(companyId);
  if (!doc?.pdf?.gmail) return null;

  const gmail = doc.pdf.gmail;
  const hasData =
    gmail.clientId ||
    gmail.clientSecret ||
    gmail.fromLabelName ||
    gmail.toLabelName ||
    gmail.refreshToken != null;

  if (!hasData) return null;
  return sanitizePdfGmailFetchCred(doc);
}

module.exports = {
  normalizePdfGmailFetchCredBody,
  sanitizePdfGmailFetchCred,
  sanitizePdfGmailCred,
  sanitizePdfSection,
  formatRefreshTokenForResponse,
  getPdfGmailFetchCred,
  getPdfGmailCred,
  savePdfGmailCred,
  updatePdfGmailRefreshToken,
};
