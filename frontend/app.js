// API URLs
const API_URL = '/api/tasks';
const AUTH_URL = '/api/auth';
const FAMILY_URL = '/api/families';
const AUDIT_URL = '/api/audit';
const DASHBOARD_URL = '/api/dashboard';

// Auth state
let authToken = localStorage.getItem('authToken');
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

// Family state
let currentFamily = null;
let currentTasksView = 'my'; // 'my' or 'family'
let pendingTaskFocusId = null;

// Calendar state
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let allTasks = []; // cached tasks for calendar rendering
let modalDate = null; // currently open day in modal
let calendarViewMode = localStorage.getItem('calendarViewMode') || 'month';
let calendarSelectedDate = new Date();

const calendarUtils = window.CalendarViews || {
  toIsoDate: (date) => (
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  ),
  addDays: (date, days) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  },
  getWeekStart: (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  getWeekDates: (date) => {
    const start = new Date(date);
    const day = start.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + offset);
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }
};

// Activity state
let activityEvents = [];
let activityTotal = 0;
let activityOffset = 0;
const ACTIVITY_LIMIT = 20;

// Helper: add auth header to fetch requests
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };
}

// === SPA ROUTER ===

const router = window.RouterUtils || {
  ROUTES: ['dashboard', 'calendar', 'tasks', 'kanban', 'family', 'activity'],
  normalizeRoute: (route) => (
    ['dashboard', 'calendar', 'tasks', 'kanban', 'family', 'activity'].includes(route)
      ? route
      : 'dashboard'
  ),
  getRouteFromHash: (hash) => {
    const route = (hash || '').replace('#/', '');
    return ['dashboard', 'calendar', 'tasks', 'kanban', 'family', 'activity'].includes(route)
      ? route
      : 'dashboard';
  },
  buildHash: (route) => {
    const normalized = ['dashboard', 'calendar', 'tasks', 'kanban', 'family', 'activity'].includes(route)
      ? route
      : 'dashboard';
    return `#/${normalized}`;
  }
};

function navigateTo(route) {
  window.location.hash = router.buildHash(route);
}

function getRouteFromHash() {
  return router.getRouteFromHash(window.location.hash);
}

function handleRoute() {
  if (!authToken || !currentUser) return;

  const route = getRouteFromHash();

  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');

  // Show current screen
  const screen = document.getElementById(`screen-${route}`);
  if (screen) screen.style.display = 'block';

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.route === route);
  });

  // Load data for the screen
  if (route === 'dashboard') {
    loadDashboard();
  } else if (route === 'calendar') {
    renderCalendar();
  } else if (route === 'tasks') {
    loadTasks();
  } else if (route === 'family') {
    loadFamily();
  } else if (route === 'activity') {
    activityOffset = 0;
    activityEvents = [];
    loadActivity();
  }
}

window.addEventListener('hashchange', handleRoute);

// === AUTH LOGIC ===

const authScreen = document.getElementById('authScreen');
const appScreen = document.getElementById('appScreen');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

// Show correct screen on load
function checkAuth() {
  if (authToken && currentUser) {
    authScreen.style.display = 'none';
    appScreen.style.display = 'flex';
    document.getElementById('currentUser').textContent = currentUser.username;
    // Load tasks for calendar dots
    loadTasks();
    loadFamily();
    // Route to current hash or default
    if (!window.location.hash || window.location.hash === '#/') {
      navigateTo('dashboard');
    } else {
      handleRoute();
    }
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
  window.location.hash = '';
  checkAuth();
}

// === DASHBOARD LOGIC ===

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function renderDashboardList(containerId, tasks) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!tasks || tasks.length === 0) {
    container.innerHTML = '<p class="dashboard-empty">Нет задач</p>';
    return;
  }

  container.innerHTML = tasks.slice(0, 5).map(task => (
    `<button class="dashboard-task-btn" onclick="openTaskFromDashboard(${task.id})">
      ${task.title}
    </button>`
  )).join('');
}

async function loadDashboard() {
  const errorEl = document.getElementById('dashboardError');
  if (errorEl) errorEl.textContent = '';

  try {
    const response = await fetch(DASHBOARD_URL, { headers: authHeaders() });
    if (response.status === 401 || response.status === 403) { logout(); return; }

    const data = await response.json();
    if (!response.ok) {
      if (errorEl) errorEl.textContent = data.error || 'Ошибка загрузки сводки';
      return;
    }

    document.getElementById('dashTodayCount').textContent = String(data.stats.today_count || 0);
    document.getElementById('dashOverdueCount').textContent = String(data.stats.overdue_count || 0);
    document.getElementById('dashUpcomingCount').textContent = String(data.stats.upcoming_count || 0);
    document.getElementById('dashDoneWeek').textContent = String(data.stats.done_week || 0);

    renderDashboardList('dashTodayList', data.today);
    renderDashboardList('dashOverdueList', data.overdue);
    renderDashboardList('dashUpcomingList', data.upcoming);
  } catch {
    if (errorEl) errorEl.textContent = 'Ошибка соединения с сервером';
  }
}

// eslint-disable-next-line no-unused-vars
function openTaskFromDashboard(taskId) {
  pendingTaskFocusId = taskId;
  currentTasksView = 'my';

  const tasksTitle = document.getElementById('tasksTitle');
  if (tasksTitle) tasksTitle.textContent = 'Мои задачи';

  const tabs = document.querySelectorAll('.tasks-tab');
  tabs.forEach((tab, idx) => tab.classList.toggle('active', idx === 0));

  if (getRouteFromHash() === 'tasks') {
    handleRoute();
    return;
  }
  navigateTo('tasks');
}

const dashboardQuickForm = document.getElementById('dashboardQuickForm');
const dashboardQuickTitle = document.getElementById('dashboardQuickTitle');

if (dashboardQuickForm) {
  dashboardQuickForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = dashboardQuickTitle.value.trim();
    if (!title) return;

    const errorEl = document.getElementById('dashboardError');
    if (errorEl) errorEl.textContent = '';

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title, date: todayIsoDate(), status: 'planned', priority: 'medium' })
      });

      if (response.ok) {
        dashboardQuickTitle.value = '';
        loadDashboard();
        loadTasks();
        return;
      }

      if (errorEl) errorEl.textContent = 'Не удалось добавить задачу';
    } catch {
      if (errorEl) errorEl.textContent = 'Ошибка соединения с сервером';
    }
  });
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
    if (tasksTabs) tasksTabs.style.display = 'flex';

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
    if (tasksTabs) tasksTabs.style.display = 'none';
    // Reset to my tasks view
    currentTasksView = 'my';
    const tasksTitle = document.getElementById('tasksTitle');
    if (tasksTitle) tasksTitle.textContent = 'Мои задачи';
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
const taskPriority = document.getElementById('taskPriority');
const tasksContainer = document.getElementById('tasksContainer');

const PRIORITY_LABELS = {
  low: { text: 'Низкий', icon: '🟢' },
  medium: { text: 'Средний', icon: '🟡' },
  high: { text: 'Высокий', icon: '🟠' },
  urgent: { text: 'Срочный', icon: '🔴' }
};

const STATUS_LABELS = {
  backlog: { text: 'Бэклог', icon: '📥', next: 'planned' },
  planned: { text: 'Запланировано', icon: '📋', next: 'in_progress' },
  in_progress: { text: 'В работе', icon: '🔄', next: 'done' },
  done: { text: 'Готово', icon: '✅', next: 'backlog' },
  canceled: { text: 'Отменено', icon: '❌', next: 'backlog' },
  archived: { text: 'Архив', icon: '📦', next: 'backlog' }
};

// Load all tasks from API
async function loadTasks() {
  try {
    const url = currentTasksView === 'family' ? `${API_URL}/family` : API_URL;
    const response = await fetch(url, { headers: authHeaders() });
    if (response.status === 401 || response.status === 403) { logout(); return; }
    if (response.status === 404 && currentTasksView === 'family') {
      if (tasksContainer) tasksContainer.innerHTML = '<p class="no-tasks">Вы не состоите в семье</p>';
      return;
    }
    const tasks = await response.json();
    allTasks = tasks;
    displayTasks(tasks);
    // Re-render calendar dots if calendar is visible
    const calendarScreen = document.getElementById('screen-calendar');
    if (calendarScreen && calendarScreen.style.display !== 'none') {
      renderCalendar();
    }
  } catch (error) {
    console.error('Ошибка при загрузке задач:', error);
    if (tasksContainer) tasksContainer.innerHTML = '<p class="no-tasks">Ошибка при загрузке задач</p>';
  }
}

// Render tasks list
function displayTasks(tasks) {
  if (!tasksContainer) return;

  if (tasks.length === 0) {
    tasksContainer.innerHTML = '<p class="no-tasks">Пока нет задач. Добавьте первую!</p>';
    return;
  }

  const isFamilyView = currentTasksView === 'family';

  const tasksHTML = tasks.map(task => {
    const statusInfo = STATUS_LABELS[task.status] || STATUS_LABELS.planned;
    const priorityInfo = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.medium;
    const doneClass = task.status === 'done' ? 'completed' : '';
    const ownerLabel = isFamilyView && task.username
      ? `<span class="task-owner">${task.username}</span>`
      : '';
    const isOwnTask = !isFamilyView || task.user_id === currentUser.id;

    return `
      <div
        class="task-item ${doneClass}"
        id="task-item-${task.id}"
        data-task-id="${task.id}"
        data-status="${task.status}"
        data-priority="${task.priority || 'medium'}"
      >
        <div class="task-info">
          <div class="task-title">${task.title}</div>
          <div class="task-meta">
            ${ownerLabel}
            <span class="task-date">${formatDate(task.date)}</span>
            <span class="task-priority priority-${task.priority || 'medium'}">${priorityInfo.icon}</span>
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

  if (pendingTaskFocusId !== null) {
    const focusedTask = document.getElementById(`task-item-${pendingTaskFocusId}`);
    pendingTaskFocusId = null;
    if (focusedTask) {
      focusedTask.classList.add('focused');
      focusedTask.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => focusedTask.classList.remove('focused'), 1800);
    }
  }
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
    status: taskStatus ? taskStatus.value : 'planned',
    priority: taskPriority ? taskPriority.value : 'medium'
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
      if (taskPriority) taskPriority.value = 'medium';
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

function syncCalendarAnchor(date) {
  calendarSelectedDate = new Date(date);
  calendarMonth = calendarSelectedDate.getMonth();
  calendarYear = calendarSelectedDate.getFullYear();
}

function buildTasksByDate() {
  const tasksByDate = {};
  allTasks.forEach((task) => {
    if (!tasksByDate[task.date]) tasksByDate[task.date] = [];
    tasksByDate[task.date].push(task);
  });
  return tasksByDate;
}

function updateCalendarViewControls() {
  document.querySelectorAll('.calendar-view-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === calendarViewMode);
  });
}

// eslint-disable-next-line no-unused-vars
function setCalendarView(view) {
  if (!['month', 'week', 'day'].includes(view)) return;
  calendarViewMode = view;
  localStorage.setItem('calendarViewMode', calendarViewMode);
  renderCalendar();
}

function renderCalendar() {
  const titleEl = document.getElementById('calendarTitle');
  const gridEl = document.getElementById('calendarGrid');
  const weekdaysEl = document.getElementById('calendarWeekdays');
  const weekEl = document.getElementById('calendarWeekView');
  const dayEl = document.getElementById('calendarDayView');
  if (!titleEl || !gridEl || !weekdaysEl || !weekEl || !dayEl) return;

  updateCalendarViewControls();

  gridEl.style.display = calendarViewMode === 'month' ? 'grid' : 'none';
  weekdaysEl.style.display = calendarViewMode === 'month' ? 'grid' : 'none';
  weekEl.style.display = calendarViewMode === 'week' ? 'grid' : 'none';
  dayEl.style.display = calendarViewMode === 'day' ? 'block' : 'none';

  if (calendarViewMode === 'month') {
    renderCalendarMonth(titleEl, gridEl);
    return;
  }
  if (calendarViewMode === 'week') {
    renderCalendarWeek(titleEl, weekEl);
    return;
  }
  renderCalendarDay(titleEl, dayEl);
}

function renderCalendarMonth(titleEl, gridEl) {
  titleEl.textContent = `${MONTH_NAMES[calendarMonth]} ${calendarYear}`;

  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const mondayOffset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const todayStr = calendarUtils.toIsoDate(new Date());
  const tasksByDate = buildTasksByDate();

  let html = '';

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

function formatCompactDate(date) {
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

function renderCalendarWeek(titleEl, weekEl) {
  const weekDates = calendarUtils.getWeekDates(calendarSelectedDate);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const tasksByDate = buildTasksByDate();
  const todayIso = calendarUtils.toIsoDate(new Date());

  titleEl.textContent = `${formatCompactDate(weekStart)} - ${formatCompactDate(weekEnd)} ${weekEnd.getFullYear()}`;

  weekEl.innerHTML = weekDates.map((date) => {
    const isoDate = calendarUtils.toIsoDate(date);
    const dayTasks = tasksByDate[isoDate] || [];
    const todayClass = isoDate === todayIso ? 'today' : '';
    const weekday = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][date.getDay() === 0 ? 6 : date.getDay() - 1];

    const taskItems = dayTasks.length === 0
      ? '<div class="week-task-empty">Нет задач</div>'
      : dayTasks.slice(0, 5).map((task) => (
        `<button class="week-task-item status-${task.status}" onclick="openDayModal('${isoDate}')">${task.title}</button>`
      )).join('');

    return `
      <article class="week-day-column ${todayClass}" onclick="openDayModal('${isoDate}')">
        <header class="week-day-header">
          <span>${weekday}</span>
          <strong>${date.getDate()}</strong>
        </header>
        <div class="week-day-tasks">${taskItems}</div>
      </article>
    `;
  }).join('');
}

function renderCalendarDay(titleEl, dayEl) {
  const isoDate = calendarUtils.toIsoDate(calendarSelectedDate);
  const dayTasks = allTasks.filter((task) => task.date === isoDate);
  const humanDate = formatDate(isoDate);
  titleEl.textContent = humanDate;

  if (dayTasks.length === 0) {
    dayEl.innerHTML = `<p class="no-tasks">На ${humanDate} задач нет</p>`;
    return;
  }

  dayEl.innerHTML = dayTasks.map((task) => {
    const statusInfo = STATUS_LABELS[task.status] || STATUS_LABELS.planned;
    return `
      <div class="day-task-item">
        <div class="day-task-title">${task.title}</div>
        <div class="day-task-meta">
          <span class="task-status status-${task.status}">${statusInfo.icon} ${statusInfo.text}</span>
        </div>
      </div>
    `;
  }).join('');
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
  if (calendarViewMode === 'month') {
    const nextDate = new Date(calendarYear, calendarMonth - 1, 1);
    syncCalendarAnchor(nextDate);
  } else if (calendarViewMode === 'week') {
    syncCalendarAnchor(calendarUtils.addDays(calendarSelectedDate, -7));
  } else {
    syncCalendarAnchor(calendarUtils.addDays(calendarSelectedDate, -1));
  }
  renderCalendar();
}

function nextMonth() {
  if (calendarViewMode === 'month') {
    const nextDate = new Date(calendarYear, calendarMonth + 1, 1);
    syncCalendarAnchor(nextDate);
  } else if (calendarViewMode === 'week') {
    syncCalendarAnchor(calendarUtils.addDays(calendarSelectedDate, 7));
  } else {
    syncCalendarAnchor(calendarUtils.addDays(calendarSelectedDate, 1));
  }
  renderCalendar();
}

// eslint-disable-next-line no-unused-vars
function goToday() {
  syncCalendarAnchor(new Date());
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

// === ACTIVITY FEED ===

const ACTION_LABELS = {
  'task.created': 'создал(а) задачу',
  'task.updated': 'обновил(а) задачу',
  'task.deleted': 'удалил(а) задачу',
  'task.status_changed': 'изменил(а) статус',
  'comment.created': 'оставил(а) комментарий',
  'comment.deleted': 'удалил(а) комментарий',
  'member.joined': 'присоединился(ась)',
  'member.left': 'покинул(а) семью',
  'member.kicked': 'убрал(а) участника',
  'list.created': 'создал(а) список',
  'list.deleted': 'удалил(а) список'
};

async function loadActivity() {
  const container = document.getElementById('activityContainer');
  const loadMoreBtn = document.getElementById('activityLoadMore');

  try {
    const response = await fetch(
      `${AUDIT_URL}?limit=${ACTIVITY_LIMIT}&offset=${activityOffset}`,
      { headers: authHeaders() }
    );

    if (response.status === 401 || response.status === 403) { logout(); return; }

    if (response.status === 404) {
      container.innerHTML = '<p class="no-tasks">Вступите в семью, чтобы видеть активность</p>';
      loadMoreBtn.style.display = 'none';
      return;
    }

    const data = await response.json();
    activityTotal = data.total;
    activityEvents = activityEvents.concat(data.events);

    renderActivity();

    if (activityEvents.length < activityTotal) {
      loadMoreBtn.style.display = 'block';
    } else {
      loadMoreBtn.style.display = 'none';
    }
  } catch (error) {
    console.error('Ошибка загрузки активности:', error);
    container.innerHTML = '<p class="no-tasks">Ошибка загрузки</p>';
  }
}

// eslint-disable-next-line no-unused-vars
function loadMoreActivity() {
  activityOffset += ACTIVITY_LIMIT;
  loadActivity();
}

function renderActivity() {
  const container = document.getElementById('activityContainer');

  if (activityEvents.length === 0) {
    container.innerHTML = '<p class="no-tasks">Пока нет активности</p>';
    return;
  }

  container.innerHTML = activityEvents.map(event => {
    const actionText = ACTION_LABELS[event.action] || event.action;
    const time = formatActivityTime(event.created_at);
    const details = event.details && typeof event.details === 'object'
      ? formatActivityDetails(event.details)
      : '';

    return `
      <div class="activity-item">
        <div class="activity-user">${event.username}</div>
        <div class="activity-action">${actionText}</div>
        ${details ? `<div class="activity-details">${details}</div>` : ''}
        <div class="activity-time">${time}</div>
      </div>
    `;
  }).join('');
}

function formatActivityTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'только что';
  if (diffMins < 60) return `${diffMins} мин. назад`;
  if (diffHours < 24) return `${diffHours} ч. назад`;
  if (diffDays < 7) return `${diffDays} дн. назад`;
  return date.toLocaleDateString('ru-RU');
}

function formatActivityDetails(details) {
  const parts = [];
  if (details.title) parts.push(details.title);
  if (details.status) {
    const statusInfo = STATUS_LABELS[details.status];
    if (statusInfo) parts.push(`${statusInfo.icon} ${statusInfo.text}`);
  }
  return parts.join(' — ');
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
