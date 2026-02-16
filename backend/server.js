// Загружаем переменные окружения из .env файла
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Импортируем Express - это библиотека для создания веб-сервера
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Создаём приложение Express
const app = express();

// Порт на котором будет работать сервер
const PORT = process.env.PORT || 3000;

// === Security Middleware ===

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
app.use(express.static(frontendDir));

// Подключаем роуты авторизации (с усиленным rate limiter)
const authRouter = require('./routes/auth');
app.use('/api/auth', authLimiter, authRouter);

// Подключаем роуты для задач (требуют авторизации)
const tasksRouter = require('./routes/tasks');
app.use('/api/tasks', tasksRouter);

// Подключаем роуты для семей (требуют авторизации)
const familiesRouter = require('./routes/families');
app.use('/api/families', familiesRouter);

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

// Роут для проверки здоровья сервера
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Подключаем базу данных
const { initDB } = require('./db');

// Запускаем сервер только если файл запущен напрямую
// (не при импорте в тестах)
if (require.main === module) {
  initDB().then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  });
}

// Экспортируем app для тестов
module.exports = app;
