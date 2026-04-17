'use strict';

/**
 * Telegram Bot webhook.
 *
 * POST /api/telegram/webhook
 *
 * Обрабатывает входящие апдейты от Telegram:
 * - /start booking_XXXX  — подтверждение web-записи по токену
 * - callback_query с data=confirm_XXXX / cancel_XXXX
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { sendTelegramMessage } = require('../lib/telegram-notify');
const { createReminders } = require('../lib/reminders');
const { notifyMasterBookingEvent } = require('../lib/telegram-notify');

function formatDate(isoUtc, timezone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone || 'Asia/Novosibirsk',
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(isoUtc));
}

async function getBookingByToken(token) {
  const { rows } = await pool.query(
    `SELECT b.*, s.name AS service_name, m.timezone
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN masters m ON m.id = b.master_id
     WHERE b.web_confirm_token = $1`,
    [token]
  );
  return rows[0] || null;
}

async function confirmBooking(bookingId, telegramId) {
  const { rows } = await pool.query(
    `UPDATE bookings
     SET status = 'confirmed', updated_at = NOW()
     WHERE id = $1 AND status = 'pending_confirmation'
     RETURNING *`,
    [bookingId]
  );
  if (!rows.length) return null;

  // Сохраняем telegram_id пользователя для будущих уведомлений
  await pool.query(
    `UPDATE users SET telegram_id = $1 WHERE id = (
       SELECT client_id FROM bookings WHERE id = $2
     )`,
    [String(telegramId), bookingId]
  );

  return rows[0];
}

async function cancelBooking(bookingId) {
  const { rows } = await pool.query(
    `UPDATE bookings
     SET status = 'canceled', updated_at = NOW()
     WHERE id = $1 AND status = 'pending_confirmation'
     RETURNING *`,
    [bookingId]
  );
  return rows[0] || null;
}

router.post('/webhook', async (req, res) => {
  // Отвечаем сразу — Telegram ждёт 200 в течение 5 секунд
  res.status(200).send('ok');

  const update = req.body;
  if (!update) return;

  try {
    // Обработка текстовых сообщений / команды /start
    const msg = update.message;
    if (msg && msg.text) {
      const text = msg.text.trim();
      const telegramId = msg.from && msg.from.id;

      // /start booking_TOKEN
      const startMatch = text.match(/^\/start\s+booking_([a-f0-9]{32,64})$/i);
      if (startMatch) {
        const token = startMatch[1];
        const booking = await getBookingByToken(token);

        if (!booking) {
          await sendTelegramMessage(telegramId,
            'Запись не найдена или уже обработана.'
          );
          return;
        }

        if (booking.status !== 'pending_confirmation') {
          const statusMap = { confirmed: 'подтверждена ✅', canceled: 'отменена ❌' };
          await sendTelegramMessage(telegramId,
            `Запись уже ${statusMap[booking.status] || booking.status}.`
          );
          return;
        }

        const dateStr = formatDate(booking.start_at, booking.timezone);
        const text = `📋 Ваша запись:\n\n`
          + `Услуга: ${booking.service_name}\n`
          + `Дата и время: ${dateStr}\n\n`
          + `Подтвердить запись?`;

        await sendTelegramMessageWithKeyboard(telegramId, text, {
          inline_keyboard: [[
            { text: '✅ Подтвердить', callback_data: `confirm_${token}` },
            { text: '❌ Отмена', callback_data: `cancel_${token}` }
          ]]
        });
        return;
      }
    }

    // Обработка inline callback
    const cb = update.callback_query;
    if (cb) {
      const telegramId = cb.from && cb.from.id;
      const data = cb.data || '';

      const confirmMatch = data.match(/^confirm_([a-f0-9]{32,64})$/i);
      const cancelMatch = data.match(/^cancel_([a-f0-9]{32,64})$/i);

      if (confirmMatch) {
        const booking = await getBookingByToken(confirmMatch[1]);
        if (!booking) {
          await answerCallback(cb.id, 'Запись не найдена');
          return;
        }
        const confirmed = await confirmBooking(booking.id, telegramId);
        if (confirmed) {
          await answerCallback(cb.id, 'Запись подтверждена!');
          const dateStr = formatDate(confirmed.start_at, booking.timezone);
          await sendTelegramMessage(telegramId,
            `✅ Запись подтверждена!\n\nУслуга: ${booking.service_name}\nДата: ${dateStr}\n\nНапомню за 24 ч и за 2 ч ⏰`
          );
          try {
            await createReminders(confirmed.id, confirmed.master_id, confirmed.start_at);
            await notifyMasterBookingEvent(confirmed.id, 'created');
          } catch (e) {
            console.error('[tg-webhook] side-effects error:', e.message);
          }
        } else {
          await answerCallback(cb.id, 'Запись уже обработана');
        }
        return;
      }

      if (cancelMatch) {
        const booking = await getBookingByToken(cancelMatch[1]);
        if (!booking) {
          await answerCallback(cb.id, 'Запись не найдена');
          return;
        }
        await cancelBooking(booking.id);
        await answerCallback(cb.id, 'Запись отменена');
        await sendTelegramMessage(telegramId, '❌ Запись отменена.');
        return;
      }
    }
  } catch (err) {
    console.error('[tg-webhook] error:', err);
  }
});

async function sendTelegramMessageWithKeyboard(chatId, text, replyMarkup) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      })
    });
  } catch (e) {
    console.error('[tg-webhook] sendMessage error:', e.message);
  }
}

async function answerCallback(callbackQueryId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text })
    });
  } catch (e) {
    console.error('[tg-webhook] answerCallback error:', e.message);
  }
}

module.exports = router;
