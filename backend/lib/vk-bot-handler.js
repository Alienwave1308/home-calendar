/**
 * VK Bot — state machine записи клиента.
 *
 * Состояния:
 *   IDLE             → приветствие + список услуг
 *   SELECTING_SERVICE → ждёт выбора услуги
 *   SELECTING_DATE    → ждёт выбора даты
 *   SELECTING_SLOT    → ждёт выбора времени
 *   CONFIRMING        → ждёт подтверждения / комментария / отмены
 */

'use strict';

const { pool } = require('../db');
const { sendVkMessage, buildKeyboard, emptyKeyboard, makeButton, chunkArray } = require('./vk-api');
const { getSession, setSession, clearSession } = require('./vk-bot-sessions');
const { generateSlotsFromWindows, localDateTimeToUtcMs } = require('./slots');
const { createReminders } = require('./reminders');
const { notifyMasterBookingEvent } = require('./telegram-notify');

// ─── Вспомогательные ──────────────────────────────────────────────────────────

function formatLocalTime(isoUtc, timezone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(isoUtc));
}

function formatLocalDate(isoUtc, timezone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    weekday: 'long'
  }).format(new Date(isoUtc));
}

function formatPrice(price) {
  return price ? `${Number(price)} ₽` : 'цена не указана';
}

/** Следующие N дней в формате YYYY-MM-DD */
function getUpcomingDays(n = 14) {
  const days = [];
  const now = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${dd}`);
  }
  return days;
}

/** Короткий читаемый формат даты для кнопки */
function shortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' }).format(d);
}

// ─── БД ───────────────────────────────────────────────────────────────────────

async function loadMaster() {
  const slug = process.env.MASTER_BOOKING_SLUG || 'lera';
  const { rows } = await pool.query(
    `SELECT id, display_name, timezone, booking_slug, cancel_policy_hours
     FROM masters WHERE booking_slug = $1`,
    [slug]
  );
  return rows[0] || null;
}

async function loadActiveServices(masterId) {
  const { rows } = await pool.query(
    `SELECT id, name, duration_minutes, price, description,
            buffer_before_minutes, buffer_after_minutes
     FROM services
     WHERE master_id = $1 AND is_active = true
     ORDER BY created_at ASC`,
    [masterId]
  );
  return rows;
}

async function loadMasterSettings(masterId) {
  const { rows } = await pool.query(
    `SELECT reminder_hours, min_booking_notice_minutes
     FROM master_settings WHERE master_id = $1`,
    [masterId]
  );
  return rows[0] || { reminder_hours: [24, 2], min_booking_notice_minutes: 60 };
}

async function getOrCreateVkUser(vkUserId, firstName, lastName) {
  const existing = await pool.query(
    'SELECT id, username FROM users WHERE vk_user_id = $1',
    [vkUserId]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const displayName = [firstName, lastName].filter(Boolean).join(' ') || `ВК ${vkUserId}`;
  const username = `vk_${vkUserId}`;

  const res = await pool.query(
    `INSERT INTO users (username, display_name, vk_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET vk_user_id = EXCLUDED.vk_user_id
     RETURNING id, username`,
    [username, displayName, vkUserId]
  );
  return res.rows[0];
}

async function getAvailableSlots(master, service, settings, dates) {
  const tz = master.timezone || 'Asia/Novosibirsk';
  const dateFrom = dates[0];
  const dateTo = dates[dates.length - 1];
  const startUtc = new Date(localDateTimeToUtcMs(dateFrom, '00:00:00', tz)).toISOString();
  const endUtc = new Date(localDateTimeToUtcMs(dateTo, '23:59:59', tz)).toISOString();

  const [windows, bookings, blocks] = await Promise.all([
    pool.query(
      `SELECT id, date, start_time, end_time FROM availability_windows
       WHERE master_id = $1 AND date >= $2 AND date <= $3 ORDER BY date, start_time`,
      [master.id, dateFrom, dateTo]
    ),
    pool.query(
      `SELECT start_at, end_at FROM bookings
       WHERE master_id = $1 AND status NOT IN ('canceled') AND start_at < $3 AND end_at > $2`,
      [master.id, startUtc, endUtc]
    ),
    pool.query(
      `SELECT start_at, end_at FROM master_blocks
       WHERE master_id = $1 AND start_at < $3 AND end_at > $2`,
      [master.id, startUtc, endUtc]
    )
  ]);

  return generateSlotsFromWindows({
    service,
    windows: windows.rows,
    bookings: bookings.rows,
    blocks: blocks.rows,
    timezone: tz,
    stepMinutes: 10,
    minLeadMinutes: settings.min_booking_notice_minutes ?? 60
  });
}

// ─── Шаги диалога ─────────────────────────────────────────────────────────────

async function sendServiceList(vkUserId, master) {
  const services = await loadActiveServices(master.id);
  if (!services.length) {
    await sendVkMessage(vkUserId, 'Пока нет доступных услуг. Попробуй позже!');
    return;
  }

  const rows = services.map((s) => [
    makeButton(
      `${s.name} — ${formatPrice(s.price)}`,
      { c: 'svc', id: s.id },
      'primary'
    )
  ]);
  rows.push([makeButton('❌ Отмена', { c: 'cancel' }, 'negative')]);

  await sendVkMessage(
    vkUserId,
    `Привет! 👋 Я помогу записаться к мастеру.\n\nВыбери услугу:`,
    buildKeyboard(rows)
  );

  setSession(vkUserId, { state: 'SELECTING_SERVICE', masterId: master.id, masterTimezone: master.timezone });
}

async function sendDatePicker(vkUserId, session, service, master, settings) {
  const days = getUpcomingDays(14);
  const allSlots = await getAvailableSlots(master, service, settings, days);

  // Фильтруем даты с доступными слотами
  const datesWithSlots = [...new Set(allSlots.map((s) => s.date))];

  if (!datesWithSlots.length) {
    await sendVkMessage(
      vkUserId,
      'К сожалению, свободных окон на ближайшие 2 недели нет. Напиши мастеру: @RoVVVVa',
      buildKeyboard([[makeButton('❌ Отмена', { c: 'cancel' }, 'negative')]])
    );
    return;
  }

  const dateButtons = datesWithSlots.map((d) => [
    makeButton(shortDate(d), { c: 'date', d })
  ]);
  dateButtons.push([makeButton('❌ Отмена', { c: 'cancel' }, 'negative')]);

  await sendVkMessage(
    vkUserId,
    `Услуга: *${service.name}*\nДлительность: ${service.duration_minutes} мин — ${formatPrice(service.price)}\n\nВыбери дату:`,
    buildKeyboard(dateButtons)
  );

  setSession(vkUserId, {
    ...session,
    state: 'SELECTING_DATE',
    serviceId: service.id,
    serviceName: service.name,
    serviceDuration: service.duration_minutes,
    servicePrice: Number(service.price || 0),
    serviceObj: service
  });
}

async function sendSlotPicker(vkUserId, session, date, master, settings) {
  const tz = master.timezone || 'Asia/Novosibirsk';
  const allSlots = await getAvailableSlots(master, session.serviceObj, settings, [date]);
  const daySlots = allSlots.filter((s) => s.date === date);

  if (!daySlots.length) {
    await sendVkMessage(
      vkUserId,
      'На этот день слотов нет. Выбери другую дату:',
      buildKeyboard([[makeButton('⬅️ Другую дату', { c: 'back_to_date' }), makeButton('❌ Отмена', { c: 'cancel' }, 'negative')]])
    );
    return;
  }

  // Кнопки по 4 в ряд (макс 40 кнопок = 10 рядов)
  const slotBtns = daySlots.slice(0, 40).map((s) => ({
    label: formatLocalTime(s.start, tz),
    payload: { c: 'slot', s: s.start, e: s.end }
  }));
  const rows = chunkArray(slotBtns, 4).map((chunk) =>
    chunk.map((b) => makeButton(b.label, b.payload))
  );
  rows.push([makeButton('⬅️ Другую дату', { c: 'back_to_date' }), makeButton('❌ Отмена', { c: 'cancel' }, 'negative')]);

  const readableDate = formatLocalDate(date + 'T12:00:00Z', tz);
  await sendVkMessage(
    vkUserId,
    `${readableDate}\nВыбери удобное время:`,
    buildKeyboard(rows)
  );

  setSession(vkUserId, { ...session, state: 'SELECTING_SLOT', date });
}

async function sendConfirmation(vkUserId, session) {
  const tz = session.masterTimezone || 'Asia/Novosibirsk';
  const dateStr = formatLocalDate(session.startAt, tz);
  const timeStr = formatLocalTime(session.startAt, tz);

  let text = `📋 Проверь запись:\n\n`
    + `Услуга: ${session.serviceName}\n`
    + `Дата: ${dateStr}\n`
    + `Время: ${timeStr}\n`
    + `Стоимость: ${formatPrice(session.servicePrice)}\n`
    + `Длительность: ${session.serviceDuration} мин\n`;

  if (session.comment) {
    text += `\nКомментарий: ${session.comment}\n`;
  } else {
    text += `\nЕсли хочешь оставить комментарий — напиши его, иначе нажми «Подтвердить».`;
  }

  const rows = [
    [makeButton('✅ Подтвердить', { c: 'ok' }, 'positive'), makeButton('❌ Отмена', { c: 'cancel' }, 'negative')]
  ];

  await sendVkMessage(vkUserId, text, buildKeyboard(rows));
  setSession(vkUserId, { ...session, state: 'CONFIRMING' });
}

async function createBooking(vkUserId, session) {
  const master = await loadMaster();
  if (!master) throw new Error('Мастер не найден');

  const startDate = new Date(session.startAt);
  const endDate = new Date(session.endAt);

  // Проверяем лимит активных записей
  const { rows: activeRows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM bookings
     WHERE master_id = $1 AND client_id = $2
       AND status IN ('pending','confirmed') AND start_at >= NOW()`,
    [master.id, session.dbUserId]
  );
  if (Number(activeRows[0].cnt) >= 3) {
    return { ok: false, reason: 'limit' };
  }

  const basePrice = Number(session.servicePrice || 0);
  const finalPrice = basePrice;

  try {
    const { rows } = await pool.query(
      `INSERT INTO bookings
         (master_id, client_id, service_id, extra_service_ids, start_at, end_at, status, source, client_note,
          pricing_base, pricing_final, pricing_discount_amount)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'vk', $7, $8, $9, $10)
       RETURNING *`,
      [
        master.id,
        session.dbUserId,
        session.serviceId,
        JSON.stringify([]),
        startDate.toISOString(),
        endDate.toISOString(),
        session.comment || null,
        basePrice,
        finalPrice,
        0
      ]
    );
    const booking = rows[0];

    try {
      await createReminders(booking.id, booking.master_id, booking.start_at);
      await notifyMasterBookingEvent(booking.id, 'created');
    } catch (e) {
      console.error('[vk-bot] side-effects error:', e.message);
    }

    return { ok: true, booking, finalPrice };
  } catch (err) {
    if (err.code === '23P01') return { ok: false, reason: 'conflict' };
    throw err;
  }
}

// ─── Главный обработчик ───────────────────────────────────────────────────────

/**
 * Обработать входящее сообщение от VK пользователя.
 * @param {object} msg  — объект message из VK Callback API
 * @param {object} info — { first_name, last_name } из VK Users API (если есть)
 */
async function handleVkMessage(msg, info = {}) {
  const vkUserId = msg.from_id;
  if (!vkUserId || vkUserId < 0) return; // игнорируем сообщения из чатов/групп

  let payload = null;
  if (msg.payload) {
    try { payload = JSON.parse(msg.payload); } catch { /* ignore */ }
  }
  const text = (msg.text || '').trim();
  const cmd = payload && payload.c;

  // Отмена из любого состояния
  if (cmd === 'cancel') {
    clearSession(vkUserId);
    await sendVkMessage(vkUserId, 'Запись отменена. Напиши что-нибудь, чтобы начать заново.', emptyKeyboard());
    return;
  }

  const session = getSession(vkUserId);
  const master = await loadMaster();
  if (!master) {
    await sendVkMessage(vkUserId, 'Сервис временно недоступен. Попробуй позже.');
    return;
  }
  const settings = await loadMasterSettings(master.id);

  // Создаём/получаем пользователя в БД
  const dbUser = await getOrCreateVkUser(vkUserId, info.first_name, info.last_name);

  // ── IDLE ──────────────────────────────────────────────────────────────────
  if (session.state === 'IDLE' || !session.state) {
    await sendServiceList(vkUserId, master);
    return;
  }

  // ── SELECTING_SERVICE ─────────────────────────────────────────────────────
  if (session.state === 'SELECTING_SERVICE') {
    if (cmd !== 'svc') {
      await sendServiceList(vkUserId, master);
      return;
    }
    const services = await loadActiveServices(master.id);
    const service = services.find((s) => s.id === payload.id);
    if (!service) {
      await sendVkMessage(vkUserId, 'Услуга не найдена. Выбери из списка:');
      await sendServiceList(vkUserId, master);
      return;
    }
    await sendDatePicker(vkUserId, { ...session, dbUserId: dbUser.id }, service, master, settings);
    return;
  }

  // ── SELECTING_DATE ────────────────────────────────────────────────────────
  if (session.state === 'SELECTING_DATE') {
    if (cmd !== 'date') {
      await sendVkMessage(vkUserId, 'Выбери дату из кнопок ниже 👇');
      return;
    }
    await sendSlotPicker(vkUserId, { ...session, dbUserId: dbUser.id }, payload.d, master, settings);
    return;
  }

  // ── SELECTING_SLOT ────────────────────────────────────────────────────────
  if (session.state === 'SELECTING_SLOT') {
    if (cmd === 'back_to_date') {
      // Возвращаемся к выбору даты
      const services = await loadActiveServices(master.id);
      const service = services.find((s) => s.id === session.serviceId);
      await sendDatePicker(vkUserId, { ...session, dbUserId: dbUser.id }, service, master, settings);
      return;
    }
    if (cmd !== 'slot') {
      await sendVkMessage(vkUserId, 'Выбери время из кнопок ниже 👇');
      return;
    }
    const updSession = {
      ...session,
      dbUserId: dbUser.id,
      startAt: payload.s,
      endAt: payload.e
    };
    await sendConfirmation(vkUserId, updSession);
    return;
  }

  // ── CONFIRMING ────────────────────────────────────────────────────────────
  if (session.state === 'CONFIRMING') {
    if (cmd === 'ok') {
      // Создаём запись
      let result;
      try {
        result = await createBooking(vkUserId, { ...session, dbUserId: dbUser.id });
      } catch (err) {
        console.error('[vk-bot] createBooking error:', err);
        await sendVkMessage(vkUserId, 'Произошла ошибка. Попробуй ещё раз или напиши мастеру: @RoVVVVa', emptyKeyboard());
        clearSession(vkUserId);
        return;
      }

      if (!result.ok) {
        if (result.reason === 'limit') {
          await sendVkMessage(
            vkUserId,
            'У тебя уже 3 активные записи. Для дополнительной записи напиши мастеру: @RoVVVVa',
            emptyKeyboard()
          );
        } else if (result.reason === 'conflict') {
          await sendVkMessage(
            vkUserId,
            'Это время уже занято 😔 Выбери другой слот.',
            buildKeyboard([[makeButton('🔄 Выбрать заново', { c: 'restart' })]])
          );
        }
        clearSession(vkUserId);
        return;
      }

      const tz = session.masterTimezone || 'Asia/Novosibirsk';
      let successText = `✅ Запись подтверждена!\n\n`
        + `Услуга: ${session.serviceName}\n`
        + `Дата: ${formatLocalDate(session.startAt, tz)}\n`
        + `Время: ${formatLocalTime(session.startAt, tz)}\n`
        + `Адрес: Мкр Околица д.1, кв. 60\n`;

      successText += `\n\nНапомню за 24 ч и за 2 ч до записи ⏰\n\nЧтобы записаться снова — напиши «Записаться».`;

      await sendVkMessage(vkUserId, successText, emptyKeyboard());
      clearSession(vkUserId);
      return;
    }

    // Пользователь написал текст — считаем это комментарием
    if (!cmd && text) {
      const updSession = { ...session, dbUserId: dbUser.id, comment: text };
      await sendConfirmation(vkUserId, updSession);
      return;
    }

    // Любая другая кнопка — показываем подтверждение снова
    await sendConfirmation(vkUserId, { ...session, dbUserId: dbUser.id });
    return;
  }

  // Fallback
  clearSession(vkUserId);
  await sendServiceList(vkUserId, master);
}

module.exports = { handleVkMessage };
