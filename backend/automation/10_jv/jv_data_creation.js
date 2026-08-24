"use strict";

const mongoose = require("mongoose");
const { HeaderMapping, sanitizeHeaderMapping } = require("#utils/headerMapping");
const { loadConfigure, sanitizeAutomationSection } = require("#utils/configure");
const {
  processAndSaveJvSalesRows,
  normalizeInv,
} = require("#controllers/company/admin/process/sales/jvsalesdata");
const { extractInvFromSalesRow } = require("#utils/salesInvFinancialYearUniq");

/** Ensure SalesUploadRow model is registered. */
require("#controllers/company/admin/process/sales/salesdata");

function getSalesUploadRowModel() {
  return mongoose.models.SalesUploadRow;
}

async function isJvAutomationEnabled(companyId) {
  const doc = await loadConfigure(companyId);
  const automation = sanitizeAutomationSection(doc);
  return automation?.jv?.enabled === true;
}

/**
 * Create missing jvsalesdata for sales rows where:
 *   data.jv_date_null === false
 *   data.jv_data_create === false
 *
 * Only runs when configure automation.jv.enabled === true.
 * After jvsalesdata is created (or already exists), sets jv_data_create = true.
 */
async function createPendingJvSalesDataForCompany(companyId) {
  const jvEnabled = await isJvAutomationEnabled(companyId);
  if (!jvEnabled) {
    return {
      success: true,
      skipped: true,
      message: "JV automation disabled in configure settings.",
      summary: {
        jv_enabled: false,
        candidate_rows: 0,
        saved_rows: 0,
        updated_sales_rows: 0,
      },
    };
  }

  const headerMappingDoc = await HeaderMapping.findOne({ companyId }).lean();
  const headerMapping = sanitizeHeaderMapping(headerMappingDoc);
  const jvProcessMapping =
    headerMapping?.jvProcess && typeof headerMapping.jvProcess === "object"
      ? headerMapping.jvProcess
      : {};

  if (!Object.keys(jvProcessMapping).length) {
    return {
      success: false,
      message: "JV process header mapping is empty.",
      summary: {
        jv_enabled: true,
        candidate_rows: 0,
        saved_rows: 0,
        updated_sales_rows: 0,
      },
    };
  }

  const SalesUploadRow = getSalesUploadRowModel();
  if (!SalesUploadRow) {
    return {
      success: false,
      message: "SalesUploadRow model is not registered.",
      summary: {
        jv_enabled: true,
        candidate_rows: 0,
        saved_rows: 0,
        updated_sales_rows: 0,
      },
    };
  }

  const oid =
    companyId instanceof mongoose.Types.ObjectId
      ? companyId
      : new mongoose.Types.ObjectId(String(companyId));

  const pendingDocs = await SalesUploadRow.find({
    companyId: oid,
    "data.jv_date_null": false,
    "data.jv_data_create": false,
  })
    .select({ _id: 1, data: 1, source: 1 })
    .lean();

  if (!pendingDocs.length) {
    return {
      success: true,
      message: "No pending sales rows for JV data creation.",
      summary: {
        jv_enabled: true,
        candidate_rows: 0,
        saved_rows: 0,
        updated_sales_rows: 0,
      },
    };
  }

  const rawRows = pendingDocs.map((doc) =>
    doc?.data && typeof doc.data === "object" && !Array.isArray(doc.data)
      ? doc.data
      : {}
  );

  const jvResult = await processAndSaveJvSalesRows({
    companyId: oid,
    rawRows,
    jvProcessMapping,
    sourceFileName: "automation:jv_data_creation",
    requireDate: true,
  });

  const createdInvSet = jvResult.jvDataInvSet instanceof Set
    ? jvResult.jvDataInvSet
    : new Set();

  const rowIdsToMark = [];
  for (const doc of pendingDocs) {
    const data =
      doc?.data && typeof doc.data === "object" && !Array.isArray(doc.data)
        ? doc.data
        : {};
    const inv = normalizeInv(extractInvFromSalesRow(data));
    if (inv && createdInvSet.has(inv)) {
      rowIdsToMark.push(doc._id);
    }
  }

  let updatedSalesRows = 0;
  if (rowIdsToMark.length) {
    const updateResult = await SalesUploadRow.updateMany(
      { _id: { $in: rowIdsToMark } },
      { $set: { "data.jv_data_create": true } }
    );
    updatedSalesRows = updateResult.modifiedCount || 0;
  }

  return {
    success: true,
    message: `JV data creation: saved ${jvResult.saved_rows || 0}, updated ${updatedSalesRows} sales rows.`,
    summary: {
      jv_enabled: true,
      candidate_rows: pendingDocs.length,
      mapped_rows: jvResult.mapped_rows || 0,
      saved_rows: jvResult.saved_rows || 0,
      skipped_duplicate_in_file: jvResult.skipped_duplicate_in_file || 0,
      skipped_existing_in_collection: jvResult.skipped_existing_in_collection || 0,
      skipped_null_date: jvResult.skipped_null_date || 0,
      updated_sales_rows: updatedSalesRows,
      configured: jvResult.configured === true,
    },
  };
}

module.exports = {
  createPendingJvSalesDataForCompany,
};
