/**
 * Split a date range into DGFT eBRC bulk-download chunks.
 * Per calendar month:
 *   - 31-day month: 1–15 and 16–31
 *   - 30-day month: 1–15 and 16–30
 *   - February: 1–15 and 16–last day
 * Chunks are clipped to the user's selected from/to range.
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDdMmYyyy(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function parseDdMmYyyy(value) {
  const raw = String(value || "").trim();
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function parseIsoYyyyMmDd(value) {
  const raw = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function parseEbrcInputDate(value) {
  return parseDdMmYyyy(value) || parseIsoYyyyMmDd(value);
}

function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}


function compareDatesOnly(a, b) {
  return startOfDay(a).getTime() - startOfDay(b).getTime();
}

function maxDate(a, b) {
  return compareDatesOnly(a, b) >= 0 ? startOfDay(a) : startOfDay(b);
}

function minDate(a, b) {
  return compareDatesOnly(a, b) <= 0 ? startOfDay(a) : startOfDay(b);
}

function monthSegments(year, monthIndex) {
  const daysInMonth = getDaysInMonth(year, monthIndex);
  return [
    {
      from: new Date(year, monthIndex, 1),
      to: new Date(year, monthIndex, Math.min(15, daysInMonth)),
    },
    {
      from: new Date(year, monthIndex, 16),
      to: new Date(year, monthIndex, daysInMonth),
    },
  ];
}

/**
 * @param {string|Date} fromInput
 * @param {string|Date} toInput
 * @returns {{ chunks: { fromDate: string, toDate: string, days: number }[], error?: string }}
 */
function splitEbrcDateRange(fromInput, toInput) {
  const startDate =
    fromInput instanceof Date ? startOfDay(fromInput) : parseEbrcInputDate(fromInput);
  const endDate = toInput instanceof Date ? startOfDay(toInput) : parseEbrcInputDate(toInput);

  if (!startDate || !endDate) {
    return { chunks: [], error: "fromDate and toDate are required (DD/MM/YYYY)." };
  }
  if (compareDatesOnly(startDate, endDate) > 0) {
    return { chunks: [], error: "fromDate must be before or equal to toDate." };
  }

  const chunks = [];
  let year = startDate.getFullYear();
  let month = startDate.getMonth();

  while (true) {
    const segments = monthSegments(year, month);
    for (const segment of segments) {
      if (segment.from.getDate() > segment.to.getDate()) continue;

      const chunkFrom = maxDate(segment.from, startDate);
      const chunkTo = minDate(segment.to, endDate);

      if (compareDatesOnly(chunkFrom, chunkTo) <= 0) {
        const fromDate = formatDdMmYyyy(chunkFrom);
        const toDate = formatDdMmYyyy(chunkTo);
        const days =
          Math.floor((startOfDay(chunkTo).getTime() - startOfDay(chunkFrom).getTime()) / 86400000) +
          1;
        chunks.push({ fromDate, toDate, days });
      }
    }

    if (year === endDate.getFullYear() && month === endDate.getMonth()) break;

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    if (new Date(year, month, 1).getTime() > endDate.getTime()) break;
  }

  return { chunks };
}

module.exports = {
  formatDdMmYyyy,
  parseDdMmYyyy,
  parseEbrcInputDate,
  splitEbrcDateRange,
};
