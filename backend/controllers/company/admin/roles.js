const { Role } = require("#utils/role");
const { UserRole } = require("#utils/userRole");

async function getRoles(req, res, next) {
  try {
    const roles = await Role.find({ companyId: req.companyId }).lean();
    
    // Calculate users assigned to each role
    const roleStats = await UserRole.aggregate([
      { $match: { companyId: req.companyId } },
      { $group: { _id: "$roleId", count: { $sum: 1 } } }
    ]);
    
    const countMap = roleStats.reduce((acc, curr) => {
      acc[curr._id.toString()] = curr.count;
      return acc;
    }, {});

    const enrichedRoles = roles.map(role => ({
      ...role,
      assignedUsers: countMap[role._id.toString()] || 0
    }));

    return res.status(200).json({ success: true, roles: enrichedRoles });
  } catch (error) {
    next(error);
  }
}

async function createRole(req, res, next) {
  try {
    const { businessName, identifier, description, policies } = req.body;
    
    const existing = await Role.findOne({ companyId: req.companyId, identifier: String(identifier).toUpperCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: "A role with this identifier already exists." });
    }

    const newRole = await Role.create({
      companyId: req.companyId,
      businessName,
      identifier: String(identifier).toUpperCase(),
      description,
      policies: policies || [],
      createdBy: req.companyUser._id
    });

    return res.status(201).json({ success: true, role: newRole });
  } catch (error) {
    next(error);
  }
}

async function updateRole(req, res, next) {
  try {
    const { id } = req.params;
    const { businessName, description, policies, isActive } = req.body;

    const role = await Role.findOne({ _id: id, companyId: req.companyId });
    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found." });
    }

    if (businessName !== undefined) role.businessName = businessName;
    if (description !== undefined) role.description = description;
    if (policies !== undefined) role.policies = policies;
    if (isActive !== undefined) role.isActive = isActive;

    await role.save();

    return res.status(200).json({ success: true, role });
  } catch (error) {
    next(error);
  }
}

async function deleteRole(req, res, next) {
  try {
    const { id } = req.params;

    const role = await Role.findOne({ _id: id, companyId: req.companyId });
    if (!role) return res.status(404).json({ success: false, message: "Role not found." });

    if (role.isSystemRole) {
      return res.status(403).json({ success: false, message: "Cannot delete a system role." });
    }

    const usersUsingRole = await UserRole.countDocuments({ roleId: id, companyId: req.companyId });
    if (usersUsingRole > 0) {
      return res.status(400).json({ success: false, message: `Cannot delete role. ${usersUsingRole} user(s) are currently assigned to it.` });
    }

    await Role.deleteOne({ _id: id });
    return res.status(200).json({ success: true, message: "Role deleted successfully." });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getRoles,
  createRole,
  updateRole,
  deleteRole
};
