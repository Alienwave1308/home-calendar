const { pool } = require('../db');
const { sendVkMessage } = require('./vk-api');
const SALON_ADDRESS = process.env.SALON_ADDRESS || 'Мкр Околица д.1, квартира 60';

function parseTelegramUserId(username) {
  if (!username || typeof username !== 'string') return null;
  const match = username.match(/^tg_(\d+)$/);
  return match ? match[1] : null;
}

function parseVkUserId(username) {
  if (!username || typeof username !== 'string') return null;
  const match = username.match(/^vk_(\d+)$/);
  return match ? Number(match[1]) : null;
}

function formatBookingTime(iso, timezone) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone || 'Asia/Novosibirsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function getTelegramApiBases() {
  const configuredBase = String(process.env.TELEGRAM_API_BASE || '').trim();
  const directBase = 'https://api.telegram.org';
  return configuredBase && configuredBase !== directBase
    ? [configuredBase, directBase]
    : [directBase];
}

function describeTelegramNetworkError(error) {
  const primary = String(error && error.message ? error.message : error || 'unknown error');
  const cause = error && error.cause;
  const details = [];

  if (cause) {
    if (cause.code) details.push(String(cause.code));
    if (cause.errno && cause.errno !== cause.code) details.push(String(cause.errno));
    if (cause.syscall) details.push(String(cause.syscall));
    if (cause.hostname) details.push(String(cause.hostname));
    if (cause.message && cause.message !== primary) details.push(String(cause.message));
  }

  return [primary].concat(details).filter(Boolean).join(' | ');
}

async function telegramApiCall(method, payload, options) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('[notify] telegramApiCall skipped: botToken=MISSING method=%s', method);
    return { ok: false, skipped: true, retryable: false };
  }
  if (typeof fetch !== 'function') {
    console.warn('[notify] telegramApiCall skipped: fetch is not available');
    return { ok: false, skipped: true, retryable: false };
  }

  const timeoutMs = Math.max(1000, Number(process.env.TELEGRAM_API_TIMEOUT_MS || (options && options.timeoutMs) || 4000));
  const apiBases = getTelegramApiBases();
  let lastFailure = null;

  for (let i = 0; i < apiBases.length; i += 1) {
    const apiBase = apiBases[i];
    const AbortControllerCtor = typeof globalThis.AbortController === 'function'
      ? globalThis.AbortController
      : null;
    const controller = AbortControllerCtor ? new AbortControllerCtor() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
      : null;

    try {
      const response = await fetch(`${apiBase}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: controller ? controller.signal : undefined
      });

      if (timeout) clearTimeout(timeout);

      let rawBody = '';
      let data = null;
      if (typeof response.text === 'function') {
        rawBody = await response.text().catch(() => '');
        if (rawBody) {
          try {
            data = JSON.parse(rawBody);
          } catch (parseError) {
            data = null;
          }
        }
      } else if (typeof response.json === 'function') {
        data = await response.json().catch(() => null);
        rawBody = data ? JSON.stringify(data) : '';
      } else if (response.ok) {
        data = { ok: true, result: null };
      }

      if (!response.ok || !data || data.ok === false) {
        const tgError = (data && data.description) || rawBody || `HTTP ${response.status}`;
        lastFailure = {
          ok: false,
          skipped: false,
          retryable: response.status >= 500,
          status: response.status,
          tgError,
          apiBase
        };
        console.error('Telegram %s failed via %s:', method, apiBase, tgError);
        if (i < apiBases.length - 1) continue;
        return lastFailure;
      }

      return {
        ok: true,
        skipped: false,
        retryable: false,
        status: response.status,
        apiBase,
        data,
        result: data.result
      };
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      const tgError = 'network: ' + describeTelegramNetworkError(error);
      console.error('Telegram %s error via %s:', method, apiBase, error);
      lastFailure = {
        ok: false,
        skipped: false,
        retryable: true,
        tgError,
        apiBase
      };
      if (i < apiBases.length - 1) continue;
      return lastFailure;
    }
  }

  return lastFailure || { ok: false, skipped: false, retryable: true, tgError: 'network: unknown error' };
}

function buildTelegramFileUrl(filePath, apiBase) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !filePath) return null;
  const base = apiBase || getTelegramApiBases()[0];
  return `${base}/file/bot${botToken}/${filePath}`;
}

async function sendTelegramMessage(chatId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !chatId || !text) {
    console.warn('[notify] sendTelegramMessage skipped: botToken=%s chatId=%s textLen=%s',
      botToken ? 'set' : 'MISSING', chatId || 'MISSING', text ? text.length : 0);
    return { ok: false, skipped: true, retryable: false };
  }
  if (typeof fetch !== 'function') {
    console.warn('[notify] sendTelegramMessage skipped: fetch is not available');
    return { ok: false, skipped: true, retryable: false };
  }

  const result = await telegramApiCall('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });

  return {
    ok: result.ok,
    skipped: result.skipped,
    retryable: result.retryable,
    status: result.status,
    tgError: result.tgError
  };
}

async function loadBookingNotificationData(bookingId) {
  const { rows } = await pool.query(
    `SELECT
       b.id,
       b.start_at,
       b.client_note,
       s.name AS service_name,
       m.display_name AS master_name,
       m.timezone AS master_timezone,
       master_user.username AS master_username,
       client_user.username AS client_username
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN masters m ON m.id = b.master_id
     JOIN users master_user ON master_user.id = m.user_id
     JOIN users client_user ON client_user.id = b.client_id
     WHERE b.id = $1`,
    [bookingId]
  );

  return rows[0] || null;
}

async function notifyMasterBookingEvent(bookingId, eventType) {
  try {
    const data = await loadBookingNotificationData(bookingId);
    if (!data) {
      console.warn('[notify] notifyMasterBookingEvent: no booking data for id', bookingId);
      return { ok: false, skipped: true, retryable: false };
    }

    const masterTelegramId = parseTelegramUserId(data.master_username);
    if (!masterTelegramId) {
      console.warn('[notify] notifyMasterBookingEvent: master username not tg_ format:', data.master_username);
      return { ok: false, skipped: true, retryable: false };
    }

    const clientTelegramId = parseTelegramUserId(data.client_username);
    const actionTitle = eventType === 'created' ? 'Новая запись' : 'Запись обновлена';
    const lines = [
      `📌 ${actionTitle}`,
      `Клиент: ${data.client_username}`
    ];

    if (clientTelegramId) {
      lines.push(`Контакт: tg://user?id=${clientTelegramId}`);
    }

    lines.push(`Услуга: ${data.service_name}`);
    lines.push(`Адрес: ${SALON_ADDRESS}`);
    lines.push(`Дата и время: ${formatBookingTime(data.start_at, data.master_timezone)} (${data.master_timezone || 'Asia/Novosibirsk'})`);
    if (data.client_note) {
      lines.push(`Комментарий: ${data.client_note}`);
    }

    const result = await sendTelegramMessage(masterTelegramId, lines.join('\n'));
    if (!result.ok && !result.skipped) {
      console.warn('[notify] notifyMasterBookingEvent failed for booking', bookingId, 'chatId', masterTelegramId, result);
    }
    return result;
  } catch (error) {
    console.error('Error notifying master booking event:', error);
    return { ok: false, skipped: false, retryable: true };
  }
}

async function notifyClientReminder(reminder) {
  const booking = reminder && reminder.booking ? reminder.booking : null;
  if (!booking) return { ok: false, skipped: true, retryable: false };

  const clientTelegramId = parseTelegramUserId(booking.client_name);
  if (!clientTelegramId) return { ok: false, skipped: true, retryable: false };

  const diffMs = new Date(booking.start_at).getTime() - new Date(reminder.remind_at).getTime();
  const diffHours = Math.max(1, Math.round(diffMs / 3600000));
  const label = diffHours >= 24 ? 'за сутки' : `за ${diffHours} ч`;
  const text = [
    `⏰ Напоминание о записи (${label})`,
    `Услуга: ${booking.service_name || 'Услуга'}`,
    `Адрес: ${SALON_ADDRESS}`,
    `Дата и время: ${formatBookingTime(booking.start_at, booking.timezone)} (${booking.timezone || 'Asia/Novosibirsk'})`,
    `Мастер: ${booking.master_name || 'Мастер'}`
  ].join('\n');

  return sendTelegramMessage(clientTelegramId, text);
}

async function notifyClientBookingEvent(bookingId, eventType) {
  try {
    const data = await loadBookingNotificationData(bookingId);
    if (!data) return { ok: false, skipped: true, retryable: false };

    const isCanceled = eventType === 'canceled';
    const isCreated = eventType === 'created';
    const lines = [
      isCanceled ? '❌ Ваша запись отменена мастером' : isCreated ? '✅ Вы записаны!' : '✏️ Ваша запись была изменена мастером',
      `Услуга: ${data.service_name}`,
      `Адрес: ${SALON_ADDRESS}`,
      `Дата и время: ${formatBookingTime(data.start_at, data.master_timezone)} (${data.master_timezone || 'Asia/Novosibirsk'})`,
      `Мастер: ${data.master_name || 'Лера'}`
    ];
    if (data.client_note) lines.push(`Комментарий: ${data.client_note}`);
    if (isCanceled) lines.push('По вопросам и для подбора нового времени: @RoVVVVa');
    const text = lines.join('\n');

    const clientTelegramId = parseTelegramUserId(data.client_username);
    if (clientTelegramId) {
      return await sendTelegramMessage(clientTelegramId, text);
    }

    const clientVkId = parseVkUserId(data.client_username);
    if (clientVkId) {
      try {
        await sendVkMessage(clientVkId, text);
        return { ok: true, skipped: false, retryable: false };
      } catch (vkError) {
        console.warn('[notify] VK client notify failed for booking', bookingId, vkError.message);
        return { ok: false, skipped: false, retryable: true };
      }
    }

    return { ok: false, skipped: true, retryable: false };
  } catch (error) {
    console.error('Error notifying client booking event:', error);
    return { ok: false, skipped: false, retryable: true };
  }
}

module.exports = {
  parseTelegramUserId,
  formatBookingTime,
  telegramApiCall,
  buildTelegramFileUrl,
  sendTelegramMessage,
  notifyMasterBookingEvent,
  notifyClientReminder,
  notifyClientBookingEvent
};
