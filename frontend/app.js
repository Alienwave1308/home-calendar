// API URL - relative path (works in both dev and production)
const API_URL = '/api/tasks';

const taskForm = document.getElementById('taskForm');
const taskTitle = document.getElementById('taskTitle');
const taskDate = document.getElementById('taskDate');
const taskStatus = document.getElementById('taskStatus');
const tasksContainer = document.getElementById('tasksContainer');

const STATUS_LABELS = {
  planned: { text: 'Запланировано', icon: '📋', next: 'in_progress' },
  in_progress: { text: 'В работе', icon: '🔄', next: 'done' },
  done: { text: 'Готово', icon: '✅', next: 'planned' }
};

// Load all tasks from API
async function loadTasks() {
  try {
    const response = await fetch(API_URL);
    const tasks = await response.json();
    displayTasks(tasks);
  } catch (error) {
    console.error('Ошибка при загрузке задач:', error);
    tasksContainer.innerHTML = '<p class="no-tasks">Ошибка при загрузке задач</p>';
  }
}

// Render tasks list
function displayTasks(tasks) {
  if (tasks.length === 0) {
    tasksContainer.innerHTML = '<p class="no-tasks">Пока нет задач. Добавьте первую!</p>';
    return;
  }

  const tasksHTML = tasks.map(task => {
    const statusInfo = STATUS_LABELS[task.status] || STATUS_LABELS.planned;
    const doneClass = task.status === 'done' ? 'completed' : '';

    return `
      <div class="task-item ${doneClass}" data-status="${task.status}">
        <div class="task-info">
          <div class="task-title">${task.title}</div>
          <div class="task-meta">
            <span class="task-date">${formatDate(task.date)}</span>
            <span class="task-status status-${task.status}">${statusInfo.icon} ${statusInfo.text}</span>
          </div>
        </div>
        <div class="task-actions">
          <button class="btn-small btn-status" onclick="cycleStatus(${task.id}, '${task.status}')">
            ${STATUS_LABELS[statusInfo.next].icon} ${STATUS_LABELS[statusInfo.next].text}
          </button>
          <button class="btn-small btn-delete" onclick="deleteTask(${task.id})">
            Удалить
          </button>
        </div>
      </div>
    `;
  }).join('');

  tasksContainer.innerHTML = tasksHTML;
}

// Format date to Russian locale
function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  return `${day} ${month} ${year}`;
}

// Form submit — create new task
taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const newTask = {
    title: taskTitle.value.trim(),
    date: taskDate.value,
    status: taskStatus ? taskStatus.value : 'planned'
  };

  if (!newTask.title || !newTask.date) {
    alert('Пожалуйста, заполните все поля!');
    return;
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTask)
    });

    if (response.ok) {
      taskTitle.value = '';
      taskDate.value = '';
      if (taskStatus) taskStatus.value = 'planned';
      loadTasks();
    } else {
      alert('Ошибка при добавлении задачи');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('Ошибка при добавлении задачи');
  }
});

// Cycle task status: planned -> in_progress -> done -> planned
// eslint-disable-next-line no-unused-vars
async function cycleStatus(id, currentStatus) {
  const nextStatus = STATUS_LABELS[currentStatus].next;

  try {
    const response = await fetch(`${API_URL}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });

    if (response.ok) {
      loadTasks();
    } else {
      alert('Ошибка при обновлении задачи');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('Ошибка при обновлении задачи');
  }
}

// Delete task
// eslint-disable-next-line no-unused-vars
async function deleteTask(id) {
  if (!confirm('Вы уверены, что хотите удалить эту задачу?')) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/${id}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      loadTasks();
    } else {
      alert('Ошибка при удалении задачи');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('Ошибка при удалении задачи');
  }
}

// Load tasks on page load
loadTasks();
