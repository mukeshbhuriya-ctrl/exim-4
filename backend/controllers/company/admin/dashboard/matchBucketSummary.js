/**
 * Build count + list summary from grouped row buckets.
 *
 * @param {Map<string, { rowIds: string[], matchedRowIds: string[] }>} byKey
 * @param {string} valueField e.g. "inv" or "sbNo"
 */
function buildMatchBucketSummary(byKey, valueField) {
  const matchedList = [];
  const unmatchedList = [];
  const partially_matchedList = [];

  for (const [key, group] of byKey) {
    const totalRows = group.rowIds.length;
    const matchedRows = group.matchedRowIds.length;
    const item = {
      [valueField]: key,
      totalRows,
      matchedRows,
      unmatchedRows: totalRows - matchedRows,
    };

    if (matchedRows === totalRows) {
      matchedList.push(item);
    } else if (matchedRows === 0) {
      unmatchedList.push(item);
    } else {
      partially_matchedList.push(item);
    }
  }

  const sortByKey = (a, b) =>
    String(a[valueField]).localeCompare(String(b[valueField]), undefined, {
      numeric: true,
      sensitivity: "base",
    });

  matchedList.sort(sortByKey);
  unmatchedList.sort(sortByKey);
  partially_matchedList.sort(sortByKey);

  return {
    matched: matchedList.length,
    unmatched: unmatchedList.length,
    partially_matched: partially_matchedList.length,
    matchedList,
    unmatchedList,
    partially_matchedList,
  };
}

module.exports = {
  buildMatchBucketSummary,
};
