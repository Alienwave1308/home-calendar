const {
  toGoogleDateTime,
  buildGoogleCalendarUrl,
  buildIcsContent
} = require('../frontend/booking-export-utils.js');

describe('booking export utils', () => {
  it('should format UTC datetime for google calendar', () => {
    expect(toGoogleDateTime('2026-02-16T12:34:56.000Z')).toBe('20260216T123456Z');
  });

  it('should build google calendar template url', () => {
    const url = buildGoogleCalendarUrl({
      title: 'Запись на депиляцию',
      details: 'Комментарий клиента: тест',
      startIso: '2026-02-20T10:00:00.000Z',
      endIso: '2026-02-20T11:00:00.000Z',
      timezone: 'Asia/Novosibirsk'
    });

    expect(url).toContain('calendar.google.com');
    expect(url).toContain('action=TEMPLATE');
    expect(url).toContain('ctz=Asia%2FNovosibirsk');
    expect(url).toContain('dates=20260220T100000Z%2F20260220T110000Z');
  });

  it('should build valid ics body', () => {
    const ics = buildIcsContent({
      uid: 'booking-1@test',
      title: 'Запись на депиляцию',
      description: 'Комментарий клиента: зона бикини',
      startIso: '2026-02-20T10:00:00.000Z',
      endIso: '2026-02-20T11:00:00.000Z',
      timezone: 'Asia/Novosibirsk'
    });

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:booking-1@test');
    expect(ics).toContain('SUMMARY:Запись на депиляцию');
    expect(ics).toContain('X-WR-TIMEZONE:Asia/Novosibirsk');
    expect(ics).toContain('DTSTART:20260220T100000Z');
    expect(ics).toContain('DTEND:20260220T110000Z');
  });
});
