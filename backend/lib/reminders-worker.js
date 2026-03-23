const { pool } = require('../db');
const { processPendingReminders } = require('./reminders');
const { notifyClientReminder } = require('./telegram-notify');
const { sendVkMessage } = require('./vk-api');

const SALON_ADDRESS = 'Мкр Околица д.1, квартира 60';

function parseVkUserId(username) {
  if (!username || typeof username !== 'string') return null;
  const match = username.match(/^vk_(\d+)$/);
  return match ? Number(match[1]) : null;
}

function formatBookingTime(iso, timezone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone || 'Asia/Novosibirsk',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(iso));
}

async function notifyVkClientReminder(reminder) {
  const booking = reminder && reminder.booking ? reminder.booking : null;
  if (!booking) return { ok: false, skipped: true };

  const vkUserId = parseVkUserId(booking.client_name);
  if (!vkUserId) return { ok: false, skipped: true };

  const diffMs = new Date(booking.start_at).getTime() - new Date(reminder.remind_at).getTime();
  const diffHours = Math.max(1, Math.round(diffMs / 3600000));
  const label = diffHours >= 24 ? 'за сутки' : `за ${diffHours} ч`;

  const text = [
    `⏰ Напоминание о записи (${label})`,
    `Услуга: ${booking.service_name || 'Услуга'}`,
    `Адрес: ${SALON_ADDRESS}`,
    `Дата и время: ${formatBookingTime(booking.start_at, booking.timezone)}`,
    `Мастер: ${booking.master_name || 'Мастер'}`
  ].join('\n');

  try {
    await sendVkMessage(vkUserId, text);
    return { ok: true, skipped: false };
  } catch (err) {
    console.error('[reminders-worker] VK notify error:', err.message);
    return { ok: false, skipped: false, retryable: true };
  }
}

async function runReminderWorkerTick() {
  const due = await processPendingReminders();
  if (!due.length) return { processed: 0 };

  let processed = 0;
  for (const reminder of due) {
    const booking = reminder && reminder.booking;
    const clientName = booking && booking.client_name;

    // Маршрутизируем по типу пользователя: VK или Telegram
    const sendResult = parseVkUserId(clientName)
      ? await notifyVkClientReminder(reminder)
      : await notifyClientReminder(reminder);

    if (!sendResult.ok && sendResult.retryable) {
      await pool.query(
        'UPDATE booking_reminders SET sent = false WHERE id = $1',
        [reminder.reminder_id]
      );
    }
    processed += 1;
  }

  return { processed };
}

async function notifyVkClientBookingEvent(bookingId, eventType) {
  const { rows } = await pool.query(
    `SELECT
       b.start_at,
       b.client_note,
       s.name AS service_name,
       m.display_name AS master_name,
       m.timezone AS master_timezone,
       client_user.username AS client_username
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN masters m ON m.id = b.master_id
     JOIN users client_user ON client_user.id = b.client_id
     WHERE b.id = $1`,
    [bookingId]
  );
  const data = rows[0];
  if (!data) return { ok: false, skipped: true };

  const vkUserId = parseVkUserId(data.client_username);
  if (!vkUserId) return { ok: false, skipped: true };

  const isCanceled = eventType === 'canceled';
  const isCreated = eventType === 'created';
  const lines = [
    isCanceled ? '❌ Ваша запись отменена мастером' : isCreated ? '✅ Вы записаны!' : '✏️ Ваша запись была изменена мастером',
    `Услуга: ${data.service_name}`,
    `Адрес: ${SALON_ADDRESS}`,
    `Дата и время: ${formatBookingTime(data.start_at, data.master_timezone)}`,
    `Мастер: ${data.master_name || 'Лера'}`
  ];
  if (data.client_note) lines.push(`Комментарий: ${data.client_note}`);
  if (isCanceled) lines.push('По вопросам и для подбора нового времени: vk.com/rovvvva');

  try {
    await sendVkMessage(vkUserId, lines.join('\n'));
    return { ok: true, skipped: false };
  } catch (err) {
    console.error('[reminders-worker] VK booking notify error:', err.message);
    return { ok: false, skipped: false, retryable: true };
  }
}

module.exports = { runReminderWorkerTick, parseVkUserId, notifyVkClientReminder, notifyVkClientBookingEvent };
