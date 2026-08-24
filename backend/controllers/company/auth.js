const {
  normalizeEmail,
  setCompanyUserAuthCookie,
  signCompanyUserToken,
  verifyPassword,
} = require("#utils/siteadmin");
const { hashCompanyUserPassword } = require("#utils/companyUserPassword");
const { Company } = require("#utils/company");
const { User, sanitizeUser } = require("#utils/user");

async function resolveCompanyName(companyId) {
  if (!companyId) return "";
  const company = await Company.findById(companyId).select("name").lean();
  return String(company?.name || "").trim();
}

async function buildCompanyLoginResponse(user) {
  const sanitized = sanitizeUser(user);
  const companyName = await resolveCompanyName(user.companyId);
  return {
    email: sanitized.email,
    companyName,
    user: {
      ...sanitized,
      companyName,
    },
  };
}

async function loginCompanyUser(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const user = await User.findOne({ email });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account has been disabled.",
      });
    }

    if (user.defaultPassword) {
      return res.status(200).json({
        success: true,
        defaultPassword: true,
        message: "You must change your default password before signing in.",
        // user: sanitizeUser(user),
      });
    }

    const token = signCompanyUserToken(user);
    setCompanyUserAuthCookie(res, token);

    const profile = await buildCompanyLoginResponse(user);

    return res.status(200).json({
      success: true,
      defaultPassword: false,
      message: "Login successful.",
      token,
      email: profile.email,
      companyName: profile.companyName,
      user: profile.user,
    });
  } catch (error) {
    return next(error);
  }
}

async function changeDefaultPassword(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const oldPassword = String(
      req.body.oldPassword ?? req.body.old_password ?? ""
    );
    const newPassword = String(
      req.body.newPassword ?? req.body.new_password ?? ""
    );

    if (!email || !oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, old password, and new password are required.",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters.",
      });
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from the old password.",
      });
    }

    const user = await User.findOne({ email });

    if (!user || !verifyPassword(oldPassword, user.passwordHash)) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account has been disabled.",
      });
    }

    user.passwordHash = hashCompanyUserPassword(newPassword);
    user.defaultPassword = false;
    await user.save();

    const token = signCompanyUserToken(user);
    setCompanyUserAuthCookie(res, token);

    const profile = await buildCompanyLoginResponse(user);

    return res.status(200).json({
      success: true,
      defaultPassword: false,
      message: "Password updated successfully. You are now signed in.",
      token,
      email: profile.email,
      companyName: profile.companyName,
      user: profile.user,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  changeDefaultPassword,
  loginCompanyUser,
};
