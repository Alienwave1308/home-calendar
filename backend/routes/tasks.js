// Роуты для работы с задачами
const express = require('express');
const router = express.Router();

// Временное хранилище задач (в памяти)
// Позже заменим на базу данных
let tasks = [
  {
    id: 1,
    title: 'Купить продукты',
    date: '2026-02-15',
    completed: false
  },
  {
    id: 2,
    title: 'Позвонить врачу',
    date: '2026-02-16',
    completed: false
  }
];

// Счётчик для ID (чтобы каждая задача имела уникальный ID)
let nextId = 3;

// GET /api/tasks - получить все задачи
router.get('/', (req, res) => {
  res.json(tasks);
});

// GET /api/tasks/:id - получить одну задачу по ID
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const task = tasks.find(t => t.id === id);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  res.json(task);
});

// POST /api/tasks - создать новую задачу
router.post('/', (req, res) => {
  const { title, date } = req.body;
  
  // Проверка: есть ли обязательные поля
  if (!title || !date) {
    return res.status(400).json({ error: 'Title and date are required' });
  }
  
  const newTask = {
    id: nextId++,
    title,
    date,
    completed: false
  };
  
  tasks.push(newTask);
  res.status(201).json(newTask);
});

// PUT /api/tasks/:id - обновить задачу
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const taskIndex = tasks.findIndex(t => t.id === id);
  
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  const { title, date, completed } = req.body;
  
  // Обновляем только те поля, которые пришли
  if (title !== undefined) tasks[taskIndex].title = title;
  if (date !== undefined) tasks[taskIndex].date = date;
  if (completed !== undefined) tasks[taskIndex].completed = completed;
  
  res.json(tasks[taskIndex]);
});

// DELETE /api/tasks/:id - удалить задачу
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const taskIndex = tasks.findIndex(t => t.id === id);
  
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  tasks.splice(taskIndex, 1);
  res.status(204).send();
});

module.exports = router;

