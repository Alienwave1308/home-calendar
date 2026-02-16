const { isQuietHours } = require('../backend/lib/reminders');

describe('isQuietHours', () => {
  it('should return false when no quiet hours set', () => {
    expect(isQuietHours(new Date('2026-03-02T10:00:00Z'), null, null)).toBe(false);
  });

  it('should return true during quiet hours (same day)', () => {
    // Quiet: 22:00 - 23:00, time: 22:30
    const time = new Date('2026-03-02T22:30:00Z');
    expect(isQuietHours(time, '22:00', '23:00')).toBe(true);
  });

  it('should return false outside quiet hours (same day)', () => {
    const time = new Date('2026-03-02T10:00:00Z');
    expect(isQuietHours(time, '22:00', '23:00')).toBe(false);
  });

  it('should handle overnight quiet hours (22:00 - 08:00)', () => {
    // 23:00 is in quiet zone
    expect(isQuietHours(new Date('2026-03-02T23:00:00Z'), '22:00', '08:00')).toBe(true);
    // 03:00 is in quiet zone
    expect(isQuietHours(new Date('2026-03-02T03:00:00Z'), '22:00', '08:00')).toBe(true);
    // 10:00 is NOT in quiet zone
    expect(isQuietHours(new Date('2026-03-02T10:00:00Z'), '22:00', '08:00')).toBe(false);
  });

  it('should handle boundary times', () => {
    // Exactly at start of quiet: should be quiet
    expect(isQuietHours(new Date('2026-03-02T22:00:00Z'), '22:00', '08:00')).toBe(true);
    // Exactly at end of quiet: should NOT be quiet
    expect(isQuietHours(new Date('2026-03-02T08:00:00Z'), '22:00', '08:00')).toBe(false);
  });
});
