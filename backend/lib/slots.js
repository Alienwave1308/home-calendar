/**
 * Slot generation module for the booking system.
 *
 * generateSlots() builds available time slots based on:
 * - Availability rules (working hours per day of week)
 * - Service duration + buffers
 * - Existing bookings (occupied slots)
 * - Master blocks (manual busy time)
 * - Exclusion dates (days off, holidays)
 *
 * All dates are processed in UTC to avoid timezone issues.
 */

/**
 * @param {Object} options
 * @param {Object} options.service - { duration_minutes, buffer_before_minutes, buffer_after_minutes }
 * @param {Array}  options.rules - availability_rules rows
 * @param {Array}  options.exclusions - array of Date or date strings (YYYY-MM-DD)
 * @param {Array}  options.bookings - [{ start_at, end_at }]
 * @param {Array}  options.blocks - [{ start_at, end_at }]
 * @param {string} options.dateFrom - YYYY-MM-DD
 * @param {string} options.dateTo - YYYY-MM-DD
 * @returns {Array} Array of { date, start, end } slot objects
 */
function generateSlots({ service, rules, exclusions, bookings, blocks, dateFrom, dateTo }) {
  const slots = [];
  const duration = service.duration_minutes;
  const bufferBefore = service.buffer_before_minutes || 0;
  const bufferAfter = service.buffer_after_minutes || 0;
  const totalNeeded = bufferBefore + duration + bufferAfter;

  // Normalize exclusion dates to YYYY-MM-DD strings
  const excludedDates = new Set(
    (exclusions || []).map(d => {
      if (typeof d === 'string') return d.slice(0, 10);
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      return String(d).slice(0, 10);
    })
  );

  // Build a map of rules by day_of_week
  const rulesByDay = {};
  for (const rule of rules) {
    const dow = Number(rule.day_of_week);
    if (!rulesByDay[dow]) rulesByDay[dow] = [];
    rulesByDay[dow].push(rule);
  }

  // Normalize bookings and blocks to { start: ms, end: ms }
  const occupied = [
    ...(bookings || []).map(b => ({
      start: new Date(b.start_at).getTime(),
      end: new Date(b.end_at).getTime()
    })),
    ...(blocks || []).map(b => ({
      start: new Date(b.start_at).getTime(),
      end: new Date(b.end_at).getTime()
    }))
  ];

  // Iterate over each day in the range (UTC-based)
  const startDate = parseDate(dateFrom);
  const endDate = parseDate(dateTo);

  for (let dayMs = startDate.getTime(); dayMs <= endDate.getTime(); dayMs += 86400000) {
    const day = new Date(dayMs);
    const dateStr = day.toISOString().slice(0, 10);

    // Skip excluded dates
    if (excludedDates.has(dateStr)) continue;

    // Get UTC day of week (0=Sun, 6=Sat)
    const dow = day.getUTCDay();
    const dayRules = rulesByDay[dow];
    if (!dayRules || dayRules.length === 0) continue;

    // Generate slots for each rule window
    for (const rule of dayRules) {
      const granularity = rule.slot_granularity_minutes || 30;
      const windowStartMs = parseTimeUTC(dateStr, rule.start_time);
      const windowEndMs = parseTimeUTC(dateStr, rule.end_time);

      // Generate candidate slots at each granularity step
      for (
        let slotStartMs = windowStartMs;
        slotStartMs + totalNeeded * 60000 <= windowEndMs;
        slotStartMs += granularity * 60000
      ) {
        const serviceStartMs = slotStartMs + bufferBefore * 60000;
        const serviceEndMs = serviceStartMs + duration * 60000;
        const blockEndMs = serviceEndMs + bufferAfter * 60000;

        // Check overlap with occupied intervals
        const hasConflict = occupied.some(o =>
          o.start < blockEndMs && o.end > slotStartMs
        );

        if (!hasConflict) {
          slots.push({
            date: dateStr,
            start: new Date(serviceStartMs).toISOString(),
            end: new Date(serviceEndMs).toISOString()
          });
        }
      }
    }
  }

  return slots;
}

function getTimezoneOffsetMinutes(timezone) {
  if (timezone === 'Asia/Novosibirsk') return 420;
  if (timezone === 'Europe/Moscow') return 180;
  return 0;
}

function parseTimeParts(timeStr) {
  const [hh, mm, ss] = String(timeStr || '00:00:00').split(':').map(Number);
  return { hh: hh || 0, mm: mm || 0, ss: ss || 0 };
}

function localDateTimeToUtcMs(dateStr, timeStr, timezone) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const { hh, mm, ss } = parseTimeParts(timeStr);
  const offset = getTimezoneOffsetMinutes(timezone);
  return Date.UTC(year, (month || 1) - 1, day || 1, hh, mm, ss, 0) - offset * 60000;
}

function normalizeDateString(dateValue) {
  if (typeof dateValue === 'string') return dateValue.slice(0, 10);
  if (dateValue instanceof Date) return dateValue.toISOString().slice(0, 10);
  return String(dateValue).slice(0, 10);
}

function generateSlotsFromWindows({
  service,
  windows,
  bookings,
  blocks,
  timezone,
  stepMinutes,
  minLeadMinutes,
  nowMs
}) {
  const slots = [];
  const duration = Number(service.duration_minutes || 0);
  const bufferBefore = Number(service.buffer_before_minutes || 0);
  const bufferAfter = Number(service.buffer_after_minutes || 0);
  const totalNeededMinutes = bufferBefore + duration + bufferAfter;
  const step = Number(stepMinutes || 10);
  const leadMs = Number(minLeadMinutes || 60) * 60000;
  const now = Number(nowMs || Date.now());

  const occupied = [
    ...(bookings || []).map((b) => ({
      start: new Date(b.start_at).getTime(),
      end: new Date(b.end_at).getTime()
    })),
    ...(blocks || []).map((b) => ({
      start: new Date(b.start_at).getTime(),
      end: new Date(b.end_at).getTime()
    }))
  ];

  for (const window of windows || []) {
    const dateStr = normalizeDateString(window.date);
    const startMs = localDateTimeToUtcMs(dateStr, window.start_time, timezone);
    const endMs = localDateTimeToUtcMs(dateStr, window.end_time, timezone);
    if (endMs <= startMs) continue;

    for (
      let slotStartMs = startMs;
      slotStartMs + totalNeededMinutes * 60000 <= endMs;
      slotStartMs += step * 60000
    ) {
      const serviceStartMs = slotStartMs + bufferBefore * 60000;
      const serviceEndMs = serviceStartMs + duration * 60000;
      const blockEndMs = serviceEndMs + bufferAfter * 60000;

      if (serviceStartMs < now + leadMs) continue;

      const hasConflict = occupied.some((o) => o.start < blockEndMs && o.end > slotStartMs);
      if (hasConflict) continue;

      slots.push({
        date: dateStr,
        start: new Date(serviceStartMs).toISOString(),
        end: new Date(serviceEndMs).toISOString()
      });
    }
  }

  return slots;
}

/**
 * Parse YYYY-MM-DD into a UTC midnight Date.
 */
function parseDate(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}

/**
 * Parse a time string (HH:MM or HH:MM:SS) into UTC milliseconds on the given date.
 */
function parseTimeUTC(dateStr, timeStr) {
  const parts = String(timeStr).split(':');
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCHours(Number(parts[0]), Number(parts[1]), parts[2] ? Number(parts[2]) : 0, 0);
  return d.getTime();
}

/**
 * Parse a time string into a Date (for external use).
 */
function parseTime(dateStr, timeStr) {
  return new Date(parseTimeUTC(dateStr, timeStr));
}

module.exports = {
  generateSlots,
  generateSlotsFromWindows,
  parseTime,
  parseTimeUTC,
  localDateTimeToUtcMs
};
