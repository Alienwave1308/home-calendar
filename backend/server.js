// Загружаем переменные окружения из .env файла
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Импортируем Express - это библиотека для создания веб-сервера
const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { getWebBookingPublicConfig } = require('./lib/web-booking');

// Создаём приложение Express
const app = express();

// Порт на котором будет работать сервер
const PORT = process.env.PORT || 3000;

// === Security Middleware ===

// Trust first proxy (Caddy) so rate limiters use real client IP from X-Forwarded-For
app.set('trust proxy', 1);

// Helmet — secure HTTP headers
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — allow same-origin by default, configurable via env
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting (skip in test environment to avoid blocking E2E/Jest tests)
const isTest = process.env.NODE_ENV === 'test';

// General rate limiter: 100 requests per minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api', generalLimiter);

// Strict rate limiter for auth: 10 requests per minute per IP
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: 'Too many auth attempts, please try again later' }
});

// Middleware для работы с JSON
app.use(express.json());

// Подключаем статические файлы (HTML, CSS, JS), по умолчанию из frontend
const frontendDir = process.env.FRONTEND_DIR
  ? path.resolve(__dirname, '..', process.env.FRONTEND_DIR)
  : path.join(__dirname, '../frontend');
const bookingHtmlPath = path.join(frontendDir, 'booking.html');
let bookingHtmlTemplate = null;
try {
  bookingHtmlTemplate = fs.readFileSync(bookingHtmlPath, 'utf8');
} catch (error) {
  console.error('Failed to load booking HTML template:', error);
}
function applyNoStoreHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}
const noStoreStaticFiles = new Set([
  'booking.html',
  'booking.js',
  'booking.css',
  'master.html',
  'master.js',
  'master.css'
]);
app.use(express.static(frontendDir, {
  maxAge: 0,
  setHeaders(res, filePath) {
    const fileName = path.basename(filePath);
    if (!noStoreStaticFiles.has(fileName)) return;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

function renderBookingHtml(slug) {
  if (!bookingHtmlTemplate) return '';
  const runtimeConfig = getWebBookingPublicConfig(slug);
  const runtimeScript = '<script>'
    + `window.__HC_WEB_BOOKING_ENABLED__ = ${JSON.stringify(runtimeConfig.enabled)};`
    + `window.__TG_BOT_USERNAME__ = ${JSON.stringify(runtimeConfig.telegramBotUsername)};`
    + `window.__VK_GROUP_ID__ = ${JSON.stringify(runtimeConfig.vkGroupId)};`
    + `window.__VK_APP_ID__ = ${JSON.stringify(runtimeConfig.vkAppId)};`
    + '</script>';
  const injected = bookingHtmlTemplate.replace('</head>', `  ${runtimeScript}\n</head>`);
  return injected !== bookingHtmlTemplate ? injected : `${runtimeScript}\n${bookingHtmlTemplate}`;
}

// Подключаем роуты авторизации (с усиленным rate limiter)
const authRouter = require('./routes/auth');
app.use('/api/auth', authLimiter, authRouter);

// Подключаем роуты для задач (требуют авторизации)
const tasksRouter = require('./routes/tasks');
app.use('/api/tasks', tasksRouter);

// Подключаем роуты для тегов (требуют авторизации)
const tagsRouter = require('./routes/tags');
app.use('/api/tags', tagsRouter);

// Подключаем роуты для комментариев (требуют авторизации)
const commentsRouter = require('./routes/comments');
app.use('/api/comments', commentsRouter);

// Подключаем роуты для списков задач (требуют авторизации)
const listsRouter = require('./routes/lists');
app.use('/api/lists', listsRouter);

// Подключаем роуты для аудита (требуют авторизации)
const auditRouter = require('./routes/audit');
app.use('/api/audit', auditRouter);

// Подключаем роуты dashboard (требуют авторизации)
const dashboardRouter = require('./routes/dashboard');
app.use('/api/dashboard', dashboardRouter);

// Публичные роуты бронирования (частично требуют auth для создания)
const publicBookingRouter = require('./routes/public-booking');
app.use('/api/public', publicBookingRouter);

// VK Bot webhook (публичный, без авторизации — до роутеров с глобальным authenticateToken)
const vkWebhookRouter = require('./routes/vk-webhook');
app.use('/api/vk', vkWebhookRouter);


// Telegram Bot webhook (подтверждение web-записей по deep link)
const telegramWebhookRouter = require('./routes/telegram-webhook');
app.use('/api/telegram', telegramWebhookRouter);

// Подключаем роуты для повторяющихся задач (требуют авторизации)
const recurrenceRouter = require('./routes/recurrence');
app.use('/api', recurrenceRouter);

// Подключаем роуты для списка покупок (требуют авторизации)
const shoppingRouter = require('./routes/shopping');
app.use('/api/shopping', shoppingRouter);

// Подключаем роуты для уведомлений (требуют авторизации)
const notificationsRouter = require('./routes/notifications');
app.use('/api/notifications', notificationsRouter);

// Подключаем роуты для профиля пользователя (требуют авторизации)
const usersRouter = require('./routes/users');
app.use('/api/users', usersRouter);

// Подключаем роуты для вложений (требуют авторизации)
const attachmentsRouter = require('./routes/attachments');
app.use('/api', attachmentsRouter);

// Подключаем роуты мастера (booking system)
const masterRouter = require('./routes/master');
app.use('/api/master', masterRouter);

// Подключаем роуты клиентских бронирований
const clientBookingsRouter = require('./routes/client-bookings');
app.use('/api/client/bookings', clientBookingsRouter);

// Подключаем роуты синхронизации с Google Calendar
const calendarSyncRouter = require('./routes/calendar-sync');
app.use('/api/calendar-sync', calendarSyncRouter);

// Booking Mini App — serve booking.html for /book/:slug
// Allow embedding in Telegram and VK iframes (Mini Apps)
app.get('/book/:slug', (req, res) => {
  res.removeHeader('X-Frame-Options');
  applyNoStoreHeaders(res);
  const html = renderBookingHtml(req.params.slug);
  if (!html) {
    return res.status(500).send('Booking page is unavailable');
  }
  return res.type('html').send(html);
});

// Master panel
app.get('/master', (req, res) => {
  applyNoStoreHeaders(res);
  res.sendFile(path.join(frontendDir, 'master.html'));
});

// Роут для проверки здоровья сервера
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Централизованный обработчик ошибок (должен быть последним)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// Подключаем базу данных
const { initDB } = require('./db');
const { runReminderWorkerTick } = require('./lib/reminders-worker');

// Запускаем сервер только если файл запущен напрямую
// (не при импорте в тестах)
if (require.main === module) {
  initDB().then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });

    if (process.env.NODE_ENV !== 'test') {
      const pollMs = Number(process.env.REMINDER_POLL_MS || 60000);
      setInterval(async () => {
        try {
          await runReminderWorkerTick();
        } catch (error) {
          console.error('Reminder worker tick failed:', error);
        }
      }, pollMs);
    }
  });
}

// Экспортируем app для тестов
module.exports = app;
