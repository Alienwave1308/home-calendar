/* eslint-disable no-undef */
(function () {
  'use strict';

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function toGoogleDateTime(isoString) {
    const date = new Date(isoString);
    return (
      date.getUTCFullYear()
      + pad2(date.getUTCMonth() + 1)
      + pad2(date.getUTCDate()) + 'T'
      + pad2(date.getUTCHours())
      + pad2(date.getUTCMinutes())
      + pad2(date.getUTCSeconds()) + 'Z'
    );
  }

  function escapeIcsText(input) {
    return String(input || '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function buildGoogleCalendarUrl(params) {
    const title = params.title || 'Запись на процедуру';
    const details = params.details || '';
    const timezone = params.timezone || 'UTC';
    const location = params.location || '';
    const calendarName = params.calendarName || 'RoVa Epil';
    const start = toGoogleDateTime(params.startIso);
    const end = toGoogleDateTime(params.endIso);
    const url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action', 'TEMPLATE');
    url.searchParams.set('text', title);
    url.searchParams.set('details', (details ? details + '\n' : '') + 'Календарь: ' + calendarName);
    if (location) url.searchParams.set('location', location);
    url.searchParams.set('dates', start + '/' + end);
    url.searchParams.set('ctz', timezone);
    return url.toString();
  }

  function buildIcsContent(params) {
    const uid = params.uid || ('booking-' + Date.now() + '@miniapp');
    const title = escapeIcsText(params.title || 'Запись на процедуру');
    const description = escapeIcsText(params.description || '');
    const location = escapeIcsText(params.location || '');
    const timezone = params.timezone || 'UTC';
    const dtStamp = toGoogleDateTime(new Date().toISOString());
    const dtStart = toGoogleDateTime(params.startIso);
    const dtEnd = toGoogleDateTime(params.endIso);

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//RoVa Epil//Mini App//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-TIMEZONE:' + timezone,
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + dtStamp,
      'DTSTART:' + dtStart,
      'DTEND:' + dtEnd,
      'SUMMARY:' + title,
      description ? ('DESCRIPTION:' + description) : '',
      location ? ('LOCATION:' + location) : '',
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');
  }

  const api = {
    toGoogleDateTime: toGoogleDateTime,
    buildGoogleCalendarUrl: buildGoogleCalendarUrl,
    buildIcsContent: buildIcsContent
  };

  if (typeof window !== 'undefined') {
    window.BookingExportUtils = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
