const {
  SalesDataClean,
  normalizeColumnsInput,
  sanitizeSalesDataClean,
} = require("#utils/salesDataClean");

function requireCompany(req, res) {
  if (!req.companyId) {
    res.status(401).json({
      success: false,
      message: "Company admin access is required.",
    });
    return false;
  }
  return true;
}

function parseColumnsFromRequest(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const columns = normalizeColumnsInput(body);
  if (!columns.length) {
    const err = new Error("Provide at least one column in `columns` (columnName, type, removeDigits).");
    err.statusCode = 400;
    throw err;
  }
  return columns;
}

/**
 * GET /api/company/admin/initialization/sales-data-clean
 */
async function getSalesDataClean(req, res, next) {
  try {
    if (!requireCompany(req, res)) return;

    const doc = await SalesDataClean.findOne({ companyId: req.companyId }).lean();
    if (!doc) {
      return res.status(200).json({
        success: true,
        exists: false,
        message: "Sales data clean rules are not configured yet.",
        salesDataClean: { columns: [] },
      });
    }

    return res.status(200).json({
      success: true,
      exists: true,
      salesDataClean: sanitizeSalesDataClean(doc),
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/company/admin/initialization/sales-data-clean
 * Create cleaning rules (fails if already exists — use PUT to update).
 */
async function createSalesDataClean(req, res, next) {
  try {
    if (!requireCompany(req, res)) return;

    const columns = parseColumnsFromRequest(req);
    const existing = await SalesDataClean.findOne({ companyId: req.companyId }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Sales data clean rules already exist. Use PUT to update.",
        salesDataClean: sanitizeSalesDataClean(existing),
      });
    }

    const doc = await SalesDataClean.create({
      companyId: req.companyId,
      columns,
    });

    return res.status(201).json({
      success: true,
      message: "Sales data clean rules saved.",
      salesDataClean: sanitizeSalesDataClean(doc),
    });
  } catch (error) {
    if (error?.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

/**
 * PUT /api/company/admin/initialization/sales-data-clean
 * Update cleaning rules (full replace of columns array).
 */
async function updateSalesDataClean(req, res, next) {
  try {
    if (!requireCompany(req, res)) return;

    const columns = parseColumnsFromRequest(req);
    const doc = await SalesDataClean.findOneAndUpdate(
      { companyId: req.companyId },
      { $set: { columns } },
      { new: true }
    ).lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Sales data clean rules not found. Use POST to create first.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Sales data clean rules updated.",
      salesDataClean: sanitizeSalesDataClean(doc),
    });
  } catch (error) {
    if (error?.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

module.exports = {
  getSalesDataClean,
  createSalesDataClean,
  updateSalesDataClean,
};
