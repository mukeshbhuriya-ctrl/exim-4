const mongoose = require("mongoose");

const {
  Company,
  normalizeCompanyPayload,
  sanitizeCompany,
} = require("#utils/company");
const { sendCompanyAdminWelcomeEmail } = require("#utils/mail");
const {
  User,
  buildUserPayload,
  createUserPayload,
  generateTemporaryPassword,
  sanitizeUser,
} = require("#utils/user");
const { UserRole } = require("#utils/userRole");
const { Role } = require("#utils/role");
const { seedSystemRolesForCompany } = require("#utils/roleSeeder");

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createCompany(req, res, next) {
  try {
    const payload = normalizeCompanyPayload(req.body);
    const userPayload = buildUserPayload(req.body);

    if (!payload.name) {
      return res.status(400).json({
        success: false,
        message: "Company name is required.",
      });
    }

    if (!userPayload.name) {
      return res.status(400).json({
        success: false,
        message: "Admin user name is required.",
      });
    }

    if (!userPayload.email) {
      return res.status(400).json({
        success: false,
        message: "Admin user email is required.",
      });
    }

    const existingCompany = await Company.findOne({
      name: new RegExp(`^${escapeRegex(payload.name)}$`, "i"),
    });

    if (existingCompany) {
      return res.status(409).json({
        success: false,
        message: "A company with this name already exists.",
      });
    }

    const existingUser = await User.findOne({ email: userPayload.email });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists.",
      });
    }

    let company = null;
    let user = null;
    const temporaryPassword = generateTemporaryPassword();

    try {
      company = await Company.create({
        ...payload,
        createdBy: req.siteAdmin._id,
      });

      user = await User.create(
        createUserPayload({
          companyId: company._id,
          createdBy: req.siteAdmin._id,
          name: userPayload.name,
          email: userPayload.email,
          temporaryPassword,
        })
      );

      company.adminUserId = user._id;
      await company.save();

      await seedSystemRolesForCompany(company._id);
      const adminRole = await Role.findOne({ companyId: company._id, identifier: "ADMIN" }).lean();
      if (adminRole) {
        await UserRole.create({
          companyId: company._id,
          userId: user._id,
          roleId: adminRole._id,
        });
      }
    } catch (error) {
      if (user?._id) {
        await User.findByIdAndDelete(user._id).catch(() => {});
      }

      if (company?._id) {
        await Company.findByIdAndDelete(company._id).catch(() => {});
      }

      return next(error);
    }

    let emailSent = false;
    let mailWarning = null;

    try {
      await sendCompanyAdminWelcomeEmail({
        companyName: company.name,
        recipientEmail: user.email,
        recipientName: user.name,
        temporaryPassword,
      });

      emailSent = true;
    } catch (error) {
      mailWarning = error.message;
    }

    return res.status(201).json({
      success: true,
      message: emailSent
        ? "Company and admin user created successfully."
        : "Company and admin user created, but email could not be sent.",
      company: sanitizeCompany(company),
      user: sanitizeUser(user),
      emailSent,
      ...(mailWarning
        ? {
            mailWarning,
            temporaryPassword,
          }
        : {}),
    });
  } catch (error) {
    return next(error);
  }
}

async function getCompanyList(req, res, next) {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 10, 1),
      100
    );
    const skip = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const filter = {};

    if (search) {
      const safeSearch = escapeRegex(search);

      filter.name = { $regex: safeSearch, $options: "i" };
    }

    if (req.query.isActive !== undefined) {
      filter.isActive = String(req.query.isActive).toLowerCase() === "true";
    }

    const [companies, total] = await Promise.all([
      Company.find(filter)
        .populate("adminUserId", "name email role defaultPassword isActive")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Company.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      companies: companies.map((company) => ({
        ...sanitizeCompany(company),
        adminUser: company.adminUserId ? sanitizeUser(company.adminUserId) : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getCompanyById(req, res, next) {
  try {
    const { companyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id.",
      });
    }

    const company = await Company.findById(companyId).populate(
      "adminUserId",
      "companyId name email role defaultPassword isActive createdAt updatedAt"
    );

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    return res.status(200).json({
      success: true,
      company: {
        ...sanitizeCompany(company),
        adminUser: company.adminUserId ? sanitizeUser(company.adminUserId) : null,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCompany,
  getCompanyById,
  getCompanyList,
};
