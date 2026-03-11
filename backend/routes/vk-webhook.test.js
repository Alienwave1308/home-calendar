/**
 * Тесты VK Callback API webhook и вспомогательных модулей.
 */

const request = require('supertest');

// Мокаем зависимости до загрузки app
jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

jest.mock('../lib/vk-bot-handler', () => ({
  handleVkMessage: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../lib/vk-api', () => ({
  sendVkMessage: jest.fn().mockResolvedValue(undefined),
  buildKeyboard: jest.fn((rows) => ({ buttons: rows })),
  emptyKeyboard: jest.fn(() => ({ one_time: true, inline: false, buttons: [] })),
  makeButton: jest.fn((label, payload, color = 'secondary') => ({
    action: { type: 'text', label, payload: JSON.stringify(payload) },
    color
  })),
  chunkArray: jest.fn((arr, size) => {
    const result = [];
    for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
    return result;
  })
}));

const app = require('../server');
const { handleVkMessage } = require('../lib/vk-bot-handler');

// ─── vk-bot-sessions ─────────────────────────────────────────────────────────

describe('vk-bot-sessions', () => {
  // Загружаем модуль сессий напрямую (он не зависит от мокнутых модулей)
  const sessions = require('../lib/vk-bot-sessions');

  beforeEach(() => {
    // Чистим сессии между тестами
    sessions.clearSession(1);
    sessions.clearSession(2);
    sessions.clearSession(3);
    sessions.clearSession(99999);
  });

  it('возвращает IDLE для незнакомого пользователя', () => {
    expect(sessions.getSession(99999)).toEqual({ state: 'IDLE' });
  });

  it('сохраняет и возвращает сессию', () => {
    sessions.setSession(1, { state: 'SELECTING_DATE', serviceId: 5 });
    expect(sessions.getSession(1)).toEqual({ state: 'SELECTING_DATE', serviceId: 5 });
  });

  it('clearSession удаляет сессию', () => {
    sessions.setSession(2, { state: 'CONFIRMING' });
    sessions.clearSession(2);
    expect(sessions.getSession(2)).toEqual({ state: 'IDLE' });
  });

  it('перезаписывает существующую сессию', () => {
    sessions.setSession(3, { state: 'SELECTING_SERVICE' });
    sessions.setSession(3, { state: 'SELECTING_SLOT', date: '2026-04-01' });
    expect(sessions.getSession(3)).toMatchObject({ state: 'SELECTING_SLOT', date: '2026-04-01' });
  });
});

// ─── vk-api helpers ──────────────────────────────────────────────────────────

describe('vk-api helpers (реальный модуль)', () => {
  // Загружаем реальный модуль, минуя мок
  const vkApi = jest.requireActual('../lib/vk-api');

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  describe('makeButton', () => {
    it('создаёт кнопку с корректной структурой', () => {
      const btn = vkApi.makeButton('Тест', { c: 'svc', id: 1 }, 'primary');
      expect(btn).toMatchObject({
        action: { type: 'text', label: 'Тест' },
        color: 'primary'
      });
      expect(JSON.parse(btn.action.payload)).toEqual({ c: 'svc', id: 1 });
    });

    it('обрезает label до 40 символов', () => {
      const longLabel = 'А'.repeat(50);
      const btn = vkApi.makeButton(longLabel, {});
      expect(btn.action.label.length).toBe(40);
    });

    it('использует secondary по умолчанию', () => {
      const btn = vkApi.makeButton('Ok', {});
      expect(btn.color).toBe('secondary');
    });
  });

  describe('buildKeyboard', () => {
    it('строит клавиатуру с one_time=true', () => {
      const kb = vkApi.buildKeyboard([[]], true);
      expect(kb).toMatchObject({ one_time: true, inline: false });
    });

    it('строит клавиатуру с one_time=false', () => {
      const kb = vkApi.buildKeyboard([[]], false);
      expect(kb.one_time).toBe(false);
    });
  });

  describe('chunkArray', () => {
    it('разбивает массив на чанки', () => {
      expect(vkApi.chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('возвращает пустой массив для пустого ввода', () => {
      expect(vkApi.chunkArray([], 3)).toEqual([]);
    });
  });

  describe('emptyKeyboard', () => {
    it('возвращает клавиатуру с пустыми кнопками', () => {
      const kb = vkApi.emptyKeyboard();
      expect(kb).toMatchObject({ one_time: true, buttons: [] });
    });
  });
});

// ─── reminders-worker helpers ─────────────────────────────────────────────────

describe('reminders-worker: parseVkUserId', () => {
  // Загружаем реальный модуль
  const { parseVkUserId } = jest.requireActual('../lib/reminders-worker');

  it('возвращает число для vk_-префикса', () => {
    expect(parseVkUserId('vk_123456')).toBe(123456);
  });

  it('возвращает null для tg_-префикса', () => {
    expect(parseVkUserId('tg_123456')).toBeNull();
  });

  it('возвращает null для пустой строки', () => {
    expect(parseVkUserId('')).toBeNull();
  });

  it('возвращает null для null', () => {
    expect(parseVkUserId(null)).toBeNull();
  });

  it('возвращает null для произвольного текста', () => {
    expect(parseVkUserId('someuser')).toBeNull();
  });
});

// ─── VK Webhook endpoint ──────────────────────────────────────────────────────

describe('POST /api/vk/webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VK_SECRET = 'test-secret';
    process.env.VK_CONFIRMATION_STRING = 'abc123';
    process.env.VK_GROUP_TOKEN = '';
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ response: [{ first_name: 'Иван', last_name: 'Иванов' }] })
    });
  });

  it('возвращает confirmation string на событие confirmation', async () => {
    const res = await request(app)
      .post('/api/vk/webhook')
      .send({ type: 'confirmation', secret: 'test-secret' });

    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123');
  });

  it('возвращает 403 при неверном секрете', async () => {
    const res = await request(app)
      .post('/api/vk/webhook')
      .send({ type: 'confirmation', secret: 'wrong-secret' });

    expect(res.status).toBe(403);
  });

  it('возвращает ok на message_new', async () => {
    const res = await request(app)
      .post('/api/vk/webhook')
      .send({
        type: 'message_new',
        secret: 'test-secret',
        object: {
          message: { from_id: 123456, text: 'Привет', payload: null }
        }
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  it('вызывает handleVkMessage для входящего сообщения', async () => {
    await request(app)
      .post('/api/vk/webhook')
      .send({
        type: 'message_new',
        secret: 'test-secret',
        object: {
          message: { from_id: 777, text: 'Записаться', payload: null }
        }
      });

    // Даём время на async обработку (после res.send)
    await new Promise((r) => setTimeout(r, 100));
    expect(handleVkMessage).toHaveBeenCalledWith(
      expect.objectContaining({ from_id: 777, text: 'Записаться' }),
      expect.any(Object)
    );
  });

  it('игнорирует сообщения из групп (from_id < 0)', async () => {
    await request(app)
      .post('/api/vk/webhook')
      .send({
        type: 'message_new',
        secret: 'test-secret',
        object: {
          message: { from_id: -123, text: 'test' }
        }
      });

    await new Promise((r) => setTimeout(r, 100));
    expect(handleVkMessage).not.toHaveBeenCalled();
  });

  it('возвращает ok для неизвестных типов событий', async () => {
    const res = await request(app)
      .post('/api/vk/webhook')
      .send({ type: 'wall_post_new', secret: 'test-secret' });

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });
});
