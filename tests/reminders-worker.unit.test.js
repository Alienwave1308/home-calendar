jest.mock('../backend/db', () => ({
  pool: { query: jest.fn() }
}));

jest.mock('../backend/lib/reminders', () => ({
  processPendingReminders: jest.fn()
}));

jest.mock('../backend/lib/telegram-notify', () => ({
  notifyClientReminder: jest.fn()
}));

const { pool } = require('../backend/db');
const { processPendingReminders } = require('../backend/lib/reminders');
const { notifyClientReminder } = require('../backend/lib/telegram-notify');
const { runReminderWorkerTick } = require('../backend/lib/reminders-worker');

describe('reminders-worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns zero when no reminders', async () => {
    processPendingReminders.mockResolvedValueOnce([]);

    const result = await runReminderWorkerTick();
    expect(result.processed).toBe(0);
    expect(notifyClientReminder).not.toHaveBeenCalled();
  });

  it('requeues reminder on retryable send failure', async () => {
    processPendingReminders.mockResolvedValueOnce([
      { reminder_id: 10, booking: { client_name: 'tg_1' } }
    ]);
    notifyClientReminder.mockResolvedValueOnce({ ok: false, retryable: true });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await runReminderWorkerTick();
    expect(result.processed).toBe(1);
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE booking_reminders SET sent = false WHERE id = $1',
      [10]
    );
  });
});
