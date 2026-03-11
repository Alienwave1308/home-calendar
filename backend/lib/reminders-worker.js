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

module.exports = { runReminderWorkerTick, parseVkUserId, notifyVkClientReminder };
