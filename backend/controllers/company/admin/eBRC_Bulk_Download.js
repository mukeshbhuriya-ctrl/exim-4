const {
  fetchEBrcBulkDownloadRequests,
  submitEBrcBulkDownloadRequest,
  fetchEBrcAttachment,
  buildContentDispositionHeader,
} = require("../../../web_scraping/djft/dricat/ebrc_bulk_download");
const { getStoredDgftCredentials } = require("#utils/dgftCredentials");
const {
  persistEbrcBulkDownloadAndMatchSb,
  resolveEbrcDateRange,
} = require("#utils/ebrcBulkDownloadData");
const {
  listStoredAttachments,
  getStoredAttachmentById,
  saveStoredAttachment,
  buildStoredAttachmentExcelBuffer,
  buildStoredAttachmentFileName,
} = require("#utils/ebrcStoredAttachment");
const { splitEbrcDateRange } = require("#utils/ebrcDateRangeSplit");

async function resolveDgftAuth(companyId, body = {}) {
  const u = body.username ?? body.id ?? body.userId ?? "";
  const p = body.password ?? "";
  if (String(u).trim() && String(p).length) {
    return { username: String(u).trim(), password: String(p) };
  }

  const stored = await getStoredDgftCredentials(companyId);
  if (stored) return stored;

  const envUser = String(process.env.DGFT_USERNAME ?? process.env.DGFT_USER_ID ?? "").trim();
  const envPass = String(process.env.DGFT_PASSWORD ?? "");
  if (envUser && envPass) return { username: envUser, password: envPass };

  return null;
}

function mapDgftErrorStatus(message) {
  const text = String(message || "");
  if (/Invalid id pass/i.test(text)) return 401;
  if (/credentials are required/i.test(text)) return 400;
  if (/login failed/i.test(text)) return 401;
  if (/HTTP 403/i.test(text)) return 403;
  if (/HTTP 404/i.test(text)) return 404;
  if (
    /is required|must be in DD\/MM\/YYYY|searchType must be|Please enter/i.test(
      text
    )
  ) {
    return 400;
  }
  return 500;
}

/** GET: fetch DGFT eBRC bulk download requests table as JSON. */
async function eBRCBulkDownloadRequest(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const auth = await resolveDgftAuth(req.companyId, req.body || {});
    if (!auth) {
      return res.status(400).json({
        success: false,
        message:
          "DGFT credentials not configured. Save credentials via POST /api/company/admin/configure/dgft/add-id-pass or pass username/password.",
      });
    }

    const forceRefresh =
      req.body?.forceRefresh === true ||
      req.query?.forceRefresh === "true" ||
      req.query?.forceRefresh === "1";

    const result = await fetchEBrcBulkDownloadRequests({
      companyId: req.companyId,
      username: auth.username,
      password: auth.password,
      forceRefresh,
      maxLoginRetries: req.body?.maxLoginRetries ?? req.query?.maxLoginRetries,
      screenId: req.body?.screenId ?? req.query?.screenId,
      menuCode: req.body?.menuCode ?? req.query?.menuCode,
    });

    return res.status(200).json({
      success: true,
      count: result.count,
      sessionFromCache: result.sessionFromCache === true,
      sessionRefreshed: result.sessionRefreshed === true,
      data: result.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = mapDgftErrorStatus(message);
    if (status < 500) {
      return res.status(status).json({ success: false, message });
    }
    return next(err);
  }
}

/** POST: download DGFT eBRC bulk attachment by attachId. */
async function downloadAttachment(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const body = req.body || {};
    const attachId =
      body.attachId ?? body.attachmentId ?? body.attachID ?? req.query?.attachId;

    if (!String(attachId ?? "").trim()) {
      return res.status(400).json({
        success: false,
        message: "attachId is required.",
      });
    }

    const auth = await resolveDgftAuth(req.companyId, body);
    if (!auth) {
      return res.status(400).json({
        success: false,
        message:
          "DGFT credentials not configured. Save credentials via POST /api/company/admin/configure/dgft/add-id-pass or pass username/password.",
      });
    }

    const forceRefresh =
      body.forceRefresh === true ||
      req.query?.forceRefresh === "true" ||
      req.query?.forceRefresh === "1";

    const result = await fetchEBrcAttachment({
      companyId: req.companyId,
      username: auth.username,
      password: auth.password,
      attachId: String(attachId).trim(),
      forceRefresh,
      maxLoginRetries: body.maxLoginRetries ?? req.query?.maxLoginRetries,
      screenId: body.screenId ?? req.query?.screenId,
    });

    const fileName = result.fileName || "EBRC BULK DOWNLOAD.xls";
    const { fromDate, toDate } = resolveEbrcDateRange(body, req.query || {});

    let persistResult = null;
    try {
      persistResult = await persistEbrcBulkDownloadAndMatchSb(
        req.companyId,
        String(attachId).trim(),
        result.buffer,
        { fromDate, toDate }
      );
    } catch (persistErr) {
      console.error("[eBRC] persist XLS / SB match failed:", persistErr);
    }

    res.setHeader("Content-Type", "application/vnd.ms-excel");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", buildContentDispositionHeader(fileName));
    res.setHeader("Content-Length", String(result.buffer.length));
    res.setHeader("X-Attach-Id", String(result.attachId || attachId));
    res.setHeader("X-File-Name", fileName);
    res.setHeader("X-File-Extension", "xls");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Disposition, Content-Type, Content-Length, X-File-Name, X-File-Extension, X-Attach-Id, X-Session-From-Cache, X-Session-Refreshed, X-Ebrc-Row-Count, X-Ebrc-Sb-Matched, X-Ebrc-Sb-Updated, X-Ebrc-Sb-Not-Found, X-Ebrc-Document-Id"
    );
    res.setHeader("X-Session-From-Cache", result.sessionFromCache ? "true" : "false");
    res.setHeader("X-Session-Refreshed", result.sessionRefreshed ? "true" : "false");

    if (persistResult) {
      res.setHeader("X-Ebrc-Row-Count", String(persistResult.rowCount ?? 0));
      res.setHeader("X-Ebrc-Sb-Matched", String(persistResult.matchSummary?.matched ?? 0));
      res.setHeader("X-Ebrc-Sb-Updated", String(persistResult.matchSummary?.updated ?? 0));
      res.setHeader("X-Ebrc-Sb-Not-Found", String(persistResult.matchSummary?.notFound ?? 0));
      if (persistResult.documentId) {
        res.setHeader("X-Ebrc-Document-Id", String(persistResult.documentId));
      }
    }

    return res.status(200).end(result.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = mapDgftErrorStatus(message);
    if (status < 500) {
      return res.status(status).json({ success: false, message });
    }
    return next(err);
  }
}

/** POST: submit DGFT eBRC bulk download request for a date range. */
async function submitBulkDownloadRequest(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const body = req.body || {};
    const irmFromDate =
      body.irmFromDate ?? body.fromDate ?? body.from ?? req.query?.irmFromDate;
    const irmToDate =
      body.irmToDate ?? body.toDate ?? body.to ?? req.query?.irmToDate;

    if (!String(irmFromDate ?? "").trim() || !String(irmToDate ?? "").trim()) {
      return res.status(400).json({
        success: false,
        message: "irmFromDate and irmToDate are required (DD/MM/YYYY).",
      });
    }

    const auth = await resolveDgftAuth(req.companyId, body);
    if (!auth) {
      return res.status(400).json({
        success: false,
        message:
          "DGFT credentials not configured. Save credentials via POST /api/company/admin/configure/dgft/add-id-pass or pass username/password.",
      });
    }

    const forceRefresh =
      body.forceRefresh === true ||
      req.query?.forceRefresh === "true" ||
      req.query?.forceRefresh === "1";

    const split = splitEbrcDateRange(
      String(irmFromDate).trim(),
      String(irmToDate).trim()
    );
    if (split.error) {
      return res.status(400).json({ success: false, message: split.error });
    }
    if (!split.chunks.length) {
      return res.status(400).json({
        success: false,
        message: "No date chunks generated for the selected range.",
      });
    }

    const submitted = [];
    const errors = [];

    for (const chunk of split.chunks) {
      try {
        const result = await submitEBrcBulkDownloadRequest({
          companyId: req.companyId,
          username: auth.username,
          password: auth.password,
          irmFromDate: chunk.fromDate,
          irmToDate: chunk.toDate,
          searchType: body.searchType ?? req.query?.searchType ?? "1",
          forceRefresh,
          maxLoginRetries: body.maxLoginRetries ?? req.query?.maxLoginRetries,
        });
        submitted.push({
          irmFromDate: chunk.fromDate,
          irmToDate: chunk.toDate,
          days: chunk.days,
          count: result.count,
          searchType: result.searchType,
        });
      } catch (chunkErr) {
        errors.push({
          irmFromDate: chunk.fromDate,
          irmToDate: chunk.toDate,
          message: chunkErr instanceof Error ? chunkErr.message : String(chunkErr),
        });
      }
    }

    if (!submitted.length) {
      const message = errors[0]?.message || "All bulk download chunk submissions failed.";
      const status = mapDgftErrorStatus(message);
      return res.status(status < 500 ? status : 500).json({
        success: false,
        message,
        chunks: split.chunks,
        errors,
      });
    }

    return res.status(200).json({
      success: errors.length === 0,
      message:
        errors.length === 0
          ? `Bulk download request submitted for ${submitted.length} date range(s).`
          : `Submitted ${submitted.length} range(s); ${errors.length} failed.`,
      irmFromDate: String(irmFromDate).trim(),
      irmToDate: String(irmToDate).trim(),
      chunkCount: split.chunks.length,
      submittedCount: submitted.length,
      failedCount: errors.length,
      chunks: split.chunks,
      submitted,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = mapDgftErrorStatus(message);
    if (status < 500) {
      return res.status(status).json({ success: false, message });
    }
    return next(err);
  }
}

async function runSubmitEbrcBulkDownloadForCompany(companyId, options = {}) {
  if (!companyId) {
    return { success: false, message: "Company admin access is required." };
  }

  const irmFromDate = options.irmFromDate ?? options.fromDate;
  const irmToDate = options.irmToDate ?? options.toDate;

  if (!String(irmFromDate ?? "").trim() || !String(irmToDate ?? "").trim()) {
    return {
      success: false,
      message: "irmFromDate and irmToDate are required (DD/MM/YYYY).",
    };
  }

  const auth = await resolveDgftAuth(companyId, options);
  if (!auth) {
    return {
      success: false,
      message:
        "DGFT credentials not configured. Save credentials via POST /api/company/admin/configure/dgft/add-id-pass.",
    };
  }

  try {
    const result = await submitEBrcBulkDownloadRequest({
      companyId,
      username: auth.username,
      password: auth.password,
      irmFromDate: String(irmFromDate).trim(),
      irmToDate: String(irmToDate).trim(),
      searchType: options.searchType ?? "1",
      forceRefresh: options.forceRefresh === true,
      maxLoginRetries: options.maxLoginRetries,
    });

    return {
      success: true,
      message: "Bulk download request submitted.",
      summary: {
        irmFromDate: result.irmFromDate,
        irmToDate: result.irmToDate,
        searchType: result.searchType,
        count: result.count,
        sessionFromCache: result.sessionFromCache === true,
        sessionRefreshed: result.sessionRefreshed === true,
      },
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runFetchEbrcBulkDownloadRequestsForCompany(companyId, options = {}) {
  if (!companyId) {
    return { success: false, message: "Company admin access is required." };
  }

  const auth = await resolveDgftAuth(companyId, options);
  if (!auth) {
    return {
      success: false,
      message:
        "DGFT credentials not configured. Save credentials via POST /api/company/admin/configure/dgft/add-id-pass.",
    };
  }

  try {
    const result = await fetchEBrcBulkDownloadRequests({
      companyId,
      username: auth.username,
      password: auth.password,
      forceRefresh: options.forceRefresh === true,
      maxLoginRetries: options.maxLoginRetries,
      screenId: options.screenId,
      menuCode: options.menuCode,
    });

    return {
      success: true,
      message: `Fetched ${result.count} bulk download request row(s) from DGFT.`,
      summary: {
        count: result.count,
        sessionFromCache: result.sessionFromCache === true,
        sessionRefreshed: result.sessionRefreshed === true,
      },
      rows: result.rows,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runDownloadEbrcAttachmentForCompany(companyId, options = {}) {
  if (!companyId) {
    return { success: false, message: "Company admin access is required." };
  }

  const attachId = options.attachId ?? options.attachmentId;
  if (!String(attachId ?? "").trim()) {
    return { success: false, message: "attachId is required." };
  }

  const auth = await resolveDgftAuth(companyId, options);
  if (!auth) {
    return {
      success: false,
      message:
        "DGFT credentials not configured. Save credentials via POST /api/company/admin/configure/dgft/add-id-pass.",
    };
  }

  try {
    const result = await fetchEBrcAttachment({
      companyId,
      username: auth.username,
      password: auth.password,
      attachId: String(attachId).trim(),
      forceRefresh: options.forceRefresh === true,
      maxLoginRetries: options.maxLoginRetries,
      screenId: options.screenId,
    });

    const fromDate = String(options.fromDate ?? options.irmFromDate ?? "").trim();
    const toDate = String(options.toDate ?? options.irmToDate ?? "").trim();

    const persistResult = await persistEbrcBulkDownloadAndMatchSb(
      companyId,
      String(attachId).trim(),
      result.buffer,
      { fromDate, toDate }
    );

    return {
      success: true,
      message: "eBRC attachment stored and shippingbillno dgft flags updated.",
      summary: {
        attachId: String(attachId).trim(),
        fromDate,
        toDate,
        fileName: result.fileName,
        sessionFromCache: result.sessionFromCache === true,
        sessionRefreshed: result.sessionRefreshed === true,
        rowCount: persistResult.rowCount,
        matchSummary: persistResult.matchSummary,
        documentId: persistResult.documentId,
      },
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** POST: download DGFT attachment and store full rows in ebrcstoredattachment. */
async function storeAttachment(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const body = req.body || {};
    const attachId =
      body.attachId ?? body.attachmentId ?? body.attachID ?? req.query?.attachId;

    if (!String(attachId ?? "").trim()) {
      return res.status(400).json({
        success: false,
        message: "attachId is required.",
      });
    }

    const auth = await resolveDgftAuth(req.companyId, body);
    if (!auth) {
      return res.status(400).json({
        success: false,
        message:
          "DGFT credentials not configured. Save credentials via POST /api/company/admin/configure/dgft/add-id-pass or pass username/password.",
      });
    }

    const forceRefresh =
      body.forceRefresh === true ||
      req.query?.forceRefresh === "true" ||
      req.query?.forceRefresh === "1";

    const result = await fetchEBrcAttachment({
      companyId: req.companyId,
      username: auth.username,
      password: auth.password,
      attachId: String(attachId).trim(),
      forceRefresh,
      maxLoginRetries: body.maxLoginRetries ?? req.query?.maxLoginRetries,
      screenId: body.screenId ?? req.query?.screenId,
    });

    const { fromDate, toDate } = resolveEbrcDateRange(body, req.query || {});

    const stored = await saveStoredAttachment(req.companyId, {
      attachId: String(attachId).trim(),
      fromDate,
      toDate,
      fileName: result.fileName || "EBRC BULK DOWNLOAD.xls",
      buffer: result.buffer,
      sessionFromCache: result.sessionFromCache === true,
      sessionRefreshed: result.sessionRefreshed === true,
    });

    return res.status(200).json({
      success: true,
      message: "eBRC attachment downloaded and stored.",
      data: stored,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = mapDgftErrorStatus(message);
    if (status < 500) {
      return res.status(status).json({ success: false, message });
    }
    return next(err);
  }
}

/** GET: list stored eBRC attachments (id, fromDate, toDate, attachId). */
async function listStoredAttachmentsHandler(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const result = await listStoredAttachments(req.companyId, {
      page: req.query?.page,
      limit: req.query?.limit,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return next(err);
  }
}

/** GET: export stored eBRC attachment rows as Excel by stored document id. */
async function exportStoredAttachmentExcel(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const id = String(req.params?.id ?? req.query?.id ?? "").trim();
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Stored attachment id is required.",
      });
    }

    const doc = await getStoredAttachmentById(req.companyId, id);
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Stored eBRC attachment not found.",
      });
    }

    const buffer = buildStoredAttachmentExcelBuffer(doc);
    const fileName = buildStoredAttachmentFileName(doc);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", buildContentDispositionHeader(fileName));
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("X-Stored-Attachment-Id", id);
    res.setHeader("X-Attach-Id", String(doc.attachId || ""));
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Disposition, Content-Type, Content-Length, X-File-Name, X-Attach-Id, X-Stored-Attachment-Id"
    );

    return res.status(200).end(buffer);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  eBRCBulkDownloadRequest,
  downloadAttachment,
  storeAttachment,
  listStoredAttachmentsHandler,
  exportStoredAttachmentExcel,
  submitBulkDownloadRequest,
  resolveDgftAuth,
  runSubmitEbrcBulkDownloadForCompany,
  runFetchEbrcBulkDownloadRequestsForCompany,
  runDownloadEbrcAttachmentForCompany,
};
