// API URLs
const API_URL = '/api/tasks';
const AUTH_URL = '/api/auth';
const MASTER_URL = '/api/master';
const CLIENT_TASKS_URL = '/api/tasks/clients';
const AUDIT_URL = '/api/audit';
const DASHBOARD_URL = '/api/dashboard';
const COMMENTS_URL = '/api/comments';
const TAGS_URL = '/api/tags';
const polishUtils = window.PolishUtils || {
  getNetworkMessage: (isOnline) => (isOnline ? '' : 'Вы офлайн. Данные могут быть неактуальны.'),
  makeSkeleton: (count = 3) => (
    `<div class="skeleton-list">${Array.from({ length: count }, () => '<div class="skeleton-line"></div>').join('')}</div>`
  )
};
const telegramMiniApp = window.TelegramMiniApp || {
  init: () => false,
  onBackButton: () => {},
  setBackButtonVisible: () => {},
  confirm: async (message) => window.confirm(message),
  alert: async (message) => window.alert(message),
  isMiniApp: () => false,
  getInitData: () => ''
};

// Auth state
let authToken = localStorage.getItem('authToken');
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
let currentRole = localStorage.getItem('currentRole') || '';
let currentBookingSlug = localStorage.getItem('currentBookingSlug') || '';

// Clients state
let currentClients = [];
let selectedClientId = null;
let selectedClientName = '';
let currentTasksView = 'my'; // 'my' or 'clients'
let pendingTaskFocusId = null;
let selectedTaskIds = new Set();
let tasksPage = 1;
let tasksPages = 1;
let tasksTotal = 0;
const tasksQuery = {
  status: '',
  assignee: '',
  tag: '',
  list: '',
  sort: 'due_at',
  order: 'asc',
  page: 1,
  limit: 20
};

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

// Task detail modal state
let taskDetailId = null;
let taskDetailData = null;
let taskDetailChecklist = [];
let taskDetailComments = [];
let taskDetailTags = [];
let taskDetailAllTags = [];
let taskDetailAssignees = [];
let taskDetailMembers = [];
let taskDetailHistory = [];
const loadedRoutes = new Set();
const tgState = {
  enabled: false
};
const isCypress = Boolean(window.Cypress);

function isDayModalOpen() {
  const modal = document.getElementById('dayModal');
  return Boolean(modal && modal.style.display !== 'none');
}

function isTaskDetailOpen() {
  const modal = document.getElementById('taskDetailModal');
  return Boolean(modal && modal.style.display !== 'none');
}

function syncMiniAppBackButton() {
  if (!tgState.enabled) return;
  const shouldShow = isDayModalOpen() || isTaskDetailOpen() || getRouteFromHash() !== 'dashboard';
  telegramMiniApp.setBackButtonVisible(shouldShow);
}

function handleMiniAppBack() {
  if (isTaskDetailOpen()) {
    closeTaskDetailModal();
    return;
  }
  if (isDayModalOpen()) {
    closeDayModal();
    return;
  }
  if (getRouteFromHash() !== 'dashboard') {
    navigateTo('dashboard');
  }
}

// Helper: add auth header to fetch requests
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };
}

const nativeFetch = window.fetch.bind(window);

function showNetworkBanner(message, showRetry = false) {
  const banner = document.getElementById('networkBanner');
  const text = document.getElementById('networkBannerText');
  const retry = document.getElementById('networkRetryBtn');
  if (!banner || !text || !retry) return;
  text.textContent = message;
  retry.style.display = showRetry ? 'inline-flex' : 'none';
  banner.style.display = message ? 'flex' : 'none';
}

function updateNetworkBanner() {
  showNetworkBanner(polishUtils.getNetworkMessage(window.navigator.onLine), true);
}

window.fetch = async (...args) => {
  try {
    const response = await nativeFetch(...args);
    if (response.status >= 500) {
      showNetworkBanner('Сервер временно недоступен. Попробуйте позже.', true);
    }
    return response;
  } catch (error) {
    showNetworkBanner(
      window.navigator.onLine
        ? 'Ошибка сети. Проверьте подключение и повторите.'
        : polishUtils.getNetworkMessage(false),
      true
    );
    throw error;
  }
};

// === SPA ROUTER ===

const router = window.RouterUtils || {
  ROUTES: ['dashboard', 'calendar', 'tasks', 'kanban', 'clients', 'activity'],
  normalizeRoute: (route) => (
    ['dashboard', 'calendar', 'tasks', 'kanban', 'clients', 'activity']
      .includes(route)
      ? route
      : 'dashboard'
  ),
  getRouteFromHash: (hash) => {
    const route = (hash || '').replace('#/', '');
    return ['dashboard', 'calendar', 'tasks', 'kanban', 'clients', 'activity'].includes(route)
      ? route
      : 'dashboard';
  },
  buildHash: (route) => {
    const normalized = ['dashboard', 'calendar', 'tasks', 'kanban', 'clients', 'activity'].includes(route)
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
    if (allTasks.length === 0) loadTasks();
    renderCalendar();
  } else if (route === 'tasks') {
    if (!loadedRoutes.has('tasks')) loadTaskFilterOptions();
    loadTasks();
  } else if (route === 'kanban') {
    loadKanban();
  } else if (route === 'clients') {
    loadClients();
  } else if (route === 'activity') {
    activityOffset = 0;
    activityEvents = [];
    loadActivity();
  }

  loadedRoutes.add(route);
  syncMiniAppBackButton();
}

window.addEventListener('hashchange', handleRoute);

// === AUTH LOGIC ===

const authScreen = document.getElementById('authScreen');
const appScreen = document.getElementById('appScreen');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

async function tryTelegramAutoLogin() {
  if (authToken && currentUser) return true;
  if (!tgState.enabled) return false;

  const initData = telegramMiniApp.getInitData();
  if (!initData) return false;

  const loginError = document.getElementById('loginError');
  if (loginError) loginError.textContent = '';

  try {
    const response = await fetch(`${AUTH_URL}/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData })
    });

    if (!response.ok) return false;

    const data = await response.json();
    if (!data.token || !data.user) return false;

    authToken = data.token;
    currentUser = data.user;
    currentRole = data.role || 'client';
    currentBookingSlug = data.booking_slug || '';
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('token', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('currentRole', currentRole);
    if (currentBookingSlug) {
      localStorage.setItem('currentBookingSlug', currentBookingSlug);
    } else {
      localStorage.removeItem('currentBookingSlug');
    }
    return true;
  } catch {
    return false;
  }
}

function redirectToRoleHome() {
  if (isCypress || !tgState.enabled) return false;
  if (currentRole === 'master') {
    window.location.replace('/master');
    return true;
  }
  if (currentBookingSlug) {
    window.location.replace(`/book/${currentBookingSlug}`);
    return true;
  }
  return false;
}

// Show correct screen on load
function checkAuth() {
  if (!tgState.enabled) {
    authScreen.style.display = 'block';
    appScreen.style.display = 'none';
    renderTelegramOnlyState();
    return;
  }

  if (authToken && currentUser) {
    if (redirectToRoleHome()) return;
    authScreen.style.display = 'none';
    appScreen.style.display = 'flex';
    document.getElementById('currentUser').textContent = currentUser.username;
    // Route to current hash or default
    if (!window.location.hash || window.location.hash === '#/') {
      navigateTo('dashboard');
    } else {
      handleRoute();
    }
    syncMiniAppBackButton();
  } else {
    authScreen.style.display = 'block';
    appScreen.style.display = 'none';
    syncMiniAppBackButton();
  }
}

function renderTelegramOnlyState() {
  const tabs = document.querySelector('.auth-tabs');
  const loginError = document.getElementById('loginError');
  const registerError = document.getElementById('registerError');
  const title = document.querySelector('#authScreen header p');
  const notice = document.getElementById('telegramOnlyNotice');

  if (tabs) tabs.style.display = 'none';
  if (loginForm) loginForm.style.display = 'none';
  if (registerForm) registerForm.style.display = 'none';
  if (loginError) loginError.textContent = '';
  if (registerError) registerError.textContent = '';
  if (title) title.textContent = 'Доступен только через Telegram Mini App';
  if (notice) notice.style.display = 'block';
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
    localStorage.setItem('token', authToken);
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
    localStorage.setItem('token', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    checkAuth();
  } catch {
    errorEl.textContent = 'Ошибка соединения с сервером';
  }
});

function logout() {
  authToken = null;
  currentUser = null;
  currentClients = [];
  selectedClientId = null;
  selectedClientName = '';
  localStorage.removeItem('authToken');
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('currentRole');
  localStorage.removeItem('currentBookingSlug');
  loadedRoutes.clear();
  window.location.hash = '';
  checkAuth();
}

// === DASHBOARD LOGIC ===

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const skeleton = polishUtils.makeSkeleton(3);
  const todayList = document.getElementById('dashTodayList');
  const overdueList = document.getElementById('dashOverdueList');
  const upcomingList = document.getElementById('dashUpcomingList');
  if (todayList) todayList.innerHTML = skeleton;
  if (overdueList) overdueList.innerHTML = skeleton;
  if (upcomingList) upcomingList.innerHTML = skeleton;

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

// === CLIENTS LOGIC ===

async function loadClients() {
  const listEl = document.getElementById('clientsList');
  const emptyEl = document.getElementById('clientsEmpty');
  const errorEl = document.getElementById('clientsError');
  if (!listEl || !emptyEl || !errorEl) return;

  listEl.innerHTML = polishUtils.makeSkeleton(3);
  emptyEl.style.display = 'none';
  errorEl.textContent = '';

  try {
    const response = await fetch(`${MASTER_URL}/clients`, { headers: authHeaders() });
    if (response.status === 401 || response.status === 403) {
      errorEl.textContent = 'Раздел клиентов доступен только мастеру';
      listEl.innerHTML = '';
      return;
    }
    if (!response.ok) {
      errorEl.textContent = 'Не удалось загрузить список клиентов';
      listEl.innerHTML = '';
      return;
    }

    currentClients = await response.json();
    if (!currentClients.some((item) => item.user_id === selectedClientId)) {
      selectedClientId = null;
      selectedClientName = '';
    }
    renderClientsList();
  } catch (error) {
    console.error('Ошибка загрузки клиентов:', error);
    errorEl.textContent = 'Ошибка соединения с сервером';
    listEl.innerHTML = '';
  }
}

function renderClientsList() {
  const listEl = document.getElementById('clientsList');
  const emptyEl = document.getElementById('clientsEmpty');
  if (!listEl || !emptyEl) return;

  if (!currentClients.length) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    renderClientBookings([]);
    return;
  }

  emptyEl.style.display = 'none';
  listEl.innerHTML = currentClients.map((client) => {
    const activeClass = selectedClientId === client.user_id ? ' active' : '';
    const displayName = escapeHtml(client.username || `Клиент #${client.user_id}`);
    const telegramId = client.telegram_user_id ? `#${client.telegram_user_id}` : 'не указан';
    return `
      <button class="client-card${activeClass}" onclick="selectClient(${client.user_id})">
        <span class="client-card-title">${displayName}</span>
        <span class="client-card-meta">Telegram: ${telegramId}</span>
        <span class="client-card-meta">Записей: ${client.bookings_total || 0}</span>
        <span class="client-card-meta">Будущих: ${client.upcoming_total || 0}</span>
      </button>
    `;
  }).join('');
}

// eslint-disable-next-line no-unused-vars
async function selectClient(clientId) {
  const selected = currentClients.find((item) => item.user_id === clientId);
  selectedClientId = clientId;
  selectedClientName = selected?.username || `Клиент #${clientId}`;
  renderClientsList();
  await loadClientBookings(clientId);
}

async function loadClientBookings(clientId) {
  const errorEl = document.getElementById('clientsError');
  if (!errorEl) return;
  errorEl.textContent = '';

  try {
    const response = await fetch(`${MASTER_URL}/clients/${clientId}/bookings`, { headers: authHeaders() });
    if (!response.ok) {
      errorEl.textContent = 'Не удалось загрузить историю клиента';
      renderClientBookings([]);
      return;
    }
    const bookings = await response.json();
    renderClientBookings(bookings);
  } catch (error) {
    console.error('Ошибка загрузки истории клиента:', error);
    errorEl.textContent = 'Ошибка соединения с сервером';
    renderClientBookings([]);
  }
}

function renderClientBookings(bookings) {
  const sectionEl = document.getElementById('clientBookingsSection');
  const titleEl = document.getElementById('clientBookingsTitle');
  const listEl = document.getElementById('clientBookingsList');
  const emptyEl = document.getElementById('clientBookingsEmpty');
  if (!sectionEl || !titleEl || !listEl || !emptyEl) return;

  if (!selectedClientId) {
    sectionEl.style.display = 'none';
    listEl.innerHTML = '';
    emptyEl.style.display = 'none';
    return;
  }

  sectionEl.style.display = 'block';
  titleEl.textContent = `История клиента: ${selectedClientName}`;

  if (!bookings.length) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';
  listEl.innerHTML = bookings.map((booking) => {
    const startAt = booking.start_at ? new Date(booking.start_at).toLocaleString('ru-RU') : 'Дата не указана';
    const status = escapeHtml(BOOKING_STATUS_LABELS[booking.status] || 'Запланировано');
    const service = escapeHtml(booking.service_name || 'Услуга');
    const note = escapeHtml(booking.client_note || booking.master_note || '');
    return `
      <article class="booking-history-item">
        <div class="booking-history-main">
          <strong>${service}</strong>
          <span>${startAt}</span>
        </div>
        <div class="booking-history-meta">
          <span class="booking-history-status">${status}</span>
          ${note ? `<p class="booking-history-note">${note}</p>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

// eslint-disable-next-line no-unused-vars
function switchTasksView(view, el) {
  currentTasksView = view;
  const tabs = document.querySelectorAll('.tasks-tab');
  tabs.forEach(t => t.classList.remove('active'));
  el.classList.add('active');

  document.getElementById('tasksTitle').textContent =
    view === 'my' ? 'Мои задачи' : 'Задачи клиентов';

  selectedTaskIds = new Set();
  tasksPage = 1;

  const filters = document.getElementById('tasksFilters');
  const bulk = document.getElementById('tasksBulkActions');
  const pagination = document.getElementById('tasksPagination');
  const showAdvanced = view === 'my';
  if (filters) filters.style.display = showAdvanced ? 'grid' : 'none';
  if (bulk) bulk.style.display = showAdvanced ? 'flex' : 'none';
  if (pagination) pagination.style.display = showAdvanced ? 'flex' : 'none';

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

const BOOKING_STATUS_LABELS = {
  pending: 'Ожидает подтверждения',
  confirmed: 'Запланировано',
  completed: 'Выполнено',
  canceled: 'Отменено'
};
const kanbanUtils = window.KanbanUtils || {
  KANBAN_STATUSES: ['backlog', 'planned', 'in_progress', 'done'],
  KANBAN_COLUMN_TITLES: {
    backlog: 'Бэклог',
    planned: 'Запланировано',
    in_progress: 'В работе',
    done: 'Выполнено'
  },
  filterKanbanTasks: (tasks) => (Array.isArray(tasks)
    ? tasks.filter((task) => ['backlog', 'planned', 'in_progress', 'done'].includes(task.status))
    : [])
};
const taskDetailUtils = window.TaskDetailUtils || {
  markdownToHtml: (text) => String(text || '').replace(/\n/g, '<br>')
};

const KANBAN_STATUSES = kanbanUtils.KANBAN_STATUSES;
const KANBAN_COLUMN_TITLES = kanbanUtils.KANBAN_COLUMN_TITLES;
let kanbanTasks = [];
let kanbanInitialized = false;

function updateTasksPagination() {
  const pageInfo = document.getElementById('tasksPageInfo');
  const prevBtn = document.getElementById('tasksPrevPage');
  const nextBtn = document.getElementById('tasksNextPage');
  const pagination = document.getElementById('tasksPagination');

  if (!pageInfo || !prevBtn || !nextBtn || !pagination) return;

  if (currentTasksView === 'clients') {
    pagination.style.display = 'none';
    return;
  }

  pagination.style.display = 'flex';
  pageInfo.textContent = `Страница ${tasksPage} / ${tasksPages} (всего: ${tasksTotal})`;
  prevBtn.disabled = tasksPage <= 1;
  nextBtn.disabled = tasksPage >= tasksPages;
}

function updateSelectedCount() {
  const selectedEl = document.getElementById('tasksSelectedCount');
  if (selectedEl) selectedEl.textContent = `Выбрано: ${selectedTaskIds.size}`;
}

function buildTasksQueryString() {
  const params = new window.URLSearchParams();
  if (tasksQuery.status) params.set('status', tasksQuery.status);
  if (tasksQuery.assignee) params.set('assignee', tasksQuery.assignee);
  if (tasksQuery.tag) params.set('tag', tasksQuery.tag);
  if (tasksQuery.list) params.set('list', tasksQuery.list);
  params.set('sort', tasksQuery.sort);
  params.set('order', tasksQuery.order);
  params.set('page', String(tasksPage));
  params.set('limit', String(tasksQuery.limit));
  return params.toString();
}

async function loadTaskFilterOptions() {
  const assigneeSelect = document.getElementById('tasksFilterAssignee');
  const tagSelect = document.getElementById('tasksFilterTag');
  const listSelect = document.getElementById('tasksFilterList');

  if (!assigneeSelect || !tagSelect || !listSelect) return;

  try {
    const clientsRes = await fetch(`${MASTER_URL}/clients`, { headers: authHeaders() });
    if (clientsRes.ok) {
      const clients = await clientsRes.json();
      const members = clients.map((item) => ({ id: item.user_id, username: item.username }));
      assigneeSelect.innerHTML = '<option value="">Любой исполнитель</option>' +
        members.map((m) => `<option value="${m.id}">${m.username}</option>`).join('');
    }
  } catch {
    // ignore filter options loading failures
  }

  try {
    const [tagsRes, listsRes] = await Promise.all([
      fetch('/api/tags', { headers: authHeaders() }),
      fetch('/api/lists', { headers: authHeaders() })
    ]);

    if (tagsRes.ok) {
      const tags = await tagsRes.json();
      tagSelect.innerHTML = '<option value="">Любой тег</option>' +
        tags.map((tag) => `<option value="${tag.id}">${tag.name}</option>`).join('');
    }
    if (listsRes.ok) {
      const lists = await listsRes.json();
      listSelect.innerHTML = '<option value="">Любой список</option>' +
        lists.map((list) => `<option value="${list.id}">${list.name}</option>`).join('');
    }
  } catch {
    // ignore filter options loading failures
  }
}

// Load all tasks from API
async function loadTasks() {
  if (tasksContainer) tasksContainer.innerHTML = polishUtils.makeSkeleton(5);
  try {
    const route = getRouteFromHash();
    const useAdvancedListQuery = currentTasksView === 'my' && route === 'tasks';
    const url = currentTasksView === 'clients'
      ? CLIENT_TASKS_URL
      : (useAdvancedListQuery ? `${API_URL}?${buildTasksQueryString()}` : API_URL);

    const response = await fetch(url, { headers: authHeaders() });
    if (response.status === 401 || response.status === 403) { logout(); return; }
    if (response.status === 404 && currentTasksView === 'clients') {
      if (tasksContainer) tasksContainer.innerHTML = '<p class="no-tasks">Нет задач клиентов</p>';
      return;
    }

    const payload = await response.json();
    const tasks = Array.isArray(payload) ? payload : payload.tasks || [];

    if (useAdvancedListQuery && !Array.isArray(payload)) {
      tasksTotal = payload.total || 0;
      tasksPage = payload.page || 1;
      tasksPages = payload.pages || 1;
    } else {
      tasksTotal = tasks.length;
      tasksPage = 1;
      tasksPages = 1;
    }

    allTasks = tasks;
    displayTasks(tasks);
    updateTasksPagination();

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
    selectedTaskIds = new Set();
    updateSelectedCount();
    return;
  }

  const isClientsView = currentTasksView === 'clients';

  const tasksHTML = tasks.map(task => {
    const statusInfo = STATUS_LABELS[task.status] || STATUS_LABELS.planned;
    const priorityInfo = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.medium;
    const doneClass = task.status === 'done' ? 'completed' : '';
    const ownerLabel = isClientsView && task.username
      ? `<span class="task-owner">${task.username}</span>`
      : '';
    const isOwnTask = !isClientsView || task.user_id === currentUser.id;
    const checked = selectedTaskIds.has(task.id) ? 'checked' : '';

    return `
      <div
        class="task-item ${doneClass}"
        id="task-item-${task.id}"
        data-task-id="${task.id}"
        data-status="${task.status}"
        data-priority="${task.priority || 'medium'}"
      >
        ${isOwnTask ? `<input class="task-select" type="checkbox" data-task-id="${task.id}" ${checked}>` : ''}
        <div class="task-info">
          <div class="task-title" data-edit-id="${task.id}">${task.title}</div>
          <div class="task-meta">
            ${ownerLabel}
            <span class="task-date">${formatDate(task.date)}</span>
            <span class="task-priority priority-${task.priority || 'medium'}">${priorityInfo.icon}</span>
            <span class="task-status status-${task.status}">${statusInfo.icon} ${statusInfo.text}</span>
          </div>
        </div>
        ${isOwnTask ? `
        <div class="task-actions">
          <button class="btn-small" onclick="openTaskDetail(${task.id})">
            Подробнее
          </button>
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
  updateSelectedCount();

  document.querySelectorAll('.task-select').forEach((checkbox) => {
    checkbox.addEventListener('change', (e) => {
      const taskId = parseInt(e.target.dataset.taskId);
      if (e.target.checked) selectedTaskIds.add(taskId);
      else selectedTaskIds.delete(taskId);
      updateSelectedCount();
    });
  });

  document.querySelectorAll('.task-title[data-edit-id]').forEach((titleEl) => {
    titleEl.addEventListener('dblclick', async (e) => {
      const taskId = parseInt(e.target.dataset.editId);
      const currentTitle = e.target.textContent || '';
      const newTitle = window.prompt('Новое название задачи:', currentTitle);
      if (!newTitle || newTitle.trim() === currentTitle.trim()) return;

      await fetch(`${API_URL}/${taskId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ title: newTitle.trim() })
      });
      loadTasks();
    });
  });

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
    await telegramMiniApp.alert('Пожалуйста, заполните все поля!');
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
      await telegramMiniApp.alert('Ошибка при добавлении задачи');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await telegramMiniApp.alert('Ошибка при добавлении задачи');
  }
});

const tasksApplyFiltersBtn = document.getElementById('tasksApplyFilters');
const tasksPrevPageBtn = document.getElementById('tasksPrevPage');
const tasksNextPageBtn = document.getElementById('tasksNextPage');

if (tasksApplyFiltersBtn) {
  tasksApplyFiltersBtn.addEventListener('click', () => {
    tasksQuery.status = document.getElementById('tasksFilterStatus')?.value || '';
    tasksQuery.assignee = document.getElementById('tasksFilterAssignee')?.value || '';
    tasksQuery.tag = document.getElementById('tasksFilterTag')?.value || '';
    tasksQuery.list = document.getElementById('tasksFilterList')?.value || '';
    tasksQuery.sort = document.getElementById('tasksSortBy')?.value || 'due_at';
    tasksQuery.order = document.getElementById('tasksSortOrder')?.value || 'asc';
    tasksPage = 1;
    loadTasks();
  });
}

if (tasksPrevPageBtn) {
  tasksPrevPageBtn.addEventListener('click', () => {
    if (tasksPage > 1) {
      tasksPage--;
      loadTasks();
    }
  });
}

if (tasksNextPageBtn) {
  tasksNextPageBtn.addEventListener('click', () => {
    if (tasksPage < tasksPages) {
      tasksPage++;
      loadTasks();
    }
  });
}

async function bulkUpdateStatus(nextStatus) {
  if (selectedTaskIds.size === 0) return;
  await Promise.all(Array.from(selectedTaskIds).map((id) => (
    fetch(`${API_URL}/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ status: nextStatus })
    })
  )));
  selectedTaskIds = new Set();
  loadTasks();
}

async function bulkDeleteTasks() {
  if (selectedTaskIds.size === 0) return;
  if (!await telegramMiniApp.confirm(`Удалить задач: ${selectedTaskIds.size}?`)) return;
  await Promise.all(Array.from(selectedTaskIds).map((id) => (
    fetch(`${API_URL}/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    })
  )));
  selectedTaskIds = new Set();
  loadTasks();
}

document.getElementById('bulkSetPlanned')?.addEventListener('click', () => bulkUpdateStatus('planned'));
document.getElementById('bulkSetDone')?.addEventListener('click', () => bulkUpdateStatus('done'));
document.getElementById('bulkDelete')?.addEventListener('click', bulkDeleteTasks);

function renderKanbanBoard() {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  const columnsHtml = KANBAN_STATUSES.map((status) => {
    const tasks = kanbanTasks.filter((task) => task.status === status);
    const cardsHtml = tasks.length
      ? tasks.map((task) => {
        const priority = task.priority || 'medium';
        const statusInfo = STATUS_LABELS[task.status] || STATUS_LABELS.planned;
        return `
          <article class="kanban-card priority-${priority}" draggable="true" data-task-id="${task.id}" onclick="openTaskDetail(${task.id})">
            <div class="kanban-card-title">${task.title}</div>
            <div class="kanban-card-meta">
              <span class="kanban-priority">Приоритет: ${priority}</span>
              <span class="kanban-status">${statusInfo.icon} ${statusInfo.text}</span>
              <span class="kanban-assignee">Исполнитель: ${task.assignees?.[0]?.username || '—'}</span>
              <span class="kanban-tags">Теги: ${(task.tags || []).map((tag) => tag.name).join(', ') || '—'}</span>
            </div>
          </article>
        `;
      }).join('')
      : '<p class="kanban-empty">Нет задач в колонке. Добавьте первую карточку ниже.</p>';

    return `
      <article class="kanban-column" data-status="${status}">
        <div class="kanban-column-header">
          <h3>${KANBAN_COLUMN_TITLES[status]}</h3>
          <span class="kanban-count">${tasks.length}</span>
        </div>
        <div class="kanban-column-dropzone" data-status="${status}">
          <div class="kanban-cards">${cardsHtml}</div>
        </div>
        <form class="kanban-create-form" data-status="${status}">
          <input
            id="kanbanInput-${status}"
            class="kanban-create-input"
            type="text"
            placeholder="Новая задача"
            required
          >
          <button class="btn-small" type="submit">Добавить</button>
        </form>
      </article>
    `;
  }).join('');

  board.innerHTML = `<div class="kanban-board">${columnsHtml}</div>`;

  document.querySelectorAll('.kanban-create-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = form.dataset.status;
      const input = form.querySelector('.kanban-create-input');
      const title = input?.value?.trim();
      if (!status || !title) return;

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title, date: todayIsoDate(), status, priority: 'medium' })
      });

      if (response.ok) {
        input.value = '';
        await loadKanban();
      }
    });
  });

  document.querySelectorAll('.kanban-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  document.querySelectorAll('.kanban-column-dropzone').forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const taskId = parseInt(e.dataTransfer.getData('text/plain'));
      const nextStatus = zone.dataset.status;
      if (!taskId || !nextStatus) return;

      const response = await fetch(`${API_URL}/${taskId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ status: nextStatus })
      });

      if (response.ok) {
        await loadKanban();
      }
    });
  });
}

async function loadKanban() {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  if (!kanbanInitialized) kanbanInitialized = true;
  board.innerHTML = polishUtils.makeSkeleton(4);

  try {
    const response = await fetch(`${API_URL}?sort=priority&order=desc&page=1&limit=200`, {
      headers: authHeaders()
    });
    if (response.status === 401 || response.status === 403) { logout(); return; }

    const payload = await response.json();
    const tasks = Array.isArray(payload) ? payload : payload.tasks || [];
    kanbanTasks = kanbanUtils.filterKanbanTasks(tasks);
    renderKanbanBoard();
  } catch (error) {
    console.error('Ошибка при загрузке канбан-доски:', error);
    board.innerHTML = '<p class="no-tasks">Ошибка при загрузке задач</p>';
  }
}

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
      await telegramMiniApp.alert('Ошибка при обновлении задачи');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await telegramMiniApp.alert('Ошибка при обновлении задачи');
  }
}

// Delete task
// eslint-disable-next-line no-unused-vars
async function deleteTask(id) {
  if (!await telegramMiniApp.confirm('Вы уверены, что хотите удалить эту задачу?')) {
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
      await telegramMiniApp.alert('Ошибка при удалении задачи');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await telegramMiniApp.alert('Ошибка при удалении задачи');
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
  syncMiniAppBackButton();
}

function closeDayModal(event) {
  // If called from overlay click, only close if clicking overlay itself
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('dayModal').style.display = 'none';
  modalDate = null;
  syncMiniAppBackButton();
}

function renderModalTasks() {
  const container = document.getElementById('modalTasks');
  const dayTasks = allTasks.filter(t => t.date === modalDate);

  if (dayTasks.length === 0) {
    container.innerHTML = '<p class="modal-no-tasks">Нет задач на этот день</p>';
    return;
  }

  const isClientsView = currentTasksView === 'clients';

  container.innerHTML = dayTasks.map(task => {
    const statusInfo = STATUS_LABELS[task.status] || STATUS_LABELS.planned;
    const doneClass = task.status === 'done' ? 'completed' : '';
    const isOwnTask = !isClientsView || task.user_id === currentUser.id;
    const ownerLabel = isClientsView && task.username
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
  if (!await telegramMiniApp.confirm('Удалить задачу?')) return;
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

// === TASK DETAIL MODAL ===

function renderTaskDetailModal() {
  const modalTitle = document.getElementById('taskDetailTitle');
  const meta = document.getElementById('taskDetailMeta');
  const description = document.getElementById('taskDetailDescription');
  const descriptionPreview = document.getElementById('taskDetailDescriptionPreview');
  const checklist = document.getElementById('taskDetailChecklist');
  const comments = document.getElementById('taskDetailComments');
  const tags = document.getElementById('taskDetailTags');
  const assignees = document.getElementById('taskDetailAssignees');
  const history = document.getElementById('taskDetailHistory');
  const tagSelect = document.getElementById('taskDetailTagSelect');
  const assignSelect = document.getElementById('taskDetailAssignSelect');

  if (!taskDetailData || !modalTitle || !meta || !description || !descriptionPreview ||
    !checklist || !comments || !tags || !assignees || !history || !tagSelect || !assignSelect) {
    return;
  }

  modalTitle.textContent = taskDetailData.title;
  meta.innerHTML = `
    <label>Статус
      <select id="taskDetailStatus">
        ${Object.keys(STATUS_LABELS).map((status) => (
    `<option value="${status}" ${taskDetailData.status === status ? 'selected' : ''}>${STATUS_LABELS[status].text}</option>`
  )).join('')}
      </select>
    </label>
    <label>Приоритет
      <select id="taskDetailPriority">
        <option value="low" ${taskDetailData.priority === 'low' ? 'selected' : ''}>Низкий</option>
        <option value="medium" ${taskDetailData.priority === 'medium' ? 'selected' : ''}>Средний</option>
        <option value="high" ${taskDetailData.priority === 'high' ? 'selected' : ''}>Высокий</option>
        <option value="urgent" ${taskDetailData.priority === 'urgent' ? 'selected' : ''}>Срочный</option>
      </select>
    </label>
    <label>Дата
      <input id="taskDetailDate" type="date" value="${escapeHtml(taskDetailData.date)}">
    </label>
    <button class="btn-small" onclick="saveTaskDetailMeta()">Сохранить</button>
  `;

  description.value = taskDetailData.description || '';
  descriptionPreview.innerHTML = taskDetailUtils.markdownToHtml(taskDetailData.description || '');

  checklist.innerHTML = taskDetailChecklist.length === 0
    ? '<p class="detail-empty">Нет пунктов</p>'
    : taskDetailChecklist.map((item) => `
      <div class="detail-check-item ${item.is_done ? 'done' : ''}">
        <input type="checkbox" ${item.is_done ? 'checked' : ''} onclick="toggleTaskDetailChecklistItem(${item.id}, ${!item.is_done})">
        <span>${escapeHtml(item.title)}</span>
        <button class="btn-small btn-delete" onclick="deleteTaskDetailChecklistItem(${item.id})">Удалить</button>
      </div>
    `).join('');

  comments.innerHTML = taskDetailComments.length === 0
    ? '<p class="detail-empty">Нет комментариев</p>'
    : taskDetailComments.map((comment) => `
      <div class="detail-comment">
        <div class="detail-comment-head">
          <strong>${escapeHtml(comment.username || '')}</strong>
          <span>${new Date(comment.created_at).toLocaleString('ru-RU')}</span>
        </div>
        <p>${escapeHtml(comment.text)}</p>
        ${comment.user_id === currentUser.id ? `
          <div class="detail-comment-actions">
            <button class="btn-small" onclick="editTaskDetailComment(${comment.id})">Редактировать</button>
            <button class="btn-small btn-delete" onclick="deleteTaskDetailComment(${comment.id})">Удалить</button>
          </div>
        ` : ''}
      </div>
    `).join('');

  tags.innerHTML = taskDetailTags.length === 0
    ? '<p class="detail-empty">Нет тегов</p>'
    : taskDetailTags.map((tag) => `
      <span class="detail-tag-chip">
        ${escapeHtml(tag.name)}
        <button class="btn-small btn-delete" onclick="removeTagFromTaskDetail(${tag.id})">x</button>
      </span>
    `).join('');

  const attachedTagIds = new Set(taskDetailTags.map((tag) => tag.id));
  tagSelect.innerHTML = '<option value="">Выберите тег</option>' + taskDetailAllTags
    .filter((tag) => !attachedTagIds.has(tag.id))
    .map((tag) => `<option value="${tag.id}">${escapeHtml(tag.name)}</option>`)
    .join('');

  assignees.innerHTML = taskDetailAssignees.length === 0
    ? '<p class="detail-empty">Нет назначений</p>'
    : taskDetailAssignees.map((row) => `
      <div class="detail-assignee-item">
        <span>${escapeHtml(row.username)} (${row.role})</span>
        <button class="btn-small btn-delete" onclick="unassignTaskDetailUser(${row.user_id})">Снять</button>
      </div>
    `).join('');

  const assignedIds = new Set(taskDetailAssignees.map((row) => row.user_id));
  assignSelect.innerHTML = '<option value="">Выберите клиента</option>' + taskDetailMembers
    .filter((member) => member.id !== currentUser.id && !assignedIds.has(member.id))
    .map((member) => `<option value="${member.id}">${escapeHtml(member.username)}</option>`)
    .join('');

  history.innerHTML = taskDetailHistory.length === 0
    ? '<p class="detail-empty">Нет истории</p>'
    : taskDetailHistory.slice(0, 20).map((event) => `
      <div class="detail-history-item">
        <strong>${escapeHtml(event.username || '')}</strong>
        <span>${escapeHtml(event.action || '')}</span>
        <time>${new Date(event.created_at).toLocaleString('ru-RU')}</time>
      </div>
    `).join('');
}

async function loadTaskDetail(taskId) {
  const modalTitle = document.getElementById('taskDetailTitle');
  if (modalTitle) modalTitle.textContent = 'Загрузка...';

  try {
    const [taskRes, checklistRes, commentsRes, taskTagsRes, allTagsRes, historyRes, assigneesRes, clientsRes] = await Promise.all([
      fetch(`${API_URL}/${taskId}`, { headers: authHeaders() }),
      fetch(`${API_URL}/${taskId}/checklist`, { headers: authHeaders() }),
      fetch(`${COMMENTS_URL}/task/${taskId}?limit=100&offset=0`, { headers: authHeaders() }),
      fetch(`${API_URL}/${taskId}/tags`, { headers: authHeaders() }),
      fetch(TAGS_URL, { headers: authHeaders() }),
      fetch(`${AUDIT_URL}/entity/task/${taskId}`, { headers: authHeaders() }),
      fetch(`${API_URL}/${taskId}/assignees`, { headers: authHeaders() }),
      fetch(`${MASTER_URL}/clients`, { headers: authHeaders() })
    ]);

    if (!taskRes.ok) throw new Error('task load failed');

    taskDetailId = taskId;
    taskDetailData = await taskRes.json();
    taskDetailChecklist = checklistRes.ok ? (await checklistRes.json()).items || [] : [];
    taskDetailComments = commentsRes.ok ? (await commentsRes.json()).comments || [] : [];
    taskDetailTags = taskTagsRes.ok ? await taskTagsRes.json() : [];
    taskDetailAllTags = allTagsRes.ok ? await allTagsRes.json() : [];
    taskDetailHistory = historyRes.ok ? await historyRes.json() : [];
    taskDetailAssignees = assigneesRes.ok ? await assigneesRes.json() : [];
    taskDetailMembers = clientsRes.ok
      ? (await clientsRes.json()).map((item) => ({ id: item.user_id, username: item.username }))
      : [];

    renderTaskDetailModal();
  } catch (error) {
    console.error('Ошибка загрузки карточки задачи:', error);
    if (modalTitle) modalTitle.textContent = 'Ошибка загрузки карточки';
  }
}

// eslint-disable-next-line no-unused-vars
function openTaskDetail(taskId) {
  const modal = document.getElementById('taskDetailModal');
  if (!modal) return;
  modal.style.display = 'flex';
  loadTaskDetail(taskId);
  syncMiniAppBackButton();
}

function closeTaskDetailModal(event) {
  if (event && event.target && event.target.id !== 'taskDetailModal') return;
  const modal = document.getElementById('taskDetailModal');
  if (!modal) return;
  modal.style.display = 'none';
  taskDetailId = null;
  taskDetailData = null;
  syncMiniAppBackButton();
}

// eslint-disable-next-line no-unused-vars
async function saveTaskDetailMeta() {
  if (!taskDetailId) return;
  const status = document.getElementById('taskDetailStatus')?.value;
  const priority = document.getElementById('taskDetailPriority')?.value;
  const date = document.getElementById('taskDetailDate')?.value;

  const response = await fetch(`${API_URL}/${taskDetailId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ status, priority, date })
  });
  if (response.ok) {
    await loadTaskDetail(taskDetailId);
    if (getRouteFromHash() === 'tasks') loadTasks();
    if (getRouteFromHash() === 'kanban') loadKanban();
  }
}

// eslint-disable-next-line no-unused-vars
async function saveTaskDetailDescription() {
  if (!taskDetailId) return;
  const description = document.getElementById('taskDetailDescription')?.value || '';
  const response = await fetch(`${API_URL}/${taskDetailId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ description })
  });
  if (response.ok) {
    await loadTaskDetail(taskDetailId);
  }
}

// eslint-disable-next-line no-unused-vars
async function addTaskDetailChecklistItem() {
  if (!taskDetailId) return;
  const input = document.getElementById('taskDetailChecklistInput');
  const title = input?.value?.trim();
  if (!title) return;
  const response = await fetch(`${API_URL}/${taskDetailId}/checklist`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title })
  });
  if (response.ok) {
    input.value = '';
    await loadTaskDetail(taskDetailId);
  }
}

// eslint-disable-next-line no-unused-vars
async function toggleTaskDetailChecklistItem(itemId, nextDone) {
  if (!taskDetailId) return;
  const current = taskDetailChecklist.find((item) => item.id === itemId);
  if (!current) return;
  const response = await fetch(`${API_URL}/${taskDetailId}/checklist/${itemId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ title: current.title, is_done: nextDone })
  });
  if (response.ok) await loadTaskDetail(taskDetailId);
}

// eslint-disable-next-line no-unused-vars
async function deleteTaskDetailChecklistItem(itemId) {
  if (!taskDetailId) return;
  const response = await fetch(`${API_URL}/${taskDetailId}/checklist/${itemId}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (response.ok) await loadTaskDetail(taskDetailId);
}

// eslint-disable-next-line no-unused-vars
async function addTaskDetailComment() {
  if (!taskDetailId) return;
  const input = document.getElementById('taskDetailCommentInput');
  const text = input?.value?.trim();
  if (!text) return;
  const response = await fetch(`${COMMENTS_URL}/task/${taskDetailId}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ text })
  });
  if (response.ok) {
    input.value = '';
    await loadTaskDetail(taskDetailId);
  }
}

// eslint-disable-next-line no-unused-vars
async function editTaskDetailComment(commentId) {
  const current = taskDetailComments.find((comment) => comment.id === commentId);
  if (!current) return;
  const text = window.prompt('Изменить комментарий', current.text || '');
  if (!text || !text.trim()) return;
  const response = await fetch(`${COMMENTS_URL}/${commentId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ text: text.trim() })
  });
  if (response.ok) await loadTaskDetail(taskDetailId);
}

// eslint-disable-next-line no-unused-vars
async function deleteTaskDetailComment(commentId) {
  if (!await telegramMiniApp.confirm('Удалить комментарий?')) return;
  const response = await fetch(`${COMMENTS_URL}/${commentId}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (response.ok) await loadTaskDetail(taskDetailId);
}

// eslint-disable-next-line no-unused-vars
async function addTagToTaskDetail() {
  if (!taskDetailId) return;
  const tagId = parseInt(document.getElementById('taskDetailTagSelect')?.value || '');
  if (!tagId) return;
  const response = await fetch(`${TAGS_URL}/${tagId}/tasks/${taskDetailId}`, {
    method: 'POST',
    headers: authHeaders()
  });
  if (response.ok) await loadTaskDetail(taskDetailId);
}

// eslint-disable-next-line no-unused-vars
async function removeTagFromTaskDetail(tagId) {
  if (!taskDetailId) return;
  const response = await fetch(`${TAGS_URL}/${tagId}/tasks/${taskDetailId}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (response.ok) await loadTaskDetail(taskDetailId);
}

// eslint-disable-next-line no-unused-vars
async function assignTaskDetailUser() {
  if (!taskDetailId) return;
  const userId = parseInt(document.getElementById('taskDetailAssignSelect')?.value || '');
  const role = document.getElementById('taskDetailAssignRole')?.value || 'assignee';
  if (!userId) return;
  const response = await fetch(`${API_URL}/${taskDetailId}/assign`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ user_id: userId, role })
  });
  if (response.ok) await loadTaskDetail(taskDetailId);
}

// eslint-disable-next-line no-unused-vars
async function unassignTaskDetailUser(userId) {
  if (!taskDetailId) return;
  const response = await fetch(`${API_URL}/${taskDetailId}/assign/${userId}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (response.ok) await loadTaskDetail(taskDetailId);
}

// === ACTIVITY FEED ===

const ACTION_LABELS = {
  'task.created': 'создал(а) задачу',
  'task.updated': 'обновил(а) задачу',
  'task.deleted': 'удалил(а) задачу',
  'task.status_changed': 'изменил(а) статус',
  'comment.created': 'оставил(а) комментарий',
  'comment.deleted': 'удалил(а) комментарий',
  'member.joined': 'добавил(а) клиента',
  'member.left': 'деактивировал(а) клиента',
  'member.kicked': 'удалил(а) клиента',
  'client.added': 'добавил(а) клиента',
  'client.left': 'деактивировал(а) клиента',
  'client.removed': 'удалил(а) клиента',
  'list.created': 'создал(а) список',
  'list.deleted': 'удалил(а) список'
};

async function loadActivity() {
  const container = document.getElementById('activityContainer');
  const loadMoreBtn = document.getElementById('activityLoadMore');
  if (activityOffset === 0) container.innerHTML = polishUtils.makeSkeleton(4);

  try {
    const response = await fetch(
      `${AUDIT_URL}?limit=${ACTIVITY_LIMIT}&offset=${activityOffset}`,
      { headers: authHeaders() }
    );

    if (response.status === 401 || response.status === 403) { logout(); return; }

    if (response.status === 404) {
      container.innerHTML = '<p class="no-tasks">Подключите клиентскую базу, чтобы видеть активность</p>';
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
    container.innerHTML = '<p class="no-tasks">Пока нет активности. Как только начнется работа с задачами, здесь появятся события.</p>';
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
  if (e.key !== 'Escape') return;
  const detailModal = document.getElementById('taskDetailModal');
  if (detailModal && detailModal.style.display !== 'none') {
    closeTaskDetailModal();
    return;
  }
  if (modalDate) {
    closeDayModal();
  }
});

window.addEventListener('online', updateNetworkBanner);
window.addEventListener('offline', updateNetworkBanner);
document.getElementById('networkRetryBtn')?.addEventListener('click', () => {
  showNetworkBanner('', false);
  handleRoute();
});
updateNetworkBanner();

tgState.enabled = telegramMiniApp.init() || isCypress;
if (tgState.enabled) {
  telegramMiniApp.onBackButton(handleMiniAppBack);
}

// Bootstrap auth state (Telegram mini app autologin first, then fallback to classic auth)
(async () => {
  await tryTelegramAutoLogin();
  checkAuth();
})();
