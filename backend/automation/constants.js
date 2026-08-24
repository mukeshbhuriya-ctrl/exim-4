const AUTOMATION_PROCESSES = Object.freeze({
  SALES: "1_sales",
  PDF: "2_pdf",
  PROCESS: "3_process",
  CHA: "4_cha",
  MERGE_CHA_DATA: "5_merge_cha_data",
  SBONLINE: "6_sbonline",
  DGFT_BULK_DOWNLOAD: "7_dgft_bulk_download",
  DGFT: "8_dgft",
  JV: "10_jv",
});

const PROCESS_ORDER = Object.freeze([
  AUTOMATION_PROCESSES.SALES,
  AUTOMATION_PROCESSES.PDF,
  AUTOMATION_PROCESSES.PROCESS,
  AUTOMATION_PROCESSES.CHA,
  AUTOMATION_PROCESSES.MERGE_CHA_DATA,
  AUTOMATION_PROCESSES.SBONLINE,
  AUTOMATION_PROCESSES.DGFT_BULK_DOWNLOAD,
  AUTOMATION_PROCESSES.DGFT,
  AUTOMATION_PROCESSES.JV,
]);

const PROCESS_STATUS = Object.freeze({
  SKIP: "skip",
  SUCCESSFUL: "successful",
  FAILED: "failed",
  NOT_RUN: "not_run",
});

function createDefaultProcessEntry(status = PROCESS_STATUS.SKIP) {
  return { status, error: null, ranAt: null };
}

function createDefaultProcesses() {
  const processes = {};
  for (const key of PROCESS_ORDER) {
    processes[key] = createDefaultProcessEntry();
  }
  return processes;
}

module.exports = {
  AUTOMATION_PROCESSES,
  PROCESS_ORDER,
  PROCESS_STATUS,
  createDefaultProcessEntry,
  createDefaultProcesses,
};
