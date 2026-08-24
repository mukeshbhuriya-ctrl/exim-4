function normalizeValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getCombinationColumnNames(combinationList) {
  // Keep same names used in createcombination.js output: "INV | QTY1 | AMOUNT"
  return (Array.isArray(combinationList) ? combinationList : [])
    .map((c) =>
      String(c || "")
        .split("|")
        .map((s) => String(s).trim())
        .filter(Boolean)
        .join(" | ")
    )
    .filter(Boolean);
}

function normalizeCombinationColumnName(def) {
  // "INV | QTY1 | AMOUNT" or "INV|QTY1|AMOUNT" => "INV | QTY1 | AMOUNT"
  return String(def || "")
    .split("|")
    .map((s) => String(s).trim())
    .filter(Boolean)
    .join(" | ");
}

function repetColumnName(combinationCol) {
  return `repet ${combinationCol}`;
}

function duplicateCountColumnName(combinationCol) {
  return `duplicate_count ${combinationCol}`;
}

/** Aligned pairs (sales col i, pdf col i) from combination config. */
function getAlignedCombinationPairs(salesCombination, pdfCombination) {
  const salesCols = getCombinationColumnNames(salesCombination);
  const pdfCols = getCombinationColumnNames(pdfCombination);
  const n = Math.min(salesCols.length, pdfCols.length);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ salesCol: salesCols[i], pdfCol: pdfCols[i] });
  }
  return pairs;
}

function countByColumnValue(rows, col) {
  const m = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const v = normalizeValue(row?.[col]);
    if (!v) continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

function countRowsWithValue(rows, col, value) {
  const t = normalizeValue(value);
  if (!t) return 0;
  let n = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (normalizeValue(row?.[col]) === t) n++;
  }
  return n;
}

/**
 * Sales export: repet <salesCol> = occurrences in sales; repet <pdfCol> = pdf rows
 * whose pdf combination equals this row's sales combination value (cross count).
 */
function enrichSalesRowsWithRepetColumns(
  salesRows,
  pdfItems,
  salesCombination,
  pdfCombination,
  duplicateRules = []
) {
  const pairs = getAlignedCombinationPairs(salesCombination, pdfCombination);
  const list = Array.isArray(salesRows) ? salesRows : [];
  const pdfList = Array.isArray(pdfItems) ? pdfItems : [];
  const dupSalesCols = new Set(
    (Array.isArray(duplicateRules) ? duplicateRules : [])
      .map((r) => normalizeCombinationColumnName(r?.salesCombination))
      .filter(Boolean)
  );

  const stats = pairs.map(({ salesCol, pdfCol }) => ({
    salesCol,
    pdfCol,
    salesMap: countByColumnValue(list, salesCol),
    pdfMap: countByColumnValue(pdfList, pdfCol),
  }));

  return list.map((row) => {
    const out = { ...(row || {}) };
    for (const { salesCol, pdfCol, salesMap, pdfMap } of stats) {
      const v = normalizeValue(out[salesCol]);
      const salesCnt = v ? salesMap.get(v) || 0 : 0;
      const pdfCnt = v ? pdfMap.get(v) || 0 : 0;
      out[repetColumnName(salesCol)] = salesCnt;
      out[repetColumnName(pdfCol)] = pdfCnt;
      if (dupSalesCols.has(salesCol)) {
        out[duplicateCountColumnName(salesCol)] = salesCnt;
        out[duplicateCountColumnName(pdfCol)] = pdfCnt;
      }
    }
    return out;
  });
}

/**
 * Pdf export: repet <salesCol> = sales rows whose sales combination equals this pdf row's
 * pdf combination value. No intra-pdf repet column for pdfCol.
 */
function enrichPdfRowsWithCrossSalesRepet(
  pdfItems,
  salesRows,
  salesCombination,
  pdfCombination,
  duplicateRules = []
) {
  const pairs = getAlignedCombinationPairs(salesCombination, pdfCombination);
  const list = Array.isArray(pdfItems) ? pdfItems : [];
  const salesList = Array.isArray(salesRows) ? salesRows : [];
  const dupPdfCols = new Set(
    (Array.isArray(duplicateRules) ? duplicateRules : [])
      .map((r) => normalizeCombinationColumnName(r?.pdfCombination))
      .filter(Boolean)
  );

  const stats = pairs.map(({ salesCol, pdfCol }) => ({
    salesCol,
    pdfCol,
    salesMap: countByColumnValue(salesList, salesCol),
    pdfMap: countByColumnValue(list, pdfCol),
  }));

  return list.map((row) => {
    const out = { ...(row || {}) };
    for (const { salesCol, pdfCol, salesMap, pdfMap } of stats) {
      const v = normalizeValue(out[pdfCol]);
      const salesCnt = v ? salesMap.get(v) || 0 : 0;
      const pdfCnt = v ? pdfMap.get(v) || 0 : 0;
      out[repetColumnName(salesCol)] = salesCnt;
      if (dupPdfCols.has(pdfCol)) {
        out[duplicateCountColumnName(pdfCol)] = pdfCnt;
        out[duplicateCountColumnName(salesCol)] = salesCnt;
      }
    }
    return out;
  });
}

/** Recompute duplicate_count on remaining rows for the given matchDuplicate rules. */
function enrichRemainingWithDuplicateCounts(
  salesRemaining,
  pdfRemaining,
  duplicateRules
) {
  const rules = Array.isArray(duplicateRules) ? duplicateRules : [];
  if (!rules.length) {
    return { salesRemaining, pdfRemaining };
  }

  const salesList = Array.isArray(salesRemaining) ? salesRemaining : [];
  const pdfList = Array.isArray(pdfRemaining) ? pdfRemaining : [];

  const salesStats = rules.map((rule) => {
    const salesCol = normalizeCombinationColumnName(rule?.salesCombination);
    const pdfCol = normalizeCombinationColumnName(rule?.pdfCombination);
    return {
      salesCol,
      pdfCol,
      salesMap: salesCol ? countByColumnValue(salesList, salesCol) : new Map(),
      pdfMap: pdfCol ? countByColumnValue(pdfList, pdfCol) : new Map(),
    };
  });

  const salesOut = salesList.map((row) => {
    const out = { ...(row || {}) };
    for (const { salesCol, pdfCol, salesMap, pdfMap } of salesStats) {
      if (!salesCol) continue;
      const v = normalizeValue(out[salesCol]);
      const salesCnt = v ? salesMap.get(v) || 0 : 0;
      const pdfCnt = v ? pdfMap.get(v) || 0 : 0;
      out[duplicateCountColumnName(salesCol)] = salesCnt;
      if (pdfCol) out[duplicateCountColumnName(pdfCol)] = pdfCnt;
    }
    return out;
  });

  const pdfOut = pdfList.map((row) => {
    const out = { ...(row || {}) };
    for (const { salesCol, pdfCol, salesMap, pdfMap } of salesStats) {
      if (!pdfCol) continue;
      const v = normalizeValue(out[pdfCol]);
      const pdfCnt = v ? pdfMap.get(v) || 0 : 0;
      const salesCnt = v ? salesMap.get(v) || 0 : 0;
      out[duplicateCountColumnName(pdfCol)] = pdfCnt;
      if (salesCol) out[duplicateCountColumnName(salesCol)] = salesCnt;
    }
    return out;
  });

  return { salesRemaining: salesOut, pdfRemaining: pdfOut };
}

function buildCompositeMatchKey(row, rules, side) {
  const parts = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const col =
      side === "sales"
        ? normalizeCombinationColumnName(rule?.salesCombination)
        : normalizeCombinationColumnName(rule?.pdfCombination);
    if (!col) return null;
    const v = normalizeValue(row?.[col]);
    if (!v) return null;
    parts.push(v);
  }
  return parts.length ? parts.join(" || ") : null;
}

function deriveSalesReason(row, sortedRules, salesRemaining, pdfRemaining) {
  for (const rule of sortedRules) {
    const salesCol = normalizeCombinationColumnName(rule?.salesCombination);
    const pdfCol = normalizeCombinationColumnName(rule?.pdfCombination);
    if (!salesCol || !pdfCol) continue;
    const value = normalizeValue(row?.[salesCol]);
    if (!value) continue;
    const salesCnt = countRowsWithValue(salesRemaining, salesCol, value);
    const pdfCnt = countRowsWithValue(pdfRemaining, pdfCol, value);
    if (salesCnt > 1) {
      return `Skipped: sales.repet > 1 in ${salesCol}`;
    }
    if (pdfCnt > 1) {
      return `Skipped: pdf.repet > 1 for ${salesCol} value in ${pdfCol}`;
    }
    if (pdfCnt === 0) {
      return `No pdf match for ${salesCol} = ${value}`;
    }
    return `Unmatched for ${salesCol} = ${value}`;
  }
  return "No usable sales combination value";
}

function derivePdfReason(row, sortedRules, salesRemaining, pdfRemaining) {
  for (const rule of sortedRules) {
    const salesCol = normalizeCombinationColumnName(rule?.salesCombination);
    const pdfCol = normalizeCombinationColumnName(rule?.pdfCombination);
    if (!salesCol || !pdfCol) continue;
    const value = normalizeValue(row?.[pdfCol]);
    if (!value) continue;
    const salesCnt = countRowsWithValue(salesRemaining, salesCol, value);
    const pdfCnt = countRowsWithValue(pdfRemaining, pdfCol, value);
    if (pdfCnt > 1) {
      return `Skipped: pdf.repet > 1 in ${pdfCol}`;
    }
    if (salesCnt > 1) {
      return `Skipped: sales.repet > 1 for value in ${salesCol}`;
    }
    if (salesCnt === 0) {
      return `No sales match for ${pdfCol} = ${value}`;
    }
    return `Unmatched for ${pdfCol} = ${value}`;
  }
  return "No usable pdf combination value";
}

function applyUniqueMatchRule({
  rule,
  salesCol,
  pdfCol,
  salesRemaining,
  pdfRemaining,
  matched,
}) {
  const seq = rule?.seq;
  const salesCountMap = countByColumnValue(salesRemaining, salesCol);
  const pdfCountMap = countByColumnValue(pdfRemaining, pdfCol);

  const pdfBuckets = new Map();
  for (let i = 0; i < pdfRemaining.length; i++) {
    const row = pdfRemaining[i];
    const val = normalizeValue(row?.[pdfCol]);
    if (!val) continue;
    if ((pdfCountMap.get(val) || 0) !== 1) continue;
    if (!pdfBuckets.has(val)) pdfBuckets.set(val, []);
    pdfBuckets.get(val).push(i);
  }

  const nextSalesRemaining = [];
  const pdfUsed = new Set();

  for (const salesRow of salesRemaining) {
    const salesVal = normalizeValue(salesRow?.[salesCol]);
    if (!salesVal) {
      nextSalesRemaining.push(salesRow);
      continue;
    }
    if ((salesCountMap.get(salesVal) || 0) !== 1) {
      nextSalesRemaining.push(salesRow);
      continue;
    }
    if ((pdfCountMap.get(salesVal) || 0) !== 1) {
      nextSalesRemaining.push(salesRow);
      continue;
    }

    const bucket = pdfBuckets.get(salesVal);
    if (!bucket || bucket.length === 0) {
      nextSalesRemaining.push(salesRow);
      continue;
    }

    const available = bucket.filter((idx) => !pdfUsed.has(idx));

    if (available.length > 1) {
      nextSalesRemaining.push(salesRow);
      continue;
    }

    const pdfIndex = available.length === 1 ? available[0] : null;

    if (pdfIndex === null) {
      nextSalesRemaining.push(salesRow);
      continue;
    }

    pdfUsed.add(pdfIndex);
    const pdfRow = pdfRemaining[pdfIndex];

    matched.push({
      seq,
      salesCombination: salesCol,
      pdfCombination: pdfCol,
      matchValue: salesVal,
      matchDuplicate: false,
      salesRow,
      pdfRow,
    });
  }

  return {
    salesRemaining: nextSalesRemaining,
    pdfRemaining: pdfRemaining.filter((_, idx) => !pdfUsed.has(idx)),
  };
}

/**
 * Match rows when all matchDuplicate rules agree:
 * - same combination value(s) on sales vs pdf (all rules checked together)
 * - same duplicate_count on both sides for each rule's combination column
 * Pairs all rows in the group (e.g. 2 sales + 2 pdf with count 2 → 2 matches).
 */
function applyMultiDuplicateMatchRules({
  rules,
  salesRemaining,
  pdfRemaining,
  matched,
}) {
  const dupRules = Array.isArray(rules) ? rules.filter(Boolean) : [];
  if (!dupRules.length) {
    return { salesRemaining, pdfRemaining };
  }

  const seq = Math.min(...dupRules.map((r) => Number(r?.seq) || 0).filter((n) => n > 0));
  const primary = dupRules[0];
  const salesCol = normalizeCombinationColumnName(primary?.salesCombination);
  const pdfCol = normalizeCombinationColumnName(primary?.pdfCombination);
  const salesCombinationLabel = dupRules
    .map((r) => normalizeCombinationColumnName(r?.salesCombination))
    .filter(Boolean)
    .join(" + ");
  const pdfCombinationLabel = dupRules
    .map((r) => normalizeCombinationColumnName(r?.pdfCombination))
    .filter(Boolean)
    .join(" + ");

  const salesGroups = new Map();
  const pdfGroups = new Map();

  for (let i = 0; i < salesRemaining.length; i++) {
    const row = salesRemaining[i];
    const key = buildCompositeMatchKey(row, dupRules, "sales");
    if (!key) continue;

    let valid = true;
    for (const rule of dupRules) {
      const sc = normalizeCombinationColumnName(rule?.salesCombination);
      const pc = normalizeCombinationColumnName(rule?.pdfCombination);
      if (!sc || !pc) {
        valid = false;
        break;
      }
      const salesCnt = Number(row?.[duplicateCountColumnName(sc)]) || 0;
      const pdfCnt = Number(row?.[duplicateCountColumnName(pc)]) || 0;
      if (!salesCnt || salesCnt !== pdfCnt) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    if (!salesGroups.has(key)) salesGroups.set(key, []);
    salesGroups.get(key).push({ row, idx: i, key });
  }

  for (let i = 0; i < pdfRemaining.length; i++) {
    const row = pdfRemaining[i];
    const key = buildCompositeMatchKey(row, dupRules, "pdf");
    if (!key) continue;

    let valid = true;
    for (const rule of dupRules) {
      const sc = normalizeCombinationColumnName(rule?.salesCombination);
      const pc = normalizeCombinationColumnName(rule?.pdfCombination);
      if (!sc || !pc) {
        valid = false;
        break;
      }
      const salesCnt = Number(row?.[duplicateCountColumnName(sc)]) || 0;
      const pdfCnt = Number(row?.[duplicateCountColumnName(pc)]) || 0;
      if (!pdfCnt || salesCnt !== pdfCnt) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    if (!pdfGroups.has(key)) pdfGroups.set(key, []);
    pdfGroups.get(key).push({ row, idx: i, key });
  }

  const salesUsed = new Set();
  const pdfUsed = new Set();

  for (const [key, salesEntries] of salesGroups) {
    const pdfEntries = pdfGroups.get(key) || [];
    if (!salesEntries.length || salesEntries.length !== pdfEntries.length) continue;

    for (let i = 0; i < salesEntries.length; i++) {
      const salesEntry = salesEntries[i];
      const pdfEntry = pdfEntries[i];
      if (salesUsed.has(salesEntry.idx) || pdfUsed.has(pdfEntry.idx)) continue;

      salesUsed.add(salesEntry.idx);
      pdfUsed.add(pdfEntry.idx);

      matched.push({
        seq: Number.isFinite(seq) && seq > 0 ? seq : primary?.seq,
        salesCombination: salesCombinationLabel || salesCol,
        pdfCombination: pdfCombinationLabel || pdfCol,
        matchValue: key,
        matchDuplicate: true,
        matchDuplicateRuleCount: dupRules.length,
        salesRow: salesEntry.row,
        pdfRow: pdfEntry.row,
      });
    }
  }

  return {
    salesRemaining: salesRemaining.filter((_, idx) => !salesUsed.has(idx)),
    pdfRemaining: pdfRemaining.filter((_, idx) => !pdfUsed.has(idx)),
  };
}

// Matching:
// - Repetition uses current seq's remaining sales/pdf rows (recomputed each rule).
// - sales.repet: count of this salesCol value in salesRemaining.
// - pdf.repet (for that value): count of pdf rows with pdfCol equal to that value in pdfRemaining.
// - Process row only when both counts are exactly 1.
function Connection(
  connections,
  salesRows,
  pdfItems,
  salesCombination,
  pdfCombination
) {
  const rules = Array.isArray(connections) ? connections : [];
  const duplicateRules = rules.filter((r) => r?.matchDuplicate === true);
  const matchDuplicateRuleCount = duplicateRules.length;

  const salesWithRepet = enrichSalesRowsWithRepetColumns(
    salesRows,
    pdfItems,
    salesCombination,
    pdfCombination,
    duplicateRules
  );
  const pdfWithRepet = enrichPdfRowsWithCrossSalesRepet(
    pdfItems,
    salesRows,
    salesCombination,
    pdfCombination,
    duplicateRules
  );

  const salesRemaining = [...salesWithRepet];
  const pdfRemaining = [...pdfWithRepet];

  const matched = [];

  const sortedRules = [...rules].sort((a, b) => (a?.seq || 0) - (b?.seq || 0));

  let ruleIndex = 0;
  while (ruleIndex < sortedRules.length) {
    const rule = sortedRules[ruleIndex];
    const salesCol = normalizeCombinationColumnName(rule?.salesCombination);
    const pdfCol = normalizeCombinationColumnName(rule?.pdfCombination);

    if (!salesCol || !pdfCol) {
      ruleIndex += 1;
      continue;
    }

    let result;

    if (rule?.matchDuplicate) {
      const dupBatch = [];
      while (
        ruleIndex < sortedRules.length &&
        sortedRules[ruleIndex]?.matchDuplicate
      ) {
        const batchRule = sortedRules[ruleIndex];
        const batchSalesCol = normalizeCombinationColumnName(
          batchRule?.salesCombination
        );
        const batchPdfCol = normalizeCombinationColumnName(
          batchRule?.pdfCombination
        );
        if (batchSalesCol && batchPdfCol) dupBatch.push(batchRule);
        ruleIndex += 1;
      }

      const enriched = enrichRemainingWithDuplicateCounts(
        salesRemaining,
        pdfRemaining,
        dupBatch
      );
      salesRemaining.length = 0;
      salesRemaining.push(...enriched.salesRemaining);
      pdfRemaining.length = 0;
      pdfRemaining.push(...enriched.pdfRemaining);

      result = applyMultiDuplicateMatchRules({
        rules: dupBatch,
        salesRemaining,
        pdfRemaining,
        matched,
      });
    } else {
      result = applyUniqueMatchRule({
        rule,
        salesCol,
        pdfCol,
        salesRemaining,
        pdfRemaining,
        matched,
      });
      ruleIndex += 1;
    }

    salesRemaining.length = 0;
    salesRemaining.push(...result.salesRemaining);
    pdfRemaining.length = 0;
    pdfRemaining.push(...result.pdfRemaining);
  }

  const salesRemainingWithReason = salesRemaining.map((row) => ({
    ...(row || {}),
    reason: deriveSalesReason(row, sortedRules, salesRemaining, pdfRemaining),
  }));

  const pdfRemainingWithReason = pdfRemaining.map((row) => ({
    ...(row || {}),
    reason: derivePdfReason(row, sortedRules, salesRemaining, pdfRemaining),
  }));

  return {
    matched,
    salesRemaining: salesRemainingWithReason,
    pdfRemaining: pdfRemainingWithReason,
    salesRowsWithRepet: salesWithRepet,
    pdfRowsWithRepet: pdfWithRepet,
    matchDuplicateRuleCount,
  };
}

module.exports = {
  getCombinationColumnNames,
  getAlignedCombinationPairs,
  enrichSalesRowsWithRepetColumns,
  enrichPdfRowsWithCrossSalesRepet,
  repetColumnName,
  duplicateCountColumnName,
  Connection,
};
