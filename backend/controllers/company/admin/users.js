const { User, generateTemporaryPassword, normalizeName, sanitizeUser } = require("#utils/user");
const { normalizeEmail } = require("#utils/siteadmin");
const { hashCompanyUserPassword } = require("#utils/companyUserPassword");
const { UserRole } = require("#utils/userRole");

async function getUsers(req, res, next) {
  try {
    const users = await User.find({ companyId: req.companyId }).lean();

    // Fetch user roles
    const userRoles = await UserRole.find({ companyId: req.companyId, isActive: true }).populate('roleId').lean();
    const userRoleMap = userRoles.reduce((acc, curr) => {
      acc[curr.userId.toString()] = curr.roleId;
      return acc;
    }, {});

    const enrichedUsers = users.map(u => {
      const sanitized = sanitizeUser(u);
      return {
        ...sanitized,
        assignedRole: userRoleMap[u._id.toString()] || null
      };
    });

    return res.status(200).json({ success: true, users: enrichedUsers });
  } catch (error) {
    next(error);
  }
}

const { Company } = require("#utils/company");
const { sendUserWelcomeEmail } = require("#utils/mail");
const { Role } = require("#utils/role");

async function createUser(req, res, next) {
  try {
    const usersArray = req.body.users || [req.body];
    const createdUsers = [];
    const errors = [];

    const company = await Company.findById(req.companyId).lean();
    const companyName = company ? company.name : "Your Company";

    const roles = await Role.find({ companyId: req.companyId }).lean();
    const roleMap = roles.reduce((acc, r) => ({ ...acc, [r._id.toString()]: r.businessName }), {});

    for (const userData of usersArray) {
      const { name, email, roleId } = userData;
      if (!name || !email || !roleId) {
        errors.push({ email, message: "Missing required fields." });
        continue;
      }

      const normalizedEmail = normalizeEmail(email);
      const existing = await User.findOne({ email: normalizedEmail });

      if (existing) {
        errors.push({ email, message: "Email already exists." });
        continue;
      }

      const tempPassword = generateTemporaryPassword();
      const newUser = await User.create({
        companyId: req.companyId,
        name: normalizeName(name),
        email: normalizedEmail,
        passwordHash: hashCompanyUserPassword(tempPassword),
        role: "user",
        defaultPassword: true,
        isActive: true,
        createdBy: req.companyUser._id
      });

      let roleName = "User";
      if (roleId) {
        await UserRole.create({
          companyId: req.companyId,
          userId: newUser._id,
          roleId,
          assignedBy: req.companyUser._id
        });
        roleName = roleMap[roleId] || "User";
      }

      try {
        await sendUserWelcomeEmail({
          companyName,
          recipientEmail: normalizedEmail,
          recipientName: normalizeName(name),
          temporaryPassword: tempPassword,
          roleName
        });
      } catch (err) {
        console.error("Failed to send welcome email to", normalizedEmail, err);
      }

      createdUsers.push({
        user: sanitizeUser(newUser),
        temporaryPassword: tempPassword
      });
    }

    if (createdUsers.length === 0 && errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0].message, errors });
    }

    return res.status(201).json({
      success: true,
      createdUsers,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    next(error);
  }
}

async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const { name, roleId, isActive } = req.body;

    const user = await User.findOne({ _id: id, companyId: req.companyId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (name !== undefined) user.name = normalizeName(name);
    if (isActive !== undefined) user.isActive = isActive;
    await user.save();

    if (roleId !== undefined) {
      // Upsert UserRole mapping
      await UserRole.findOneAndUpdate(
        { companyId: req.companyId, userId: user._id },
        { roleId, assignedBy: req.companyUser._id, isActive: true },
        { upsert: true, new: true }
      );
    }

    return res.status(200).json({ success: true, message: "User updated successfully." });
  } catch (error) {
    next(error);
  }
}

async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;
    const user = await User.findOne({ _id: id, companyId: req.companyId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Instead of hard deleting, we might want to just deactivate, or hard delete if they haven't done much.
    // Let's hard delete them and their roles for clean slate, or just set isActive = false.
    // The user requested delete, so we'll actually delete the user and their role mappings.
    await UserRole.deleteMany({ userId: user._id, companyId: req.companyId });
    await User.findByIdAndDelete(user._id);

    return res.status(200).json({ success: true, message: "User deleted successfully." });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getUsers,
  createUser,
  updateUser,
  deleteUser
};
