const { pool } = require('../db');
const SALON_ADDRESS = 'Мкр Околица д.1, квартира 60';

function parseTelegramUserId(username) {
  if (!username || typeof username !== 'string') return null;
  const match = username.match(/^tg_(\d+)$/);
  return match ? match[1] : null;
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

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('Telegram sendMessage failed:', response.status, body);
      return { ok: false, skipped: false, retryable: response.status >= 500, status: response.status, tgError: body };
    }
    return { ok: true, skipped: false, retryable: false };
  } catch (error) {
    console.error('Telegram sendMessage error:', error);
    return { ok: false, skipped: false, retryable: true };
  }
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

    const clientTelegramId = parseTelegramUserId(data.client_username);
    if (!clientTelegramId) return { ok: false, skipped: true, retryable: false };

    const isCanceled = eventType === 'canceled';
    const isCreated = eventType === 'created';
    const lines = [
      isCanceled ? '❌ Ваша запись отменена мастером' : isCreated ? '✅ Вы записаны!' : '✏️ Ваша запись была изменена мастером',
      `Услуга: ${data.service_name}`,
      `Адрес: ${SALON_ADDRESS}`,
      `Дата и время: ${formatBookingTime(data.start_at, data.master_timezone)} (${data.master_timezone || 'Asia/Novosibirsk'})`,
      `Мастер: ${data.master_name || 'Лера'}`
    ];

    if (data.client_note) {
      lines.push(`Комментарий: ${data.client_note}`);
    }
    if (isCanceled) {
      lines.push('По вопросам и для подбора нового времени: @RoVVVVa');
    }

    return await sendTelegramMessage(clientTelegramId, lines.join('\n'));
  } catch (error) {
    console.error('Error notifying client booking event:', error);
    return { ok: false, skipped: false, retryable: true };
  }
}

module.exports = {
  parseTelegramUserId,
  formatBookingTime,
  sendTelegramMessage,
  notifyMasterBookingEvent,
  notifyClientReminder,
  notifyClientBookingEvent
};
