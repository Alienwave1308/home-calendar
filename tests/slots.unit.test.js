const { generateSlots, parseTime } = require('../backend/lib/slots');

describe('parseTime', () => {
  it('should parse HH:MM into a UTC Date', () => {
    const d = parseTime('2026-03-02', '09:30');
    expect(d.getUTCHours()).toBe(9);
    expect(d.getUTCMinutes()).toBe(30);
  });

  it('should parse HH:MM:SS', () => {
    const d = parseTime('2026-03-02', '14:15:30');
    expect(d.getUTCHours()).toBe(14);
    expect(d.getUTCMinutes()).toBe(15);
    expect(d.getUTCSeconds()).toBe(30);
  });
});

describe('generateSlots', () => {
  const baseService = {
    duration_minutes: 60,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0
  };

  // 2026-03-02 is a Monday (getUTCDay()=1)
  const mondayRule = {
    day_of_week: 1,
    start_time: '09:00',
    end_time: '12:00',
    slot_granularity_minutes: 60
  };

  it('should generate slots for a working day', () => {
    const slots = generateSlots({
      service: baseService,
      rules: [mondayRule],
      exclusions: [],
      bookings: [],
      blocks: [],
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02'
    });

    // 09:00-10:00, 10:00-11:00, 11:00-12:00
    expect(slots).toHaveLength(3);
    expect(slots[0].date).toBe('2026-03-02');
    expect(slots[0].start).toBe('2026-03-02T09:00:00.000Z');
    expect(slots[0].end).toBe('2026-03-02T10:00:00.000Z');
  });

  it('should skip excluded dates', () => {
    const slots = generateSlots({
      service: baseService,
      rules: [mondayRule],
      exclusions: ['2026-03-02'],
      bookings: [],
      blocks: [],
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02'
    });

    expect(slots).toHaveLength(0);
  });

  it('should skip days without rules', () => {
    // 2026-03-03 is a Tuesday (day_of_week=2), but rule is for Monday
    const slots = generateSlots({
      service: baseService,
      rules: [mondayRule],
      exclusions: [],
      bookings: [],
      blocks: [],
      dateFrom: '2026-03-03',
      dateTo: '2026-03-03'
    });

    expect(slots).toHaveLength(0);
  });

  it('should exclude booked slots', () => {
    const slots = generateSlots({
      service: baseService,
      rules: [mondayRule],
      exclusions: [],
      bookings: [{ start_at: '2026-03-02T10:00:00Z', end_at: '2026-03-02T11:00:00Z' }],
      blocks: [],
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02'
    });

    // Only 09:00-10:00 and 11:00-12:00 should remain
    expect(slots).toHaveLength(2);
  });

  it('should exclude master blocks', () => {
    const slots = generateSlots({
      service: baseService,
      rules: [mondayRule],
      exclusions: [],
      bookings: [],
      blocks: [{ start_at: '2026-03-02T09:00:00Z', end_at: '2026-03-02T10:00:00Z' }],
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02'
    });

    expect(slots).toHaveLength(2);
  });

  it('should respect buffer_before and buffer_after', () => {
    const service = {
      duration_minutes: 60,
      buffer_before_minutes: 15,
      buffer_after_minutes: 15
    };
    // totalNeeded = 15+60+15 = 90 min
    // slotStart=09:00: 09:00+90min=10:30 <= 12:00 OK
    // slotStart=10:00: 10:00+90min=11:30 <= 12:00 OK
    // slotStart=11:00: 11:00+90min=12:30 > 12:00 SKIP
    const slots = generateSlots({
      service,
      rules: [mondayRule],
      exclusions: [],
      bookings: [],
      blocks: [],
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02'
    });

    expect(slots).toHaveLength(2);
  });

  it('should handle 30-minute granularity', () => {
    const rule = { ...mondayRule, slot_granularity_minutes: 30 };
    const slots = generateSlots({
      service: baseService,
      rules: [rule],
      exclusions: [],
      bookings: [],
      blocks: [],
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02'
    });

    // 09:00, 09:30, 10:00, 10:30, 11:00
    expect(slots).toHaveLength(5);
  });

  it('should generate across multiple days', () => {
    const tuesdayRule = { ...mondayRule, day_of_week: 2 };
    const slots = generateSlots({
      service: baseService,
      rules: [mondayRule, tuesdayRule],
      exclusions: [],
      bookings: [],
      blocks: [],
      dateFrom: '2026-03-02',
      dateTo: '2026-03-03'
    });

    // Monday 3 slots + Tuesday 3 slots
    expect(slots).toHaveLength(6);
  });

  it('should handle overlapping booking that partially blocks a slot', () => {
    // Booking from 09:30 to 10:30 should block both 09:00-10:00 and 10:00-11:00
    const slots = generateSlots({
      service: baseService,
      rules: [mondayRule],
      exclusions: [],
      bookings: [{ start_at: '2026-03-02T09:30:00Z', end_at: '2026-03-02T10:30:00Z' }],
      blocks: [],
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02'
    });

    // Only 11:00-12:00 should remain
    expect(slots).toHaveLength(1);
    expect(slots[0].start).toBe('2026-03-02T11:00:00.000Z');
  });

  it('should return empty for no rules', () => {
    const slots = generateSlots({
      service: baseService,
      rules: [],
      exclusions: [],
      bookings: [],
      blocks: [],
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02'
    });

    expect(slots).toHaveLength(0);
  });

  it('should handle Date objects in exclusions', () => {
    const slots = generateSlots({
      service: baseService,
      rules: [mondayRule],
      exclusions: [new Date('2026-03-02T00:00:00Z')],
      bookings: [],
      blocks: [],
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02'
    });

    expect(slots).toHaveLength(0);
  });
});
