const {
  SiteAdmin,
  normalizeEmail,
  sanitizeSiteAdmin,
  clearSiteAdminAuthCookie,
  setSiteAdminAuthCookie,
  signSiteAdminToken,
} = require("#utils/siteadmin");

async function loginSiteAdmin(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const siteAdmin = await SiteAdmin.findOne({ email });

    if (!siteAdmin || !siteAdmin.verifyPassword(password)) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (!siteAdmin.isActive) {
      return res.status(403).json({
        success: false,
        message: "This siteadmin account has been disabled.",
      });
    }

    siteAdmin.lastLoginAt = new Date();
    await siteAdmin.save();
    const token = signSiteAdminToken(siteAdmin);

    setSiteAdminAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      siteAdmin: sanitizeSiteAdmin(siteAdmin),
    });
  } catch (error) {
    return next(error);
  }
}

function logoutSiteAdmin(req, res) {
  clearSiteAdminAuthCookie(res);

  return res.status(200).json({
    success: true,
    message: "Logout successful.",
  });
}

function getCurrentSiteAdmin(req, res) {
  return res.status(200).json({
    success: true,
    siteAdmin: sanitizeSiteAdmin(req.siteAdmin),
  });
}

module.exports = {
  getCurrentSiteAdmin,
  loginSiteAdmin,
  logoutSiteAdmin,
};
