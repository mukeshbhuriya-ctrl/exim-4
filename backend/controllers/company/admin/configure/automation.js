const {
  loadConfigure,
  sanitizeAutomationSection,
  upsertAutomationSettings,
} = require("#utils/configure");
const { getAutomationLogsForCompany } = require("#utils/automationLog");
const { validateRequestCompanyId } = require("#utils/requestCompanyId");
const { getMissingSalesSapDatesForRecentDays } = require("#utils/salesSapReceiveLog");

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return Boolean(value);
}

function parseDataStartFrom(value, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) {
      return { error: "`dataStartFrom` is required when sales automation is enabled." };
    }
    return { value: "" };
  }

  const raw = String(value).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!isoMatch) {
    return { error: "`dataStartFrom` must be a valid date (YYYY-MM-DD)." };
  }

  const year = Number(isoMatch[1]);
  const month = Number(isoMatch[2]);
  const day = Number(isoMatch[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return { error: "`dataStartFrom` must be a valid date (YYYY-MM-DD)." };
  }

  return { value: raw };
}

function parseEffectiveDays(value, fieldName) {
  if (value == null || value === "") {
    return { error: `\`${fieldName}\` is required when sales automation is enabled.` };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 31) {
    return {
      error: `\`${fieldName}\` must be a non-negative integer between 0 and 31.`,
    };
  }
  return { value: n };
}

function normalizeAutomationBody(body = {}) {
  const salesBody = body.sales && typeof body.sales === "object" ? body.sales : {};
  const pdfBody = body.pdf && typeof body.pdf === "object" ? body.pdf : {};
  const jvBody = body.jv && typeof body.jv === "object" ? body.jv : {};

  const salesEnabled = parseBoolean(salesBody.enabled);
  const pdfEnabled = parseBoolean(pdfBody.enabled);
  const jvEnabled = parseBoolean(jvBody.enabled);

  let dataStartFrom = salesBody.dataStartFrom;
  let monthStartEffectiveDays = salesBody.monthStartEffectiveDays;
  let monthEndEffectiveDays = salesBody.monthEndEffectiveDays;

  if (salesEnabled) {
    const dataStart = parseDataStartFrom(dataStartFrom, { required: true });
    if (dataStart.error) return { error: dataStart.error };
    dataStartFrom = dataStart.value;

    const start = parseEffectiveDays(monthStartEffectiveDays, "monthStartEffectiveDays");
    if (start.error) return { error: start.error };
    monthStartEffectiveDays = start.value;

    const end = parseEffectiveDays(monthEndEffectiveDays, "monthEndEffectiveDays");
    if (end.error) return { error: end.error };
    monthEndEffectiveDays = end.value;
  } else {
    const dataStart = parseDataStartFrom(dataStartFrom, { required: false });
    if (dataStart.error) return { error: dataStart.error };
    dataStartFrom = dataStart.value;

    if (monthStartEffectiveDays != null && monthStartEffectiveDays !== "") {
      const start = parseEffectiveDays(monthStartEffectiveDays, "monthStartEffectiveDays");
      if (start.error) return { error: start.error };
      monthStartEffectiveDays = start.value;
    } else {
      monthStartEffectiveDays = 0;
    }

    if (monthEndEffectiveDays != null && monthEndEffectiveDays !== "") {
      const end = parseEffectiveDays(monthEndEffectiveDays, "monthEndEffectiveDays");
      if (end.error) return { error: end.error };
      monthEndEffectiveDays = end.value;
    } else {
      monthEndEffectiveDays = 0;
    }
  }

  return {
    payload: {
      sales: {
        enabled: salesEnabled,
        dataStartFrom,
        monthStartEffectiveDays,
        monthEndEffectiveDays,
      },
      pdf: {
        enabled: pdfEnabled,
      },
      jv: {
        enabled: jvEnabled,
      },
    },
  };
}

/**
 * GET /api/company/admin/configure/automation
 */
async function getAutomationSettings(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const doc = await loadConfigure(req.companyId);
    const automation = sanitizeAutomationSection(doc);

    return res.status(200).json({
      success: true,
      automation,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/company/admin/configure/automation
 */
async function saveAutomationSettings(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const normalized = normalizeAutomationBody(req.body || {});
    if (normalized.error) {
      return res.status(400).json({
        success: false,
        message: normalized.error,
      });
    }

    await upsertAutomationSettings(req.companyId, normalized.payload);

    const doc = await loadConfigure(req.companyId);
    const automation = sanitizeAutomationSection(doc);

    return res.status(200).json({
      success: true,
      message: "Automation settings saved.",
      automation,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/company/admin/configure/automation/sales-cooling-days
 * Body: { "companyid": "..." }
 */
async function getSalesCoolingDays(req, res, next) {
  try {
    const companyId = validateRequestCompanyId(req, res);
    if (!companyId) return;

    const doc = await loadConfigure(companyId);
    const automation = sanitizeAutomationSection(doc);
    const sales = automation?.sales || {};

    return res.status(200).json({
      success: true,
      monthStartEffectiveDays: sales.monthStartEffectiveDays ?? 0,
      monthEndEffectiveDays: sales.monthEndEffectiveDays ?? 0,
      dataStartFrom: sales.dataStartFrom || "",
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/company/admin/configure/automation/get-automation-logs
 * Returns automation process status for the past 30 days (query: ?days=30).
 */
async function getAutomationLogs(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const days = Number.parseInt(String(req.query.days ?? "30"), 10);
    const logs = await getAutomationLogsForCompany(req.companyId, days);

    return res.status(200).json({
      success: true,
      days: Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 30,
      logs,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/company/admin/configure/automation/sap-missing-dates-logs
 * Body/query: { companyid?, days? }
 * Same missing-date logic as POST /process/sales/sap-missing-dates, for automation logs.
 */
async function getSapMissingDatesLogs(req, res, next) {
  try {
    const companyId = validateRequestCompanyId(req, res);
    if (!companyId) return;

    const configureDoc = await loadConfigure(companyId);
    const automation = sanitizeAutomationSection(configureDoc);
    const dataStartFrom = automation?.sales?.dataStartFrom || "";
    const daysRaw = Number.parseInt(
      String(req.body?.days ?? req.query?.days ?? "60"),
      10
    );
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 60;

    const summary = await getMissingSalesSapDatesForRecentDays(companyId, {
      dataStartFrom,
      days,
    });

    return res.status(200).json({
      success: true,
      ...summary,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getAutomationSettings,
  saveAutomationSettings,
  getSalesCoolingDays,
  getAutomationLogs,
  getSapMissingDatesLogs,
};
