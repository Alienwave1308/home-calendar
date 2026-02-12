// Импортируем Express - это библиотека для создания веб-сервера
const express = require('express');
const path = require('path');  // ← Добавь эту строку

// Создаём приложение Express
const app = express();

// Порт на котором будет работать сервер
const PORT = 3000;

// Middleware для работы с JSON
// (позволяет серверу понимать JSON данные от клиента)
app.use(express.json());

// Подключаем статические файлы (HTML, CSS, JS) из папки frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Подключаем роуты для задач
const tasksRouter = require('./routes/tasks');
app.use('/api/tasks', tasksRouter);

// Роут для проверки здоровья сервера
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Запускаем сервер
// Запускаем сервер только если файл запущен напрямую
// (не при импорте в тестах)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

// Экспортируем app для тестов
module.exports = app;
