"use strict";

const { DgftProcess } = require("#utils/dgftProcess");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const rawLimit = parseInt(query.limit, 10) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function toText(value) {
  return String(value ?? "").trim();
}

/**
 * Pull port / SB / BRC / pdfUrl from a dgftprocess document.
 * pdfUrl lives under scrapedData.brcDetail.pdfUrl (also checked on tableRows).
 */
function extractDgftPdfRow(doc) {
  if (!doc || typeof doc !== "object") return null;

  const input = doc.input && typeof doc.input === "object" ? doc.input : {};
  const scraped =
    doc.scrapedData && typeof doc.scrapedData === "object" ? doc.scrapedData : {};
  const topDetail =
    scraped.brcDetail && typeof scraped.brcDetail === "object" ? scraped.brcDetail : {};

  const tableRows = Array.isArray(scraped.tableRows) ? scraped.tableRows : [];
  let pdfUrl = toText(topDetail.pdfUrl || scraped.pdfUrl);
  let brcNumber = toText(
    topDetail.brcNumber || topDetail.brNumber || scraped.brcNumber
  );
  let port = toText(input.port);
  let sbNumber = toText(input.sbNumber || input.sbNo);
  let sbDate = toText(input.sbDate);

  for (const tr of tableRows) {
    if (!tr || typeof tr !== "object") continue;
    const detail =
      tr.brcDetail && typeof tr.brcDetail === "object" ? tr.brcDetail : {};
    if (!pdfUrl) {
      pdfUrl = toText(detail.pdfUrl || tr.pdfUrl);
    }
    if (!brcNumber) {
      brcNumber = toText(
        detail.brcNumber ||
          detail.brNumber ||
          tr["Bank Realisation Number"] ||
          tr.brcNumber
      );
    }
    if (!port) {
      port = toText(
        detail.exportPortCode ||
          tr["Shipping Bill Port"] ||
          tr.port ||
          tr.exportPortCode
      );
    }
    if (!sbNumber) {
      sbNumber = toText(
        detail.sbNumber || tr["Shipping Bill Number"] || tr.sbNumber
      );
    }
    if (!sbDate) {
      sbDate = toText(detail.sbDate || tr["Shipping Bill Date"] || tr.sbDate);
    }
  }

  if (!pdfUrl) return null;

  return {
    id: String(doc._id),
    processId: String(doc._id),
    dayKey: toText(doc.dayKey),
    batchId: toText(doc.batchId),
    status: toText(doc.status),
    port,
    sbNumber,
    sbDate,
    brcNumber,
    pdfUrl,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function buildPdfUrlExistsFilter() {
  return {
    $or: [
      {
        "scrapedData.brcDetail.pdfUrl": {
          $exists: true,
          $type: "string",
          $ne: "",
        },
      },
      {
        "scrapedData.pdfUrl": {
          $exists: true,
          $type: "string",
          $ne: "",
        },
      },
      {
        "scrapedData.tableRows.pdfUrl": {
          $exists: true,
          $type: "string",
          $ne: "",
        },
      },
      {
        "scrapedData.tableRows.brcDetail.pdfUrl": {
          $exists: true,
          $type: "string",
          $ne: "",
        },
      },
    ],
  };
}

function buildSearchFilter(search) {
  const q = toText(search);
  if (!q) return null;
  const rx = new RegExp(escapeRegex(q), "i");
  return {
    $or: [
      { "input.port": rx },
      { "input.sbNumber": rx },
      { "input.sbDate": rx },
      { "scrapedData.brcDetail.brcNumber": rx },
      { "scrapedData.brcDetail.brNumber": rx },
      { "scrapedData.brcDetail.sbNumber": rx },
      { "scrapedData.tableRows.Bank Realisation Number": rx },
      { "scrapedData.tableRows.Shipping Bill Number": rx },
      { "scrapedData.tableRows.brcDetail.brcNumber": rx },
      { "scrapedData.tableRows.brcDetail.brNumber": rx },
    ],
  };
}

/**
 * GET /api/company/admin/pdf/dgft?page=1&limit=20&search=
 * Lists DGFT process rows that have a BRC PDF URL.
 */
async function listDgftPdfs(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const { page, limit, skip } = parsePagination(req.query || {});
    const searchFilter = buildSearchFilter(req.query?.search ?? req.query?.q);

    const filter = {
      companyId,
      ...buildPdfUrlExistsFilter(),
      ...(searchFilter || {}),
    };

    const [docs, total] = await Promise.all([
      DgftProcess.find(filter)
        .select({
          input: 1,
          scrapedData: 1,
          status: 1,
          dayKey: 1,
          batchId: 1,
          createdAt: 1,
          updatedAt: 1,
        })
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DgftProcess.countDocuments(filter),
    ]);

    const rows = docs.map(extractDgftPdfRow).filter(Boolean);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      count: rows.length,
      rows,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/company/admin/pdf/dgft/:id
 * Single row detail (includes pdfUrl for download).
 */
async function getDgftPdfById(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const id = toText(req.params?.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Process id is required.",
      });
    }

    const doc = await DgftProcess.findOne({ _id: id, companyId })
      .select({
        input: 1,
        scrapedData: 1,
        status: 1,
        dayKey: 1,
        batchId: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "DGFT process record not found.",
      });
    }

    const row = extractDgftPdfRow(doc);
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "No PDF URL found for this DGFT record.",
      });
    }

    return res.status(200).json({
      success: true,
      data: row,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listDgftPdfs,
  getDgftPdfById,
  extractDgftPdfRow,
};
