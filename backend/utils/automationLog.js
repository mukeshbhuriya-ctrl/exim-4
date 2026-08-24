const mongoose = require("mongoose");
const {
  PROCESS_ORDER,
  PROCESS_STATUS,
  createDefaultProcesses,
} = require("../automation/constants");

const automationLogSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    processes: {
      type: mongoose.Schema.Types.Mixed,
      default: createDefaultProcesses,
    },
  },
  {
    collection: "automationlog",
    timestamps: true,
  }
);

automationLogSchema.index({ companyId: 1, date: 1 }, { unique: true });

const AutomationLog =
  mongoose.models.AutomationLog ||
  mongoose.model("AutomationLog", automationLogSchema);

function formatDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createNotRunProcesses() {
  const processes = createDefaultProcesses();
  for (const key of PROCESS_ORDER) {
    processes[key] = {
      status: PROCESS_STATUS.NOT_RUN,
      error: null,
      summary: null,
      ranAt: null,
    };
  }
  return processes;
}

function mapProcessesToObject(processes) {
  if (!processes) {
    return createDefaultProcesses();
  }

  if (processes instanceof Map) {
    const out = createDefaultProcesses();
    for (const [key, value] of processes.entries()) {
      out[key] = {
        status: value?.status || PROCESS_STATUS.SKIP,
        error: value?.error ?? null,
        summary: value?.summary ?? null,
        ranAt: value?.ranAt ?? null,
      };
    }
    return out;
  }

  if (typeof processes === "object") {
    const out = createDefaultProcesses();
    for (const key of PROCESS_ORDER) {
      const value = processes[key];
      if (!value) continue;
      out[key] = {
        status: value.status || PROCESS_STATUS.SKIP,
        error: value.error ?? null,
        summary: value.summary ?? null,
        ranAt: value.ranAt ?? null,
      };
    }
    return out;
  }

  return createDefaultProcesses();
}

function sanitizeAutomationLog(doc) {
  if (!doc) return null;

  return {
    id: doc._id.toString(),
    companyId: doc.companyId?.toString?.() || String(doc.companyId),
    date: doc.date,
    processes: mapProcessesToObject(doc.processes),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function upsertProcessStatus(companyId, dateKey, processKey, entry) {
  const oid = new mongoose.Types.ObjectId(String(companyId));
  const ranAt = entry.ranAt || new Date();
  const processEntry = {
    status: entry.status,
    error: entry.error ?? null,
    summary: entry.summary ?? null,
    ranAt,
  };

  const filter = { companyId: oid, date: dateKey };

  let doc = await AutomationLog.findOne(filter);
  if (!doc) {
    try {
      const processes = createDefaultProcesses();
      processes[processKey] = processEntry;
      doc = await AutomationLog.create({
        companyId: oid,
        date: dateKey,
        processes,
      });
      return sanitizeAutomationLog(doc);
    } catch (err) {
      if (err?.code !== 11000) {
        throw err;
      }
      doc = await AutomationLog.findOne(filter);
    }
  }

  if (!doc) {
    throw new Error("upsertProcessStatus: failed to load automation log document.");
  }

  const processes = mapProcessesToObject(doc.processes);
  processes[processKey] = processEntry;
  doc.set("processes", processes);
  await doc.save();

  return sanitizeAutomationLog(doc);
}

async function getAutomationLogsForCompany(companyId, days = 30) {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 90) : 30;
  const oid = new mongoose.Types.ObjectId(String(companyId));

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (safeDays - 1));

  const dateKeys = [];
  for (let i = 0; i < safeDays; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dateKeys.push(formatDateKey(d));
  }

  const docs = await AutomationLog.find({
    companyId: oid,
    date: { $in: dateKeys },
  })
    .sort({ date: -1 })
    .lean();

  const byDate = new Map(docs.map((doc) => [doc.date, doc]));

  return dateKeys
    .slice()
    .reverse()
    .map((date) => {
      const doc = byDate.get(date);
      if (!doc) {
        return {
          date,
          processes: createNotRunProcesses(),
        };
      }
      return {
        date: doc.date,
        processes: mapProcessesToObject(doc.processes),
        updatedAt: doc.updatedAt,
      };
    });
}

module.exports = {
  AutomationLog,
  formatDateKey,
  mapProcessesToObject,
  sanitizeAutomationLog,
  upsertProcessStatus,
  getAutomationLogsForCompany,
};
