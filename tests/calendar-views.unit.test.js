const {
  toIsoDate,
  addDays,
  getWeekStart,
  getWeekDates
} = require('../frontend/calendar-views');

describe('Calendar views utils', () => {
  it('should convert date to ISO yyyy-mm-dd', () => {
    expect(toIsoDate(new Date('2026-02-14T11:22:33Z'))).toBe('2026-02-14');
  });

  it('should add days correctly', () => {
    const result = addDays(new Date('2026-02-14T00:00:00Z'), 3);
    expect(toIsoDate(result)).toBe('2026-02-17');
  });

  it('should return Monday as week start for Wednesday', () => {
    const result = getWeekStart(new Date('2026-02-18T15:00:00Z'));
    expect(toIsoDate(result)).toBe('2026-02-16');
  });

  it('should return Monday as week start for Sunday', () => {
    const result = getWeekStart(new Date('2026-02-22T15:00:00Z'));
    expect(toIsoDate(result)).toBe('2026-02-16');
  });

  it('should return seven dates for a week', () => {
    const week = getWeekDates(new Date('2026-02-18T00:00:00Z')).map(toIsoDate);
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-02-16');
    expect(week[6]).toBe('2026-02-22');
  });
});
