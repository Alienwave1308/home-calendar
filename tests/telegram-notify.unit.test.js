jest.mock('../backend/db', () => ({
  pool: { query: jest.fn() }
}));

const { pool } = require('../backend/db');
const {
  parseTelegramUserId,
  formatBookingTime,
  sendTelegramMessage,
  notifyClientReminder,
  notifyClientBookingEvent
} = require('../backend/lib/telegram-notify');

describe('telegram-notify helpers', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    delete process.env.TELEGRAM_API_BASE;
    delete process.env.TELEGRAM_API_TIMEOUT_MS;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true
    });
  });

  afterEach(() => {
    if (consoleErrorSpy) consoleErrorSpy.mockRestore();
  });

  it('parses telegram id from tg username', () => {
    expect(parseTelegramUserId('tg_123456')).toBe('123456');
    expect(parseTelegramUserId('alice')).toBeNull();
  });

  it('formats datetime in selected timezone', () => {
    const value = formatBookingTime('2026-02-20T09:00:00.000Z', 'Europe/Moscow');
    expect(value).toContain('20.02.2026');
  });

  it('sends client reminder when chat id can be resolved', async () => {
    const result = await notifyClientReminder({
      remind_at: '2026-02-19T09:00:00.000Z',
      booking: {
        start_at: '2026-02-20T09:00:00.000Z',
        service_name: 'Сахар: Бёдра',
        master_name: 'Мастер',
        timezone: 'Europe/Moscow',
        client_name: 'tg_555'
      }
    });

    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/sendMessage');
  });

  it('falls back to direct telegram api when custom api base times out', async () => {
    process.env.TELEGRAM_API_BASE = 'https://home-calendar.niggest137.workers.dev';
    process.env.TELEGRAM_API_TIMEOUT_MS = '1500';
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ ok: true });

    const result = await sendTelegramMessage('555', 'ping');

    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toBe('https://home-calendar.niggest137.workers.dev/bottest-token/sendMessage');
    expect(global.fetch.mock.calls[1][0]).toBe('https://api.telegram.org/bottest-token/sendMessage');
  });

  it('skips reminder when telegram id missing', async () => {
    const result = await notifyClientReminder({
      remind_at: '2026-02-19T09:00:00.000Z',
      booking: {
        start_at: '2026-02-20T09:00:00.000Z',
        service_name: 'Сахар: Бёдра',
        master_name: 'Мастер',
        timezone: 'Europe/Moscow',
        client_name: 'client42'
      }
    });

    expect(result.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('sends client update notification when booking changed by master', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 77,
        start_at: '2026-02-20T09:00:00.000Z',
        client_note: 'Зона бикини',
        service_name: 'Сахар: Бёдра',
        master_name: 'Лера',
        master_timezone: 'Asia/Novosibirsk',
        master_username: 'tg_111',
        client_username: 'tg_555'
      }]
    });

    const result = await notifyClientBookingEvent(77, 'updated');
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
