const {
  getCompanyUserTokenFromRequest,
  verifyCompanyUserToken,
} = require("#utils/siteadmin");
const { User } = require("#utils/user");

async function requireCompanyAdmin(req, res, next) {
  const token = getCompanyUserTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authorization is required.",
    });
  }

  try {
    const decoded = verifyCompanyUserToken(token);
    const user = await User.findById(decoded.sub);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Account is not available.",
      });
    }

    if (user.role !== "admin" && user.role !== "user") {
      return res.status(403).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    req.companyUser = user;
    req.companyId = user.companyId;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token is invalid or expired.",
    });
  }
}

module.exports = {
  requireCompanyAdmin,
};
