// API URLs
const API_URL = '/api/tasks';
const AUTH_URL = '/api/auth';
const FAMILY_URL = '/api/families';

// Auth state
let authToken = localStorage.getItem('authToken');
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

// Family state
let currentFamily = null;
let currentTasksView = 'my'; // 'my' or 'family'

// Calendar state
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let allTasks = []; // cached tasks for calendar rendering
let modalDate = null; // currently open day in modal

// Helper: add auth header to fetch requests
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };
}

// === AUTH LOGIC ===

const authScreen = document.getElementById('authScreen');
const appScreen = document.getElementById('appScreen');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

// Show correct screen on load
function checkAuth() {
  if (authToken && currentUser) {
    authScreen.style.display = 'none';
    appScreen.style.display = 'block';
    document.getElementById('currentUser').textContent = currentUser.username;
    loadFamily();
    loadTasks();
  } else {
    authScreen.style.display = 'block';
    appScreen.style.display = 'none';
  }
}

// Switch between login/register tabs
// eslint-disable-next-line no-unused-vars
function showAuthTab(tab, el) {
  const tabs = document.querySelectorAll('.auth-tab');
  tabs.forEach(t => t.classList.remove('active'));
  el.classList.add('active');

  if (tab === 'login') {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
  } else {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';

  try {
    const response = await fetch(`${AUTH_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('loginUsername').value.trim(),
        password: document.getElementById('loginPassword').value
      })
    });

    const data = await response.json();
    if (!response.ok) {
      errorEl.textContent = data.error || 'Ошибка входа';
      return;
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    checkAuth();
  } catch {
    errorEl.textContent = 'Ошибка соединения с сервером';
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('registerError');
  errorEl.textContent = '';

  try {
    const response = await fetch(`${AUTH_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('regUsername').value.trim(),
        password: document.getElementById('regPassword').value
      })
    });

    const data = await response.json();
    if (!response.ok) {
      errorEl.textContent = data.error || 'Ошибка регистрации';
      return;
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    checkAuth();
  } catch {
    errorEl.textContent = 'Ошибка соединения с сервером';
  }
});

function logout() {
  authToken = null;
  currentUser = null;
  currentFamily = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  checkAuth();
}

// === FAMILY LOGIC ===

async function loadFamily() {
  try {
    const response = await fetch(FAMILY_URL, { headers: authHeaders() });
    if (response.status === 401 || response.status === 403) { logout(); return; }
    const data = await response.json();
    currentFamily = data.family;
    renderFamily();
  } catch (error) {
    console.error('Ошибка загрузки семьи:', error);
  }
}

function renderFamily() {
  const noFamily = document.getElementById('noFamily');
  const hasFamily = document.getElementById('hasFamily');
  const tasksTabs = document.getElementById('tasksTabs');

  if (currentFamily) {
    noFamily.style.display = 'none';
    hasFamily.style.display = 'block';
    tasksTabs.style.display = 'flex';

    document.getElementById('familyTitle').textContent = currentFamily.name;
    document.getElementById('familyCode').textContent = currentFamily.invite_code;

    const membersHTML = currentFamily.members.map(m => {
      const roleLabel = m.role === 'owner' ? 'владелец' : 'участник';
      const kickBtn = currentFamily.role === 'owner' && m.id !== currentUser.id
        ? `<button class="btn-small btn-delete" onclick="kickMember(${m.id})">Убрать</button>`
        : '';
      return `
        <div class="family-member">
          <span>${m.username} <small>(${roleLabel})</small></span>
          ${kickBtn}
        </div>
      `;
    }).join('');

    document.getElementById('familyMembers').innerHTML = membersHTML;
  } else {
    noFamily.style.display = 'block';
    hasFamily.style.display = 'none';
    tasksTabs.style.display = 'none';
    // Reset to my tasks view
    currentTasksView = 'my';
    document.getElementById('tasksTitle').textContent = 'Мои задачи';
  }
}

// eslint-disable-next-line no-unused-vars
async function createFamily() {
  const nameInput = document.getElementById('familyName');
  const errorEl = document.getElementById('familyError');
  errorEl.textContent = '';

  const name = nameInput.value.trim();
  if (name.length < 2) {
    errorEl.textContent = 'Название семьи — минимум 2 символа';
    return;
  }

  try {
    const response = await fetch(FAMILY_URL, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name })
    });

    const data = await response.json();
    if (!response.ok) {
      errorEl.textContent = data.error || 'Ошибка создания семьи';
      return;
    }

    currentFamily = data.family;
    nameInput.value = '';
    renderFamily();
  } catch {
    errorEl.textContent = 'Ошибка соединения с сервером';
  }
}

// eslint-disable-next-line no-unused-vars
async function joinFamily() {
  const codeInput = document.getElementById('inviteCodeInput');
  const errorEl = document.getElementById('familyError');
  errorEl.textContent = '';

  const code = codeInput.value.trim();
  if (!code) {
    errorEl.textContent = 'Введите код приглашения';
    return;
  }

  try {
    const response = await fetch(`${FAMILY_URL}/join`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ invite_code: code })
    });

    const data = await response.json();
    if (!response.ok) {
      errorEl.textContent = data.error || 'Ошибка присоединения';
      return;
    }

    currentFamily = data.family;
    codeInput.value = '';
    renderFamily();
  } catch {
    errorEl.textContent = 'Ошибка соединения с сервером';
  }
}

// eslint-disable-next-line no-unused-vars
async function leaveFamily() {
  const action = currentFamily.role === 'owner'
    ? 'Вы владелец. Семья будет удалена для всех. Продолжить?'
    : 'Вы уверены, что хотите покинуть семью?';

  if (!confirm(action)) return;

  try {
    const response = await fetch(`${FAMILY_URL}/leave`, {
      method: 'POST',
      headers: authHeaders()
    });

    if (response.ok) {
      currentFamily = null;
      currentTasksView = 'my';
      renderFamily();
      loadTasks();
    }
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

// eslint-disable-next-line no-unused-vars
async function kickMember(userId) {
  if (!confirm('Убрать этого участника из семьи?')) return;

  try {
    const response = await fetch(`${FAMILY_URL}/members/${userId}`, {
      method: 'DELETE',
      headers: authHeaders()
    });

    if (response.ok) {
      loadFamily();
    }
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

// eslint-disable-next-line no-unused-vars
function switchTasksView(view, el) {
  currentTasksView = view;
  const tabs = document.querySelectorAll('.tasks-tab');
  tabs.forEach(t => t.classList.remove('active'));
  el.classList.add('active');

  document.getElementById('tasksTitle').textContent =
    view === 'my' ? 'Мои задачи' : 'Задачи семьи';

  loadTasks();
}

// === TASKS LOGIC ===

// DOM elements for tasks
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
    const url = currentTasksView === 'family' ? `${API_URL}/family` : API_URL;
    const response = await fetch(url, { headers: authHeaders() });
    if (response.status === 401 || response.status === 403) { logout(); return; }
    if (response.status === 404 && currentTasksView === 'family') {
      tasksContainer.innerHTML = '<p class="no-tasks">Вы не состоите в семье</p>';
      return;
    }
    const tasks = await response.json();
    allTasks = tasks;
    displayTasks(tasks);
    renderCalendar();
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

  const isFamilyView = currentTasksView === 'family';

  const tasksHTML = tasks.map(task => {
    const statusInfo = STATUS_LABELS[task.status] || STATUS_LABELS.planned;
    const doneClass = task.status === 'done' ? 'completed' : '';
    const ownerLabel = isFamilyView && task.username
      ? `<span class="task-owner">${task.username}</span>`
      : '';
    const isOwnTask = !isFamilyView || task.user_id === currentUser.id;

    return `
      <div class="task-item ${doneClass}" data-status="${task.status}">
        <div class="task-info">
          <div class="task-title">${task.title}</div>
          <div class="task-meta">
            ${ownerLabel}
            <span class="task-date">${formatDate(task.date)}</span>
            <span class="task-status status-${task.status}">${statusInfo.icon} ${statusInfo.text}</span>
          </div>
        </div>
        ${isOwnTask ? `
        <div class="task-actions">
          <button class="btn-small btn-status" onclick="cycleStatus(${task.id}, '${task.status}')">
            ${STATUS_LABELS[statusInfo.next].icon} ${STATUS_LABELS[statusInfo.next].text}
          </button>
          <button class="btn-small btn-delete" onclick="deleteTask(${task.id})">
            Удалить
          </button>
        </div>
        ` : ''}
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
      headers: authHeaders(),
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
      headers: authHeaders(),
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
      method: 'DELETE',
      headers: authHeaders()
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

// === CALENDAR LOGIC ===

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

function renderCalendar() {
  const titleEl = document.getElementById('calendarTitle');
  const gridEl = document.getElementById('calendarGrid');

  titleEl.textContent = `${MONTH_NAMES[calendarMonth]} ${calendarYear}`;

  // First day of month (0=Sun, convert to Mon=0)
  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const mondayOffset = (firstDay === 0 ? 6 : firstDay - 1);

  // Days in month
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();

  // Days in previous month
  const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();

  // Today
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Group tasks by date
  const tasksByDate = {};
  allTasks.forEach(task => {
    if (!tasksByDate[task.date]) tasksByDate[task.date] = [];
    tasksByDate[task.date].push(task);
  });

  let html = '';

  // Previous month days
  for (let i = mondayOffset - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const m = calendarMonth === 0 ? 12 : calendarMonth;
    const y = calendarMonth === 0 ? calendarYear - 1 : calendarYear;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dots = renderDots(tasksByDate[dateStr]);
    html += `<div class="calendar-day other-month" onclick="openDayModal('${dateStr}')">
      <span class="day-number">${day}</span>${dots}
    </div>`;
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const dayOfWeek = new Date(calendarYear, calendarMonth, day).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const classes = ['calendar-day'];
    if (isToday) classes.push('today');
    if (isWeekend) classes.push('weekend');
    const dots = renderDots(tasksByDate[dateStr]);
    html += `<div class="${classes.join(' ')}" onclick="openDayModal('${dateStr}')">
      <span class="day-number">${day}</span>${dots}
    </div>`;
  }

  // Next month days (fill remaining cells)
  const totalCells = mondayOffset + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let day = 1; day <= remaining; day++) {
    const m = calendarMonth === 11 ? 1 : calendarMonth + 2;
    const y = calendarMonth === 11 ? calendarYear + 1 : calendarYear;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dots = renderDots(tasksByDate[dateStr]);
    html += `<div class="calendar-day other-month" onclick="openDayModal('${dateStr}')">
      <span class="day-number">${day}</span>${dots}
    </div>`;
  }

  gridEl.innerHTML = html;
}

function renderDots(tasks) {
  if (!tasks || tasks.length === 0) return '';
  const maxDots = 4;
  const dots = tasks.slice(0, maxDots).map(t =>
    `<span class="task-dot ${t.status}"></span>`
  ).join('');
  return `<div class="task-dots">${dots}</div>`;
}

function prevMonth() {
  calendarMonth--;
  if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
  renderCalendar();
}

function nextMonth() {
  calendarMonth++;
  if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
  renderCalendar();
}

// eslint-disable-next-line no-unused-vars
function goToday() {
  const now = new Date();
  calendarMonth = now.getMonth();
  calendarYear = now.getFullYear();
  renderCalendar();
}

// === DAY MODAL ===

// eslint-disable-next-line no-unused-vars
function openDayModal(dateStr) {
  modalDate = dateStr;
  const modal = document.getElementById('dayModal');
  document.getElementById('modalDate').textContent = formatDate(dateStr);
  document.getElementById('modalTaskTitle').value = '';
  renderModalTasks();
  modal.style.display = 'flex';
}

function closeDayModal(event) {
  // If called from overlay click, only close if clicking overlay itself
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('dayModal').style.display = 'none';
  modalDate = null;
}

function renderModalTasks() {
  const container = document.getElementById('modalTasks');
  const dayTasks = allTasks.filter(t => t.date === modalDate);

  if (dayTasks.length === 0) {
    container.innerHTML = '<p class="modal-no-tasks">Нет задач на этот день</p>';
    return;
  }

  const isFamilyView = currentTasksView === 'family';

  container.innerHTML = dayTasks.map(task => {
    const statusInfo = STATUS_LABELS[task.status] || STATUS_LABELS.planned;
    const doneClass = task.status === 'done' ? 'completed' : '';
    const isOwnTask = !isFamilyView || task.user_id === currentUser.id;
    const ownerLabel = isFamilyView && task.username
      ? `<span class="task-owner">${task.username}</span> `
      : '';

    return `
      <div class="modal-task ${doneClass}">
        <div>
          <div class="task-title">${ownerLabel}${task.title}</div>
          <span class="task-status status-${task.status}">${statusInfo.icon} ${statusInfo.text}</span>
        </div>
        ${isOwnTask ? `
        <div class="task-actions">
          <button class="btn-small btn-status" onclick="cycleStatusModal(${task.id}, '${task.status}')">
            ${STATUS_LABELS[statusInfo.next].icon}
          </button>
          <button class="btn-small btn-delete" onclick="deleteTaskModal(${task.id})">
            &times;
          </button>
        </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// eslint-disable-next-line no-unused-vars
async function addTaskFromModal() {
  const input = document.getElementById('modalTaskTitle');
  const title = input.value.trim();
  if (!title || !modalDate) return;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title, date: modalDate, status: 'planned' })
    });

    if (response.ok) {
      input.value = '';
      await loadTasks();
      renderModalTasks();
    }
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

// eslint-disable-next-line no-unused-vars
async function cycleStatusModal(id, currentStatus) {
  const nextStatus = STATUS_LABELS[currentStatus].next;
  try {
    const response = await fetch(`${API_URL}/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ status: nextStatus })
    });
    if (response.ok) {
      await loadTasks();
      renderModalTasks();
    }
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

// eslint-disable-next-line no-unused-vars
async function deleteTaskModal(id) {
  if (!confirm('Удалить задачу?')) return;
  try {
    const response = await fetch(`${API_URL}/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (response.ok) {
      await loadTasks();
      renderModalTasks();
    }
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

// === SWIPE GESTURES FOR CALENDAR ===

let touchStartX = 0;

document.addEventListener('touchstart', (e) => {
  if (e.target.closest('.calendar-section')) {
    touchStartX = e.touches[0].clientX;
  }
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (!e.target.closest('.calendar-section')) return;
  const touchEndX = e.changedTouches[0].clientX;
  const diff = touchStartX - touchEndX;
  if (Math.abs(diff) > 50) {
    if (diff > 0) nextMonth(); else prevMonth();
  }
}, { passive: true });

// === KEYBOARD: Escape closes modal ===

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalDate) {
    closeDayModal();
  }
});

// Check auth and load tasks on page load
checkAuth();
