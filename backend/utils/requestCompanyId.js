const mongoose = require("mongoose");

function resolveRequestCompanyId(req) {
  const query = req.query && typeof req.query === "object" ? req.query : {};
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

  const fromPayload = String(
    body.companyid ??
      body.companyId ??
      body.company_id ??
      query.companyid ??
      query.companyId ??
      query.company_id ??
      ""
  ).trim();
  const fromAuth = req.companyId ? String(req.companyId).trim() : "";
  return fromPayload || fromAuth;
}

function validateRequestCompanyId(req, res) {
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) {
    res.status(400).json({
      success: false,
      message: "Provide `companyid` in the request body.",
    });
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    res.status(400).json({
      success: false,
      message: "Invalid companyid.",
    });
    return null;
  }

  if (req.companyId && String(req.companyId) !== String(companyId)) {
    res.status(403).json({
      success: false,
      message: "companyid does not match the authenticated company.",
    });
    return null;
  }

  return companyId;
}

module.exports = {
  resolveRequestCompanyId,
  validateRequestCompanyId,
};
