// Модуль подключения к PostgreSQL
const { Pool } = require('pg');

// Создаём пул соединений (как "группа каналов" к базе данных)
// Пул переиспользует соединения, чтобы не открывать новое каждый раз
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Функция для создания таблицы задач (если её ещё нет)
async function initDB() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      date VARCHAR(10) NOT NULL,
      completed BOOLEAN DEFAULT false
    );
  `;

  try {
    await pool.query(createTableQuery);
    console.log('Database initialized: tasks table ready');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

module.exports = { pool, initDB };

