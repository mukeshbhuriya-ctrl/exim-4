const mongoose = require("mongoose");

const salesSapReceiveLogSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    reportDate: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    receivedAt: { type: Date, default: Date.now },
    storedRows: { type: Number, default: 0 },
    source: { type: String, default: "sap", trim: true },
    uploadId: { type: String, default: "", trim: true },
    /** Automation/SAP run log payload sent by frontend (`logs`). */
    logs: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    collection: "salessapreceivelog",
    timestamps: true,
  }
);

salesSapReceiveLogSchema.index({ companyId: 1, reportDate: 1 }, { unique: true });

const SalesSapReceiveLog =
  mongoose.models.SalesSapReceiveLog ||
  mongoose.model("SalesSapReceiveLog", salesSapReceiveLogSchema);

function formatDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidIsoDateParts(year, month, day) {
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

function parseToIsoDateKey(value) {
  if (value == null || value === "") {
    return { error: "Date is required." };
  }

  const raw = String(value).trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidIsoDateParts(year, month, day)) {
      return { error: `Invalid date: ${raw}` };
    }
    return { iso: raw };
  }

  match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (!isValidIsoDateParts(year, month, day)) {
      return { error: `Invalid date: ${raw}` };
    }
    return { iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  }

  match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (!isValidIsoDateParts(year, month, day)) {
      return { error: `Invalid date: ${raw}` };
    }
    return { iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  }

  return { error: `Invalid date format: ${raw}. Use YYYY-MM-DD or DD.MM.YYYY.` };
}

function formatSapReportDate(isoDate) {
  const parsed = parseToIsoDateKey(isoDate);
  if (parsed.error) return "";
  const [year, month, day] = parsed.iso.split("-");
  return `${day}.${month}.${year}`;
}

function expandIsoDateRange(isoStart, isoEnd) {
  const start = parseToIsoDateKey(isoStart);
  const end = parseToIsoDateKey(isoEnd);
  if (start.error) return { error: start.error };
  if (end.error) return { error: end.error };

  const [y1, m1, d1] = start.iso.split("-").map(Number);
  const [y2, m2, d2] = end.iso.split("-").map(Number);
  const from = new Date(y1, m1 - 1, d1);
  const to = new Date(y2, m2 - 1, d2);
  if (from.getTime() > to.getTime()) {
    return { error: "`REPORT_DATE_LOW` must be before or equal to `REPORT_DATE_HIGH`." };
  }

  const dates = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    dates.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return { dates };
}

function resolveSapReportDateRange(payload = {}) {
  const single =
    payload.dataDate ??
    payload.reportDate ??
    payload.date ??
    payload.data_date ??
    payload.report_date;

  if (single != null && String(single).trim() !== "") {
    const parsed = parseToIsoDateKey(single);
    if (parsed.error) return { error: parsed.error };
    const sapDate = formatSapReportDate(parsed.iso);
    return {
      dates: [parsed.iso],
      sapLow: sapDate,
      sapHigh: sapDate,
    };
  }

  const low =
    payload.REPORT_DATE_LOW ??
    payload.reportDateLow ??
    payload.report_date_low;
  const high =
    payload.REPORT_DATE_HIGH ??
    payload.reportDateHigh ??
    payload.report_date_high;

  if (low != null && String(low).trim() !== "" && high != null && String(high).trim() !== "") {
    const lowParsed = parseToIsoDateKey(low);
    if (lowParsed.error) return { error: lowParsed.error };
    const highParsed = parseToIsoDateKey(high);
    if (highParsed.error) return { error: highParsed.error };
    const range = expandIsoDateRange(lowParsed.iso, highParsed.iso);
    if (range.error) return { error: range.error };
    return {
      dates: range.dates,
      sapLow: formatSapReportDate(lowParsed.iso),
      sapHigh: formatSapReportDate(highParsed.iso),
    };
  }

  return {
    error:
      "Provide `dataDate` (single day) or both `REPORT_DATE_LOW` and `REPORT_DATE_HIGH`.",
  };
}

function collectReportDatesFromPayload(payload = {}) {
  const direct = resolveSapReportDateRange(payload);
  if (!direct.error) return direct;

  const list = payload.reportDates ?? payload.report_dates ?? payload.dataDates ?? payload.data_dates;
  if (Array.isArray(list) && list.length) {
    const dates = [];
    for (const item of list) {
      const parsed = parseToIsoDateKey(item);
      if (parsed.error) return { error: parsed.error };
      dates.push(parsed.iso);
    }
    return { dates: [...new Set(dates)].sort() };
  }

  return direct;
}

async function markSalesSapDatesReceived(companyId, dates, meta = {}) {
  const uniqueDates = [...new Set((Array.isArray(dates) ? dates : []).filter(Boolean))];
  if (!uniqueDates.length) return [];

  const storedRows = Number(meta.storedRows) || 0;
  const source = String(meta.source || "sap").trim() || "sap";
  const uploadId = String(meta.uploadId || "").trim();
  const receivedAt = meta.receivedAt instanceof Date ? meta.receivedAt : new Date();
  const hasLogs = Object.prototype.hasOwnProperty.call(meta, "logs");
  const logs = hasLogs ? meta.logs : undefined;

  const ops = uniqueDates.map((reportDate) => {
    const $set = {
      receivedAt,
      storedRows,
      source,
      uploadId,
    };
    if (hasLogs) {
      $set.logs = logs;
    }
    return {
      updateOne: {
        filter: { companyId, reportDate },
        update: { $set },
        upsert: true,
      },
    };
  });

  await SalesSapReceiveLog.bulkWrite(ops, { ordered: false });
  return uniqueDates;
}

async function getReceivedReportDates(companyId, isoStart, isoEnd) {
  const range = expandIsoDateRange(isoStart, isoEnd);
  if (range.error) return new Set();

  const docs = await SalesSapReceiveLog.find({
    companyId,
    reportDate: { $in: range.dates },
  })
    .select({ reportDate: 1 })
    .lean();

  return new Set(docs.map((doc) => doc.reportDate));
}

function getLastNDaysDateBounds(referenceDate = new Date(), dataStartFrom = "", days = 60) {
  const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const safeDays = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.trunc(Number(days)) : 60;
  const rangeEnd = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  rangeEnd.setDate(rangeEnd.getDate() - 1);
  const rangeStartCandidate = new Date(rangeEnd);
  rangeStartCandidate.setDate(rangeStartCandidate.getDate() - (safeDays - 1));

  let rangeStart = rangeStartCandidate;
  const startFrom = String(dataStartFrom || "").trim();
  if (startFrom) {
    const parsed = parseToIsoDateKey(startFrom);
    if (!parsed.error) {
      const [y, m, d] = parsed.iso.split("-").map(Number);
      const configuredStart = new Date(y, m - 1, d);
      if (configuredStart.getTime() > rangeStart.getTime()) {
        rangeStart = configuredStart;
      }
    }
  }

  const monthKey = `${rangeEnd.getFullYear()}-${String(rangeEnd.getMonth() + 1).padStart(2, "0")}`;

  if (rangeStart.getTime() > rangeEnd.getTime()) {
    return {
      monthKey,
      days: safeDays,
      from: formatDateKey(rangeStart),
      to: formatDateKey(rangeEnd),
      dates: [],
    };
  }

  const expanded = expandIsoDateRange(formatDateKey(rangeStart), formatDateKey(rangeEnd));
  return {
    monthKey,
    days: safeDays,
    from: formatDateKey(rangeStart),
    to: formatDateKey(rangeEnd),
    dates: expanded.error ? [] : expanded.dates,
  };
}

function getCurrentMonthDateBounds(referenceDate = new Date(), dataStartFrom = "") {
  const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month, ref.getDate());

  let rangeStart = monthStart;
  const startFrom = String(dataStartFrom || "").trim();
  if (startFrom) {
    const parsed = parseToIsoDateKey(startFrom);
    if (!parsed.error) {
      const [y, m, d] = parsed.iso.split("-").map(Number);
      const configuredStart = new Date(y, m - 1, d);
      if (configuredStart.getTime() > rangeStart.getTime()) {
        rangeStart = configuredStart;
      }
    }
  }

  if (rangeStart.getTime() > monthEnd.getTime()) {
    return { monthKey: `${year}-${String(month + 1).padStart(2, "0")}`, dates: [] };
  }

  const expanded = expandIsoDateRange(formatDateKey(rangeStart), formatDateKey(monthEnd));
  return {
    monthKey: `${year}-${String(month + 1).padStart(2, "0")}`,
    dates: expanded.error ? [] : expanded.dates,
  };
}

async function getMissingSalesSapDatesForRecentDays(companyId, options = {}) {
  const {
    referenceDate = new Date(),
    dataStartFrom = "",
    days = 60,
  } = options;
  const bounds = getLastNDaysDateBounds(referenceDate, dataStartFrom, days);
  if (!bounds.dates.length) {
    return {
      month: bounds.monthKey,
      days: bounds.days,
      from: bounds.from,
      to: bounds.to,
      data_start_from: String(dataStartFrom || "").trim() || null,
      missing_dates: [],
      received_dates: [],
      total_days: 0,
    };
  }

  const receivedSet = await getReceivedReportDates(
    companyId,
    bounds.dates[0],
    bounds.dates[bounds.dates.length - 1]
  );
  const received_dates = bounds.dates.filter((date) => receivedSet.has(date));
  const missing_dates = bounds.dates.filter((date) => !receivedSet.has(date));

  return {
    month: bounds.monthKey,
    days: bounds.days,
    from: bounds.from,
    to: bounds.to,
    data_start_from: String(dataStartFrom || "").trim() || null,
    missing_dates,
    received_dates,
    total_days: bounds.dates.length,
  };
}

async function getMissingSalesSapDatesForCurrentMonth(companyId, options = {}) {
  const { referenceDate = new Date(), dataStartFrom = "" } = options;
  const { monthKey, dates } = getCurrentMonthDateBounds(referenceDate, dataStartFrom);
  if (!dates.length) {
    return {
      month: monthKey,
      missing_dates: [],
      received_dates: [],
      total_days: 0,
    };
  }

  const receivedSet = await getReceivedReportDates(
    companyId,
    dates[0],
    dates[dates.length - 1]
  );
  const received_dates = dates.filter((date) => receivedSet.has(date));
  const missing_dates = dates.filter((date) => !receivedSet.has(date));

  return {
    month: monthKey,
    missing_dates,
    received_dates,
    total_days: dates.length,
  };
}

module.exports = {
  SalesSapReceiveLog,
  formatDateKey,
  parseToIsoDateKey,
  formatSapReportDate,
  expandIsoDateRange,
  resolveSapReportDateRange,
  collectReportDatesFromPayload,
  markSalesSapDatesReceived,
  getReceivedReportDates,
  getCurrentMonthDateBounds,
  getLastNDaysDateBounds,
  getMissingSalesSapDatesForRecentDays,
  getMissingSalesSapDatesForCurrentMonth,
};
