// Загружаем переменные окружения из .env файла
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Импортируем Express - это библиотека для создания веб-сервера
const express = require('express');
const path = require('path');  // ← Добавь эту строку

// Создаём приложение Express
const app = express();

// Порт на котором будет работать сервер
const PORT = process.env.PORT || 3000;

// Middleware для работы с JSON
// (позволяет серверу понимать JSON данные от клиента)
app.use(express.json());

// Подключаем статические файлы (HTML, CSS, JS), по умолчанию из frontend
const frontendDir = process.env.FRONTEND_DIR
  ? path.resolve(__dirname, '..', process.env.FRONTEND_DIR)
  : path.join(__dirname, '../frontend');
app.use(express.static(frontendDir));

// Подключаем роуты авторизации
const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);

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

// Подключаем роуты для вложений (требуют авторизации)
const attachmentsRouter = require('./routes/attachments');
app.use('/api', attachmentsRouter);

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
