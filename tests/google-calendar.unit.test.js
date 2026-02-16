// Mock googleapis before requiring the module
const mockGenerateAuthUrl = jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?test');
const mockGetToken = jest.fn().mockResolvedValue({
  tokens: { access_token: 'at_123', refresh_token: 'rt_456', expiry_date: Date.now() + 3600000 }
});
const mockSetCredentials = jest.fn();
const mockRefreshAccessToken = jest.fn();
const mockRevokeToken = jest.fn();

const mockEventsInsert = jest.fn();
const mockEventsUpdate = jest.fn();
const mockEventsDelete = jest.fn();
const mockFreebusyQuery = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: mockGenerateAuthUrl,
        getToken: mockGetToken,
        setCredentials: mockSetCredentials,
        refreshAccessToken: mockRefreshAccessToken,
        revokeToken: mockRevokeToken
      }))
    },
    calendar: jest.fn().mockReturnValue({
      events: {
        insert: mockEventsInsert,
        update: mockEventsUpdate,
        delete: mockEventsDelete
      },
      freebusy: { query: mockFreebusyQuery }
    })
  }
}));

jest.mock('../backend/db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

const { pool } = require('../backend/db');
const {
  getAuthUrl,
  handleCallback,
  bookingHash,
  pushBookingToCalendar,
  deleteCalendarEvent,
  pullBusyTimes,
  disconnectCalendar
} = require('../backend/lib/google-calendar');

describe('Google Calendar lib', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAuthUrl', () => {
    it('should return an authorization URL', () => {
      const url = getAuthUrl(1);
      expect(url).toContain('https://accounts.google.com');
      expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          access_type: 'offline',
          state: '1'
        })
      );
    });
  });

  describe('handleCallback', () => {
    it('should exchange code and save binding', async () => {
      const binding = { id: 1, user_id: 1, provider: 'google', access_token: 'at_123' };
      pool.query.mockResolvedValueOnce({ rows: [binding] });

      const result = await handleCallback('auth_code_123', 1);

      expect(mockGetToken).toHaveBeenCalledWith('auth_code_123');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO calendar_sync_bindings'),
        expect.arrayContaining([1, 'at_123'])
      );
      expect(result).toEqual(binding);
    });
  });

  describe('bookingHash', () => {
    it('should produce consistent hash for same data', () => {
      const booking = { start_at: '2026-03-02T10:00:00Z', end_at: '2026-03-02T11:00:00Z', status: 'confirmed', service_name: 'Маникюр' };
      const h1 = bookingHash(booking);
      const h2 = bookingHash(booking);
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(16);
    });

    it('should produce different hash for different data', () => {
      const b1 = { start_at: '2026-03-02T10:00:00Z', end_at: '2026-03-02T11:00:00Z', status: 'confirmed', service_name: 'Маникюр' };
      const b2 = { start_at: '2026-03-02T12:00:00Z', end_at: '2026-03-02T13:00:00Z', status: 'confirmed', service_name: 'Маникюр' };
      expect(bookingHash(b1)).not.toBe(bookingHash(b2));
    });
  });

  describe('pushBookingToCalendar', () => {
    const binding = {
      id: 1, user_id: 1, access_token: 'at_123', refresh_token: 'rt_456',
      token_expire_at: new Date(Date.now() + 3600000).toISOString(),
      external_calendar_id: null, sync_mode: 'push'
    };

    const booking = {
      id: 10, start_at: '2026-03-02T10:00:00Z', end_at: '2026-03-02T11:00:00Z',
      status: 'confirmed', service_name: 'Маникюр', client_name: 'Анна'
    };

    it('should return null if no binding exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // getAuthenticatedClient

      const result = await pushBookingToCalendar(1, booking);
      expect(result).toBeNull();
    });

    it('should create new event when no mapping exists', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [binding] }) // getAuthenticatedClient
        .mockResolvedValueOnce({ rows: [] }) // no existing mapping
        .mockResolvedValueOnce({ rows: [{ id: 1, external_event_id: 'gcal_evt_1' }] }); // insert mapping

      mockEventsInsert.mockResolvedValueOnce({ data: { id: 'gcal_evt_1' } });

      const result = await pushBookingToCalendar(1, booking);

      expect(mockEventsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          requestBody: expect.objectContaining({
            summary: 'Маникюр — Анна'
          })
        })
      );
      expect(result.external_event_id).toBe('gcal_evt_1');
    });

    it('should skip update if hash matches (idempotency)', async () => {
      const hash = bookingHash(booking);
      pool.query
        .mockResolvedValueOnce({ rows: [binding] })
        .mockResolvedValueOnce({ rows: [{ id: 1, external_event_id: 'gcal_evt_1', last_pushed_hash: hash }] });

      const result = await pushBookingToCalendar(1, booking);

      expect(mockEventsUpdate).not.toHaveBeenCalled();
      expect(result.last_pushed_hash).toBe(hash);
    });

    it('should update event when hash differs', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [binding] })
        .mockResolvedValueOnce({ rows: [{ id: 1, external_event_id: 'gcal_evt_1', last_pushed_hash: 'old_hash' }] })
        .mockResolvedValueOnce({}); // update hash

      mockEventsUpdate.mockResolvedValueOnce({});

      await pushBookingToCalendar(1, booking);

      expect(mockEventsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'gcal_evt_1'
        })
      );
    });
  });

  describe('deleteCalendarEvent', () => {
    const binding = {
      id: 1, access_token: 'at_123', refresh_token: 'rt_456',
      token_expire_at: new Date(Date.now() + 3600000).toISOString(),
      external_calendar_id: null
    };

    it('should delete event and mapping', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [binding] }) // getAuthenticatedClient
        .mockResolvedValueOnce({ rows: [{ id: 1, external_event_id: 'gcal_evt_1' }] }) // mapping
        .mockResolvedValueOnce({}); // delete mapping

      mockEventsDelete.mockResolvedValueOnce({});

      await deleteCalendarEvent(1, 10);

      expect(mockEventsDelete).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'gcal_evt_1' })
      );
    });

    it('should ignore 404 on already-deleted event', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [binding] })
        .mockResolvedValueOnce({ rows: [{ id: 1, external_event_id: 'gcal_evt_1' }] })
        .mockResolvedValueOnce({});

      mockEventsDelete.mockRejectedValueOnce({ code: 404 });

      await expect(deleteCalendarEvent(1, 10)).resolves.not.toThrow();
    });
  });

  describe('pullBusyTimes', () => {
    it('should return empty array if not in hybrid mode', async () => {
      const binding = {
        id: 1, access_token: 'at_123', refresh_token: 'rt_456',
        token_expire_at: new Date(Date.now() + 3600000).toISOString(),
        sync_mode: 'push', external_calendar_id: null
      };
      pool.query.mockResolvedValueOnce({ rows: [binding] });

      const result = await pullBusyTimes(1, '2026-03-02', '2026-03-08');
      expect(result).toEqual([]);
    });

    it('should return busy times in hybrid mode', async () => {
      const binding = {
        id: 1, access_token: 'at_123', refresh_token: 'rt_456',
        token_expire_at: new Date(Date.now() + 3600000).toISOString(),
        sync_mode: 'hybrid', external_calendar_id: 'primary'
      };
      pool.query
        .mockResolvedValueOnce({ rows: [binding] }) // getAuthenticatedClient
        .mockResolvedValueOnce({}); // update last_sync_at

      mockFreebusyQuery.mockResolvedValueOnce({
        data: {
          calendars: {
            primary: {
              busy: [
                { start: '2026-03-02T10:00:00Z', end: '2026-03-02T11:00:00Z' },
                { start: '2026-03-03T14:00:00Z', end: '2026-03-03T15:00:00Z' }
              ]
            }
          }
        }
      });

      const result = await pullBusyTimes(1, '2026-03-02', '2026-03-08');
      expect(result).toHaveLength(2);
      expect(result[0].start).toBe('2026-03-02T10:00:00Z');
    });
  });

  describe('disconnectCalendar', () => {
    it('should revoke token and delete binding', async () => {
      const binding = {
        id: 1, access_token: 'at_123', refresh_token: 'rt_456',
        token_expire_at: new Date(Date.now() + 3600000).toISOString()
      };
      pool.query
        .mockResolvedValueOnce({ rows: [binding] }) // getAuthenticatedClient
        .mockResolvedValueOnce({}) // delete binding
        .mockResolvedValueOnce({}); // delete mappings

      mockRevokeToken.mockResolvedValueOnce({});

      await disconnectCalendar(1);

      expect(mockRevokeToken).toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM calendar_sync_bindings'),
        [1, 'google']
      );
    });
  });
});
