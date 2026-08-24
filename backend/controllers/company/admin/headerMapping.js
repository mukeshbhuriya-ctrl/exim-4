const {
  HeaderMapping,
  normalizeMappingBody,
  normalizeJvProcessBody,
  normalizeFilterDateBody,
  normalizeFinancialYearBody,
  normalizeManualMatchDescriptionBody,
  normalizeSalesUniqeColumnBody,
  normalizeColumnMappingBody,
  sanitizeHeaderMapping,
} = require("#utils/headerMapping");

async function getHeaderMapping(req, res, next) {
  try {
    const doc = await HeaderMapping.findOne({ companyId: req.companyId });

    return res.status(200).json({
      success: true,
      headerMapping: sanitizeHeaderMapping(doc),
    });
  } catch (error) {
    return next(error);
  }
}

async function createHeaderMapping(req, res, next) {
  try {
    const { rounding, sales, pdf } = normalizeMappingBody(req.body);
    const filter = { companyId: req.companyId };

    const existing = await HeaderMapping.findOne(filter);

    const doc = await HeaderMapping.findOneAndUpdate(
      filter,
      {
        $set: {
          companyId: req.companyId,
          rounding,
          sales,
          pdf,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing
        ? "Header mapping replaced."
        : "Header mapping created.",
      headerMapping: sanitizeHeaderMapping(doc),
    });
  } catch (error) {
    return next(error);
  }
}

async function getJvProcessHeaderMapping(req, res, next) {
  try {
    const doc = await HeaderMapping.findOne({ companyId: req.companyId });

    return res.status(200).json({
      success: true,
      jvProcess:
        doc?.jvProcess && typeof doc.jvProcess === "object" ? doc.jvProcess : {},
    });
  } catch (error) {
    return next(error);
  }
}

async function createJvProcessHeaderMapping(req, res, next) {
  try {
    const jvProcess = normalizeJvProcessBody(req.body);
    const filter = { companyId: req.companyId };

    const existing = await HeaderMapping.findOne(filter);

    const doc = await HeaderMapping.findOneAndUpdate(
      filter,
      {
        $set: {
          companyId: req.companyId,
          jvProcess,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing
        ? "JV process header mapping replaced."
        : "JV process header mapping created.",
      jvProcess:
        doc?.jvProcess && typeof doc.jvProcess === "object" ? doc.jvProcess : {},
      headerMapping: sanitizeHeaderMapping(doc),
    });
  } catch (error) {
    return next(error);
  }
}

/** GET report filter-date header mapping from `headermapping.filterDate`. */
async function getFilterDateHeaderMapping(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const doc = await HeaderMapping.findOne({ companyId: req.companyId }).lean();
    const filterDate =
      doc?.filterDate && typeof doc.filterDate === "object" ? doc.filterDate : {};

    return res.status(200).json({
      success: true,
      filterDate,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST report filter-date header mapping — merges key/value pairs into `headermapping.filterDate`.
 * Body: `{ "date": "Invoice Date" }` or `{ "filterDate": { "date": "Invoice Date" } }`.
 */
async function filterDateHeaderMapping(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const incoming = normalizeFilterDateBody(req.body);
    if (!Object.keys(incoming).length) {
      return res.status(400).json({
        success: false,
        message:
          'Provide at least one mapping, e.g. { "date": "Invoice Date" }.',
      });
    }

    const filter = { companyId: req.companyId };
    const existing = await HeaderMapping.findOne(filter).lean();
    const mergedFilterDate = {
      ...(existing?.filterDate && typeof existing.filterDate === "object"
        ? existing.filterDate
        : {}),
      ...incoming,
    };

    const doc = await HeaderMapping.findOneAndUpdate(
      filter,
      {
        $set: {
          companyId: req.companyId,
          filterDate: mergedFilterDate,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing
        ? "Filter date header mapping updated."
        : "Filter date header mapping created.",
      filterDate: mergedFilterDate,
      headerMapping: sanitizeHeaderMapping(doc),
    });
  } catch (error) {
    return next(error);
  }
}

/** GET sales unique-column mapping from `headermapping.salesUniqeColumn`. */
async function getSalesUniqeColumn(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const doc = await HeaderMapping.findOne({ companyId: req.companyId }).lean();
    const salesUniqeColumn = normalizeSalesUniqeColumnBody(
      doc?.salesUniqeColumn && typeof doc.salesUniqeColumn === "object"
        ? doc.salesUniqeColumn
        : {}
    );

    return res.status(200).json({
      success: true,
      salesUniqeColumn,
    });
  } catch (error) {
    return next(error);
  }
}

/** POST sales unique-column mapping — stores column list on `headermapping.salesUniqeColumn`. */
async function createSalesUniqeColumn(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const salesUniqeColumn = normalizeSalesUniqeColumnBody(req.body);
    if (!salesUniqeColumn.columns.length) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one column, e.g. { "columns": ["Invoice No"] }.',
      });
    }

    const filter = { companyId: req.companyId };
    const existing = await HeaderMapping.findOne(filter).lean();

    const doc = await HeaderMapping.findOneAndUpdate(
      filter,
      {
        $set: {
          companyId: req.companyId,
          salesUniqeColumn,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing
        ? "Sales unique column mapping updated."
        : "Sales unique column mapping created.",
      salesUniqeColumn,
      headerMapping: sanitizeHeaderMapping(doc),
    });
  } catch (error) {
    return next(error);
  }
}

/** GET sales financial-year column from `headermapping.financialYear`. */
async function getFinancialYearHeaderMapping(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const doc = await HeaderMapping.findOne({ companyId: req.companyId }).lean();
    const financialYear = normalizeFinancialYearBody(
      doc?.financialYear && typeof doc.financialYear === "object" ? doc.financialYear : {}
    );

    return res.status(200).json({
      success: true,
      financialYear,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST sales financial-year column mapping — stores on `headermapping.financialYear`.
 * Body: `{ "column": "Financial Year" }` or `{ financialYear: { column: "..." } }`.
 */
async function createFinancialYearHeaderMapping(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const financialYear = normalizeFinancialYearBody(req.body);
    if (!financialYear.column) {
      return res.status(400).json({
        success: false,
        message:
          'Provide the Sales column name, e.g. { "column": "Financial Year" }.',
      });
    }

    const filter = { companyId: req.companyId };
    const existing = await HeaderMapping.findOne(filter).lean();

    const doc = await HeaderMapping.findOneAndUpdate(
      filter,
      {
        $set: {
          companyId: req.companyId,
          financialYear,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing
        ? "Financial year header mapping updated."
        : "Financial year header mapping created.",
      financialYear,
      headerMapping: sanitizeHeaderMapping(doc),
    });
  } catch (error) {
    return next(error);
  }
}

/** GET manual match description column from `headermapping.manualMatchDescription`. */
async function getManualMatchDescriptionHeaderMapping(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const doc = await HeaderMapping.findOne({ companyId: req.companyId }).lean();
    const manualMatchDescription = normalizeManualMatchDescriptionBody(
      doc?.manualMatchDescription && typeof doc.manualMatchDescription === "object"
        ? doc.manualMatchDescription
        : {}
    );

    return res.status(200).json({
      success: true,
      manualMatchDescription,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST manual match description column — stores on `headermapping.manualMatchDescription`.
 * Body: `{ "column": "Item Description" }`.
 */
async function createManualMatchDescriptionHeaderMapping(req, res, next) {
  try {
    if (!req.companyId) {
      return res.status(401).json({
        success: false,
        message: "Company admin access is required.",
      });
    }

    const manualMatchDescription = normalizeManualMatchDescriptionBody(req.body);
    if (!manualMatchDescription.column) {
      return res.status(400).json({
        success: false,
        message:
          'Provide the Sales description column, e.g. { "column": "Item Description" }.',
      });
    }

    const filter = { companyId: req.companyId };
    const existing = await HeaderMapping.findOne(filter).lean();

    const doc = await HeaderMapping.findOneAndUpdate(
      filter,
      {
        $set: {
          companyId: req.companyId,
          manualMatchDescription,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing
        ? "Manual match description mapping updated."
        : "Manual match description mapping created.",
      manualMatchDescription,
      headerMapping: sanitizeHeaderMapping(doc),
    });
  } catch (error) {
    return next(error);
  }
}

async function getColumnMapping(req, res, next) {
  try {
    const doc = await HeaderMapping.findOne({ companyId: req.companyId });
    const columnMapping =
      doc?.columnMapping && typeof doc.columnMapping === "object"
        ? normalizeColumnMappingBody(doc.columnMapping)
        : { columns: [] };

    return res.status(200).json({
      success: true,
      columnMapping,
      columns: columnMapping.columns,
      headerMapping: sanitizeHeaderMapping(doc),
    });
  } catch (error) {
    return next(error);
  }
}

async function storeColumnMapping(req, res, next) {
  try {
    const columnMapping = normalizeColumnMappingBody(req.body);
    if (!columnMapping.columns.length) {
      return res.status(400).json({
        success: false,
        message: "columns (array of header names) is required.",
      });
    }

    const filter = { companyId: req.companyId };
    const existing = await HeaderMapping.findOne(filter);

    const doc = await HeaderMapping.findOneAndUpdate(
      filter,
      {
        $set: {
          companyId: req.companyId,
          columnMapping,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing
        ? "Column mapping updated."
        : "Column mapping stored.",
      columnMapping,
      columns: columnMapping.columns,
      headerMapping: sanitizeHeaderMapping(doc),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createHeaderMapping,
  createFinancialYearHeaderMapping,
  createJvProcessHeaderMapping,
  createManualMatchDescriptionHeaderMapping,
  createSalesUniqeColumn,
  filterDateHeaderMapping,
  getFinancialYearHeaderMapping,
  getFilterDateHeaderMapping,
  getHeaderMapping,
  getJvProcessHeaderMapping,
  getManualMatchDescriptionHeaderMapping,
  getSalesUniqeColumn,
  getColumnMapping,
  storeColumnMapping,
};
