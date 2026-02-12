// API URL - адрес нашего backend сервера
const API_URL = 'http://localhost:3000/api/tasks';

// Получаем элементы со страницы
const taskForm = document.getElementById('taskForm');
const taskTitle = document.getElementById('taskTitle');
const taskDate = document.getElementById('taskDate');
const tasksContainer = document.getElementById('tasksContainer');

// Функция для загрузки всех задач с сервера
async function loadTasks() {
  try {
    // Делаем GET запрос к нашему API
    const response = await fetch(API_URL);
    const tasks = await response.json();
    
    // Отображаем задачи на странице
    displayTasks(tasks);
  } catch (error) {
    console.error('Ошибка при загрузке задач:', error);
    tasksContainer.innerHTML = '<p class="no-tasks">❌ Ошибка при загрузке задач</p>';
  }
}

// Функция для отображения задач на странице
function displayTasks(tasks) {
  // Если задач нет - показываем сообщение
  if (tasks.length === 0) {
    tasksContainer.innerHTML = '<p class="no-tasks">📋 Пока нет задач. Добавьте первую!</p>';
    return;
  }
  
  // Создаем HTML для каждой задачи
  const tasksHTML = tasks.map(task => {
    const completedClass = task.completed ? 'completed' : '';
    const buttonText = task.completed ? '↩️ Вернуть' : '✅ Выполнено';
    
    return `
      <div class="task-item ${completedClass}">
        <div class="task-info">
          <div class="task-title">${task.title}</div>
          <div class="task-date">📅 ${formatDate(task.date)}</div>
        </div>
        <div class="task-actions">
          <button class="btn-small btn-complete" onclick="toggleTask(${task.id}, ${task.completed})">
            ${buttonText}
          </button>
          <button class="btn-small btn-delete" onclick="deleteTask(${task.id})">
            🗑️ Удалить
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  tasksContainer.innerHTML = tasksHTML;
}

// Функция для форматирования даты (из 2026-02-15 в 15 февраля 2026)
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

// Обработка отправки формы (добавление новой задачи)
taskForm.addEventListener('submit', async (e) => {
  e.preventDefault(); // Останавливаем стандартную отправку формы
  
  // Получаем данные из формы
  const newTask = {
    title: taskTitle.value.trim(),
    date: taskDate.value
  };
  
  // Проверка: заполнены ли поля
  if (!newTask.title || !newTask.date) {
    alert('⚠️ Пожалуйста, заполните все поля!');
    return;
  }
  
  try {
    // POST запрос для создания задачи
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newTask)
    });
    
    if (response.ok) {
      // Очищаем форму
      taskTitle.value = '';
      taskDate.value = '';
      
      // Перезагружаем список задач
      loadTasks();
      
      // Показываем сообщение об успехе
      alert('✅ Задача добавлена!');
    } else {
      alert('❌ Ошибка при добавлении задачи');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('❌ Ошибка при добавлении задачи');
  }
});

// Функция для переключения статуса задачи (выполнено/не выполнено)
async function toggleTask(id, currentStatus) {
  try {
    // PUT запрос для обновления задачи
    const response = await fetch(`${API_URL}/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ completed: !currentStatus })
    });
    
    if (response.ok) {
      // Перезагружаем список задач
      loadTasks();
    } else {
      alert('❌ Ошибка при обновлении задачи');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('❌ Ошибка при обновлении задачи');
  }
}

// Функция для удаления задачи
async function deleteTask(id) {
  // Подтверждение удаления
  if (!confirm('🗑️ Вы уверены, что хотите удалить эту задачу?')) {
    return;
  }
  
  try {
    // DELETE запрос
    const response = await fetch(`${API_URL}/${id}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      // Перезагружаем список задач
      loadTasks();
      alert('✅ Задача удалена!');
    } else {
      alert('❌ Ошибка при удалении задачи');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('❌ Ошибка при удалении задачи');
  }
}

// Загружаем задачи при загрузке страницы
loadTasks();

