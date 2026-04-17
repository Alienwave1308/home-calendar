/* global URLSearchParams */
(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  const isCypress = Boolean(window.Cypress);
  const hasTelegramSession = Boolean(
    tg && (
      (typeof tg.initData === 'string' && tg.initData.length > 0)
      || (tg.initDataUnsafe && tg.initDataUnsafe.user)
    )
  );

  const urlParams = new URLSearchParams(window.location.search);
  const hasVkSession = Boolean(window.vkBridge && urlParams.get('vk_user_id'));
  const isWebBrowser = !hasTelegramSession && !hasVkSession && !isCypress;

  // Применяем мобильную верстку для веб-браузера (убираем "телефон" обёртку)
  if (isWebBrowser) {
    document.documentElement.classList.add('is-web-browser');
  }

  if (tg && hasTelegramSession) {
    tg.ready();
    tg.expand();
  }

  if (hasVkSession) {
    try {
      window.vkBridge.send('VKWebAppInit');
    } catch (error) {
      void error;
    }
  }

  // Обрабатываем возврат с VK OAuth (токен в hash)
  (function handleVkOauthReturn() {
    const hash = window.location.hash;
    if (!hash || !hash.includes('vk_token=')) return;
    const hashParams = new URLSearchParams(hash.slice(1));
    const token = hashParams.get('vk_token');
    if (!token) return;
    try {
      localStorage.setItem('token', token);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) {
      void e;
    }
  }());

  function normalizeOrigin(value) {
    if (!value) return '';
    return String(value).trim().replace(/\/+$/, '');
  }

  function isCanonicalHost(hostname) {
    return /(^|\.)rova-epil\.ru$/i.test(String(hostname || ''));
  }

  function buildApiBaseCandidates() {
    const candidates = [];
    const pushCandidate = function (base) {
      if (!base || candidates.includes(base)) return;
      candidates.push(base);
    };

    const queryOrigin = normalizeOrigin(urlParams.get('api_origin'));
    const globalOrigin = normalizeOrigin(window.__HC_API_ORIGIN__);
    const globalBase = normalizeOrigin(window.__HC_API_BASE__);

    if (globalBase) pushCandidate(globalBase);
    if (queryOrigin) pushCandidate(queryOrigin + '/api');
    if (globalOrigin) pushCandidate(globalOrigin + '/api');
    pushCandidate('/api');

    const shouldFallbackToCanonical = window.location.protocol === 'https:'
      && !isCanonicalHost(window.location.hostname)
      && window.location.hostname !== 'localhost'
      && window.location.hostname !== '127.0.0.1';
    if (!window.Cypress && shouldFallbackToCanonical) pushCandidate('https://rova-epil.ru/api');

    return candidates;
  }

  const API_BASE_CANDIDATES = buildApiBaseCandidates();
  let apiBase = API_BASE_CANDIDATES[0] || '/api';
  const rawSlug = new URLSearchParams(window.location.search).get('slug')
    || window.location.pathname.split('/book/')[1]
    || '';
  const slug = String(rawSlug).split('?')[0].replace(/^\/+|\/+$/g, '');

  const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const monthNamesGen = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  const state = {
    tab: 'services',
    flowScreen: 'services',
    method: 'all',
    category: 'all',
    currentMonth: null,
    selectedServiceIds: [],
    selectedDate: null,
    selectedSlot: null,
    selectedSlotLabel: '',
    promoCode: '',
    promoPreview: null,
    promoHint: 'Введите промокод и нажмите «Применить»',
    note: '',
    editingBookingId: null,
    master: null,
    settings: { min_booking_notice_minutes: 60 },
    services: [],
    slotsByDay: new Map(),
    rangeStart: null,
    rangeEnd: null,
    bookings: []
  };

  let screenStack = ['services'];

  const el = {
    statusTime: document.getElementById('statusTime'),
    headerBack: document.getElementById('headerBack'),
    headerMore: document.getElementById('headerMore'),
    headerTitle: document.getElementById('headerTitle'),
    headerSub: document.getElementById('headerSub'),
    screens: {
      services: document.getElementById('screen-services'),
      calendar: document.getElementById('screen-calendar'),
      confirm: document.getElementById('screen-confirm'),
      contact: document.getElementById('screen-contact'),
      done: document.getElementById('screen-done'),
      bookings: document.getElementById('screen-bookings')
    },
    studioBrand: document.getElementById('studioBrand'),
    studioSubtitle: document.getElementById('studioSubtitle'),
    masterName: document.getElementById('masterName'),
    giftText: document.getElementById('giftText'),
    giftLink: document.getElementById('giftLink'),
    methodTabs: document.getElementById('methodTabs'),
    categoryTabs: document.getElementById('categoryTabs'),
    servicesList: document.getElementById('servicesList'),
    calPrev: document.getElementById('calPrev'),
    calNext: document.getElementById('calNext'),
    calMonth: document.getElementById('calMonth'),
    calGrid: document.getElementById('calGrid'),
    slotsDate: document.getElementById('slotsDate'),
    slotsBadge: document.getElementById('slotsBadge'),
    slotsWrap: document.getElementById('slotsWrap'),
    calendarServiceTitle: document.getElementById('calendarServiceTitle'),
    calendarServiceMeta: document.getElementById('calendarServiceMeta'),
    confirmServices: document.getElementById('confirmServices'),
    confirmPricing: document.getElementById('confirmPricing'),
    promoInput: document.getElementById('promoInput'),
    promoApply: document.getElementById('promoApply'),
    promoHint: document.getElementById('promoHint'),
    noteInput: document.getElementById('noteInput'),
    confirmBack: document.getElementById('confirmBack'),
    confirmSubmit: document.getElementById('confirmSubmit'),
    contactBack: document.getElementById('contactBack'),
    contactVk: document.getElementById('contactVk'),
    contactTg: document.getElementById('contactTg'),
    doneText: document.getElementById('doneText'),
    doneNew: document.getElementById('doneNew'),
    doneBookings: document.getElementById('doneBookings'),
    bookingsCount: document.getElementById('bookingsCount'),
    bookingsList: document.getElementById('bookingsList'),
    dock: document.getElementById('dock'),
    dockTitle: document.getElementById('dockTitle'),
    dockInfo: document.getElementById('dockInfo'),
    dockSelectedList: document.getElementById('dockSelectedList'),
    dockAction: document.getElementById('dockAction'),
    tabButtons: Array.prototype.slice.call(document.querySelectorAll('.tab-btn')),
    toast: document.getElementById('toast'),
    fullLoader: document.getElementById('fullLoader')
  };

  function $(id) {
    return document.getElementById(id);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(base, days) {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function parseDateKey(value) {
    const [y, m, d] = String(value).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)));
  }

  function formatTimeIso(iso, timezone) {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(d);
  }

  function formatDateByKey(isoKey) {
    const d = parseDateKey(isoKey);
    return String(d.getDate()).padStart(2, '0') + ' ' + monthNamesGen[d.getMonth()];
  }

  function formatDateLongByKey(isoKey) {
    const d = parseDateKey(isoKey);
    const week = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    return week[d.getDay()] + ', ' + String(d.getDate()).padStart(2, '0') + ' ' + monthNamesGen[d.getMonth()];
  }

  function isoDateInTimezone(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    return y + '-' + m + '-' + d;
  }

  function inRange(date, from, to) {
    return date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
  }

  function monthIntersectsRange(monthDate, rangeStart, rangeEnd) {
    const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    return last.getTime() >= rangeStart.getTime() && first.getTime() <= rangeEnd.getTime();
  }

  function showToast(message) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      el.toast.classList.remove('show');
    }, 2600);

    const legacyText = $('networkToastText');
    if (legacyText) legacyText.textContent = message;
  }

  function showLoader() {
    if (el.fullLoader) {
      el.fullLoader.style.display = 'flex';
    }
  }

  function hideLoader() {
    if (el.fullLoader) {
      el.fullLoader.style.display = 'none';
    }
  }

  function updateStatusTime() {
    if (!el.statusTime) return;
    el.statusTime.textContent = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date());
  }

  function shouldRetryWithNextBase(status) {
    return status >= 500 || status === 404;
  }

  async function requestJson(path, options) {
    const orderedBases = [apiBase].concat(API_BASE_CANDIDATES.filter(function (base) { return base !== apiBase; }));
    let lastError = null;

    for (let i = 0; i < orderedBases.length; i++) {
      const base = orderedBases[i];
      try {
        const res = await fetch(base + path, options || {});
        if (!res.ok) {
          const data = await res.json().catch(function () { return {}; });
          const message = data.error || 'Ошибка сервера (' + res.status + ')';
          if (i < orderedBases.length - 1 && shouldRetryWithNextBase(res.status)) {
            lastError = new Error(message);
            continue;
          }
          throw new Error(message);
        }

        apiBase = base;
        return res.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error || 'Ошибка сети'));
        if (i < orderedBases.length - 1) continue;
        throw lastError;
      }
    }

    throw (lastError || new Error('Ошибка сети'));
  }

  function getOrCreateGuestId() {
    const key = 'guest_id';
    let id = localStorage.getItem(key);
    if (!id || id.length < 16) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(18)))
        .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      localStorage.setItem(key, id);
    }
    return id;
  }

  async function initAuth() {
    if (localStorage.getItem('token')) return true;

    if (hasTelegramSession) {
      const data = await requestJson('/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData })
      });
      if (data.token) {
        localStorage.setItem('token', data.token);
        return true;
      }
      throw new Error('Ошибка авторизации Telegram');
    }

    if (hasVkSession) {
      const data = await requestJson('/auth/vk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchParams: window.location.search.slice(1) })
      });
      if (data.token) {
        localStorage.setItem('token', data.token);
        return true;
      }
      throw new Error('Ошибка авторизации ВКонтакте');
    }

    if (isWebBrowser) {
      const data = await requestJson('/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_id: getOrCreateGuestId() })
      });
      if (data.token) {
        localStorage.setItem('token', data.token);
        return true;
      }
      throw new Error('Ошибка создания гостевого аккаунта');
    }

    return false;
  }

  async function apiFetch(path) {
    const token = localStorage.getItem('token') || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    return requestJson(path, { headers: headers });
  }

  async function apiPost(path, body) {
    const token = localStorage.getItem('token') || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    return requestJson(path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body || {})
    });
  }

  async function apiPatch(path, body) {
    const token = localStorage.getItem('token') || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    return requestJson(path, {
      method: 'PATCH',
      headers: headers,
      body: body ? JSON.stringify(body) : null
    });
  }

  function parseServiceTaxonomy(service) {
    const name = String(service && service.name ? service.name : '');
    const description = String(service && service.description ? service.description : '');
    const source = (name + ' ' + description).toLowerCase();
    const method = source.includes('воск') || source.includes('wax') ? 'wax' : 'sugar';
    const category = description.includes('Комплексы') || /комплекс/i.test(name) ? 'complex' : 'zone';
    return { method: method, category: category };
  }

  function filteredServices() {
    return state.services.filter(function (s) {
      const tax = parseServiceTaxonomy(s);
      const byMethod = state.method === 'all' || tax.method === state.method;
      const byCategory = state.category === 'all' || tax.category === state.category;
      return byMethod && byCategory;
    });
  }

  function selectedServices() {
    return state.services.filter(function (service) {
      return state.selectedServiceIds.some(function (selectedId) {
        return String(selectedId) === String(service.id);
      });
    });
  }

  function normalizeServiceIdsForApi(ids) {
    return ids.map(function (id) {
      const raw = String(id).trim();
      const num = Number(raw);
      if (raw !== '' && Number.isFinite(num)) return num;
      return id;
    });
  }

  function selectedTotals() {
    return selectedServices().reduce(function (acc, service) {
      acc.duration += Number(service.duration_minutes || 0);
      acc.price += Number(service.price || 0);
      return acc;
    }, { duration: 0, price: 0 });
  }

  function selectionHasComplex() {
    return selectedServices().some(function (service) {
      return parseServiceTaxonomy(service).category === 'complex';
    });
  }

  function selectionHasZone() {
    return selectedServices().some(function (service) {
      return parseServiceTaxonomy(service).category === 'zone';
    });
  }

  function renderMethodTabs() {
    const items = [
      { id: 'all', label: 'Все' },
      { id: 'sugar', label: 'Сахар' },
      { id: 'wax', label: 'Воск' }
    ];

    el.methodTabs.innerHTML = items.map(function (item) {
      return '<button data-method="' + item.id + '" class="' + (state.method === item.id ? 'active' : '') + '">' + item.label + '</button>';
    }).join('');

    Array.prototype.slice.call(el.methodTabs.querySelectorAll('button')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.method = btn.getAttribute('data-method');
        renderMethodTabs();
        renderServices();
      });
    });
  }

  function renderCategoryTabs() {
    const items = [
      { id: 'all', label: 'Все' },
      { id: 'zone', label: 'Зоны' },
      { id: 'complex', label: 'Комплексы' }
    ];

    el.categoryTabs.innerHTML = items.map(function (item) {
      return '<button data-category="' + item.id + '" class="' + (state.category === item.id ? 'active' : '') + '">' + item.label + '</button>';
    }).join('');

    Array.prototype.slice.call(el.categoryTabs.querySelectorAll('button')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.category = btn.getAttribute('data-category');
        renderCategoryTabs();
        renderServices();
      });
    });
  }

  function toggleServiceSelection(rawServiceId) {
    const service = state.services.find(function (item) {
      return String(item.id) === String(rawServiceId);
    });
    if (!service) return false;

    const serviceId = service.id;
    const alreadySelected = state.selectedServiceIds.some(function (selectedId) {
      return String(selectedId) === String(serviceId);
    });

    if (alreadySelected) {
      state.selectedServiceIds = state.selectedServiceIds.filter(function (selectedId) {
        return String(selectedId) !== String(serviceId);
      });
    } else {
      const isComplex = parseServiceTaxonomy(service).category === 'complex';
      if (isComplex) {
        state.selectedServiceIds = [serviceId];
      } else {
        if (selectionHasComplex()) return false;
        state.selectedServiceIds.push(serviceId);
      }
    }

    state.promoPreview = null;
    state.promoCode = '';
    state.promoHint = 'Введите промокод и нажмите «Применить»';
    renderServices();
    return true;
  }

  function renderServices() {
    const list = filteredServices();
    if (!list.length) {
      el.servicesList.innerHTML = '<section class="card"><p class="meta" style="margin:0;">Нет услуг по выбранным фильтрам.</p></section>';
      renderDock();
      return;
    }

    const hasComplex = selectionHasComplex();
    const hasZone = selectionHasZone();

    el.servicesList.innerHTML = list.map(function (service) {
      const selected = state.selectedServiceIds.some(function (selectedId) {
        return String(selectedId) === String(service.id);
      });
      const tax = parseServiceTaxonomy(service);
      const isComplex = tax.category === 'complex';
      const isDisabled = !selected && ((isComplex && hasZone) || (!isComplex && hasComplex));
      const methodLabel = tax.method === 'sugar' ? 'Сахар' : 'Воск';
      const categoryLabel = isComplex ? 'Комплекс' : 'Зона';
      const badges = [methodLabel, categoryLabel];

      return ''
        + '<article class="service-card ' + (selected ? 'selected ' : '') + (isDisabled ? 'disabled' : '') + '" data-service-id="' + escapeHtml(String(service.id)) + '">' 
        + '<div class="service-head">'
        + '<h3 class="service-name">' + escapeHtml(service.name) + '</h3>'
        + '<span class="price">' + money(service.price || 0) + ' ₽</span>'
        + '</div>'
        + '<p class="meta">' + categoryLabel + ' · ' + Number(service.duration_minutes || 0) + ' мин</p>'
        + (selected ? '<span class="service-selected-tag">Выбрана</span>' : '')
        + '<div class="badge-row">' + badges.map(function (b) { return '<span class="badge">' + b + '</span>'; }).join('') + '</div>'
        + '</article>';
    }).join('');

    Array.prototype.slice.call(el.servicesList.querySelectorAll('[data-service-id]')).forEach(function (card) {
      let lastActivationAt = 0;
      let pointerStart = null;

      const isPointerTap = function (event) {
        if (!pointerStart || !event) return false;
        if (pointerStart.id !== undefined && event.pointerId !== undefined && pointerStart.id !== event.pointerId) {
          return false;
        }
        const currentX = Number(event.clientX || 0);
        const currentY = Number(event.clientY || 0);
        const dx = Math.abs(currentX - pointerStart.x);
        const dy = Math.abs(currentY - pointerStart.y);
        return dx <= 10 && dy <= 10;
      };

      const activateCard = function (event) {
        if (card.classList.contains('disabled')) return;

        if (event && event.type === 'pointerup') {
          const isTouchLike = event.pointerType === 'touch' || event.pointerType === 'pen';
          if (isTouchLike && !isPointerTap(event)) {
            pointerStart = null;
            return;
          }
        }

        const now = Date.now();
        const isTouchEvent = event && (
          event.type === 'touchend'
          || (event.type === 'pointerup' && event.pointerType === 'touch')
        );
        const isSyntheticClick = event && event.type === 'click' && (now - lastActivationAt) < 700;

        if (isTouchEvent && event.cancelable) {
          event.preventDefault();
        }
        if (isSyntheticClick) {
          return;
        }
        if ((now - lastActivationAt) < 220) {
          return;
        }

        pointerStart = null;
        lastActivationAt = now;

        const serviceId = card.getAttribute('data-service-id');
        if (!serviceId) return;
        toggleServiceSelection(serviceId);
      };

      if (window.PointerEvent) {
        card.addEventListener('pointerdown', function (event) {
          pointerStart = {
            id: event.pointerId,
            x: Number(event.clientX || 0),
            y: Number(event.clientY || 0)
          };
        });
        card.addEventListener('pointercancel', function () {
          pointerStart = null;
        });
        card.addEventListener('pointerup', activateCard);
      } else {
        card.addEventListener('click', activateCard);
        card.addEventListener('touchend', activateCard, { passive: false });
      }
    });

    renderDock();
  }

  function renderHeader() {
    let title = 'Запись';
    let sub = 'RoVa Epil';
    let canBack = false;

    if (state.tab === 'services') {
      if (state.flowScreen === 'services') {
        title = 'Выбор услуги';
        sub = 'Шаг 1 из 3';
      } else if (state.flowScreen === 'calendar') {
        title = 'Календарь';
        sub = 'Шаг 2 из 3';
        canBack = true;
      } else if (state.flowScreen === 'confirm') {
        title = 'Подтверждение';
        sub = 'Шаг 3 из 3';
        canBack = true;
      } else if (state.flowScreen === 'done') {
        title = 'Готово';
        sub = 'Запись создана';
        canBack = true;
      }
    } else if (state.tab === 'bookings') {
      title = 'Мои записи';
      sub = 'Управление визитами';
    }

    el.headerTitle.textContent = title;
    el.headerSub.textContent = sub;
    el.headerBack.disabled = !canBack;
  }

  function renderTabs() {
    el.tabButtons.forEach(function (btn) {
      const tab = btn.getAttribute('data-tab');
      btn.classList.toggle('active', tab === state.tab);
    });
  }

  function renderScreens() {
    Object.keys(el.screens).forEach(function (key) {
      el.screens[key].classList.remove('active');
    });

    if (state.tab === 'services') {
      el.screens[state.flowScreen].classList.add('active');
    } else {
      el.screens[state.tab].classList.add('active');
    }
  }

  function renderDock() {
    const selected = selectedServices();
    const visible = state.tab === 'services'
      && (
        state.flowScreen === 'calendar'
        || (state.flowScreen === 'services' && selected.length > 0)
      );
    el.dock.classList.toggle('visible', visible);
    if (!visible) {
      el.dockSelectedList.classList.remove('visible');
      el.dockSelectedList.innerHTML = '';
      return;
    }

    if (state.flowScreen === 'services') {
      const totals = selectedTotals();
      const count = selected.length;
      const label = count + ' ' + (count === 1 ? 'услуга' : (count < 5 ? 'услуги' : 'услуг'));
      el.dockTitle.textContent = label;
      el.dockInfo.textContent = totals.duration + ' мин · ' + money(totals.price) + ' ₽';
      el.dockSelectedList.innerHTML = selected.map(function (service) {
        return '<li>' + escapeHtml(service.name) + '</li>';
      }).join('');
      el.dockSelectedList.classList.add('visible');
      el.dockAction.textContent = 'Выбрать дату →';
    } else {
      const selectedDay = state.selectedDate ? formatDateByKey(state.selectedDate) : 'Дата не выбрана';
      const slotText = state.selectedSlot ? state.selectedSlot.label + ' · ' : '';
      el.dockTitle.textContent = selectedDay;
      el.dockInfo.textContent = slotText + (state.selectedSlot ? 'К подтверждению' : 'Выберите слот');
      el.dockSelectedList.classList.remove('visible');
      el.dockSelectedList.innerHTML = '';
      el.dockAction.textContent = 'К подтверждению →';
    }
  }

  function openTab(tab) {
    state.tab = tab;
    if (tab === 'services') {
      state.flowScreen = screenStack[screenStack.length - 1] || 'services';
    }
    renderTabs();
    renderHeader();
    renderScreens();
    renderDock();

    if (tab === 'bookings') {
      loadBookings();
    }
  }

  function setFlow(screen) {
    state.tab = 'services';
    if (screen === 'services') {
      screenStack = ['services'];
    } else {
      const idx = screenStack.indexOf(screen);
      if (idx !== -1) {
        screenStack = screenStack.slice(0, idx + 1);
      } else {
        screenStack.push(screen);
      }
    }
    state.flowScreen = screen;

    if (screen === 'calendar') {
      renderCalendarInfo();
      renderCalendar();
      renderSlots();
    }
    if (screen === 'confirm') {
      renderConfirm();
    }

    renderTabs();
    renderHeader();
    renderScreens();
    renderDock();
  }

  function goBack() {
    if (state.tab !== 'services') {
      openTab('services');
      return;
    }

    if (screenStack.length > 1) {
      screenStack.pop();
      state.flowScreen = screenStack[screenStack.length - 1];
      renderHeader();
      renderScreens();
      renderDock();
    }
  }

  function renderCalendarInfo() {
    const totals = selectedTotals();
    const names = selectedServices().map(function (s) { return s.name; }).join(', ');
    el.calendarServiceTitle.textContent = names || 'Услуги не выбраны';
    el.calendarServiceMeta.textContent = totals.duration + ' мин · ' + money(totals.price) + ' ₽';
  }

  async function loadSlotsRange() {
    const chosen = selectedServices();
    state.slotsByDay = new Map();
    if (!chosen.length || !state.master) return;

    const timezone = state.master.timezone || 'Asia/Novosibirsk';
    const primaryRawId = chosen[0].id;
    const primaryId = Number(primaryRawId);
    const serviceIdParam = Number.isFinite(primaryId) ? String(primaryId) : encodeURIComponent(String(primaryRawId));
    const totals = selectedTotals();
    const from = dateKey(state.rangeStart);
    const to = dateKey(state.rangeEnd);

    let url = '/public/master/' + slug + '/slots?service_id=' + serviceIdParam + '&date_from=' + from + '&date_to=' + to;
    if (chosen.length > 1 && totals.duration > 0) {
      url += '&duration_minutes=' + totals.duration;
    }

    const data = await apiFetch(url);
    const rows = Array.isArray(data.slots) ? data.slots : (Array.isArray(data) ? data : []);

    rows.forEach(function (slot) {
      const startIso = String(slot.start || '');
      const endIso = String(slot.end || '');
      if (!startIso || !endIso) return;
      const day = isoDateInTimezone(new Date(startIso), timezone);
      const hotWindow = slot && typeof slot.hot_window === 'object' ? slot.hot_window : null;
      if (!state.slotsByDay.has(day)) state.slotsByDay.set(day, []);
      state.slotsByDay.get(day).push({
        start: startIso,
        end: endIso,
        label: formatTimeIso(startIso, timezone),
        hotWindow: hotWindow
      });
    });

    state.slotsByDay.forEach(function (list, day) {
      list.sort(function (a, b) {
        if (a.start < b.start) return -1;
        if (a.start > b.start) return 1;
        return 0;
      });
      state.slotsByDay.set(day, list);
    });

    if (state.selectedDate && !state.slotsByDay.get(state.selectedDate)) {
      state.selectedSlot = null;
      state.selectedSlotLabel = '';
    }
  }

  function renderCalendar() {
    if (!state.currentMonth) state.currentMonth = startOfMonth(state.rangeStart);

    const monthStart = startOfMonth(state.currentMonth);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const leading = (monthStart.getDay() + 6) % 7;

    el.calMonth.textContent = monthNames[monthStart.getMonth()] + ' ' + monthStart.getFullYear();

    const prevMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);
    const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    el.calPrev.disabled = !monthIntersectsRange(prevMonth, state.rangeStart, state.rangeEnd);
    el.calNext.disabled = !monthIntersectsRange(nextMonth, state.rangeStart, state.rangeEnd);

    let html = '';
    for (let i = 0; i < leading; i += 1) {
      html += '<div class="day-empty"></div>';
    }

    for (let day = 1; day <= monthEnd.getDate(); day += 1) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
      const key = dateKey(date);
      const daySlots = state.slotsByDay.get(key) || [];
      const enabled = inRange(date, state.rangeStart, state.rangeEnd);
      const available = enabled && daySlots.length > 0;
      const hot = available && daySlots.some(function (slot) {
        return Boolean(slot.hotWindow);
      });
      const selected = state.selectedDate === key;
      const classes = ['day'];
      if (available) classes.push('available');
      if (hot) classes.push('hot');
      if (!enabled) classes.push('disabled');
      if (selected) classes.push('selected');

      html += '<button type="button" class="' + classes.join(' ') + '" data-day="' + key + '"' + (enabled ? '' : ' disabled') + '>' + day + '</button>';
    }

    el.calGrid.innerHTML = html;

    Array.prototype.slice.call(el.calGrid.querySelectorAll('[data-day]')).forEach(function (node) {
      node.addEventListener('click', function () {
        const key = node.getAttribute('data-day');
        state.selectedDate = key;
        state.selectedSlot = null;
        state.selectedSlotLabel = '';
        renderCalendar();
        renderSlots();
        renderDock();
      });
    });
  }

  function renderSlots() {
    if (!state.selectedDate) {
      el.slotsDate.textContent = 'Выберите дату';
      el.slotsBadge.textContent = '0 слотов';
      el.slotsWrap.innerHTML = '<p class="slots-empty">Сначала выберите день в календаре.</p>';
      return;
    }

    const slots = state.slotsByDay.get(state.selectedDate) || [];
    el.slotsDate.textContent = 'Слоты на ' + formatDateByKey(state.selectedDate);
    el.slotsBadge.textContent = slots.length + ' слотов';

    if (!slots.length) {
      el.slotsWrap.innerHTML = '<p class="slots-empty">На эту дату свободных слотов нет. Выберите другой день.</p>';
      return;
    }

    el.slotsWrap.innerHTML = slots.map(function (slot) {
      const active = state.selectedSlot && state.selectedSlot.start === slot.start;
      const hot = Boolean(slot.hotWindow);
      const classes = ['slot-chip'];
      if (hot) classes.push('hot');
      if (active) classes.push('active');
      return ''
        + '<button type="button" class="' + classes.join(' ') + '" data-slot-start="' + slot.start + '">'
        + (hot ? '<span class="slot-hot-emoji" aria-hidden="true">🔥</span>' : '')
        + slot.label
        + '</button>';
    }).join('');

    Array.prototype.slice.call(el.slotsWrap.querySelectorAll('[data-slot-start]')).forEach(function (node) {
      node.addEventListener('click', function () {
        const start = node.getAttribute('data-slot-start');
        const found = slots.find(function (s) { return s.start === start; });
        if (!found) return;
        state.selectedSlot = found;
        state.selectedSlotLabel = found.label;
        renderSlots();
        renderDock();
      });
    });
  }

  function currentPricing() {
    const totals = selectedTotals();
    const base = Number(totals.price || 0);

    if (!state.promoPreview || !state.promoCode) {
      return {
        base: base,
        final: base,
        discount: 0,
        promoCode: null,
        rewardType: null,
        discountPercent: null,
        giftServiceName: null,
        giftAdded: false
      };
    }

    return {
      base: Number(state.promoPreview.base_price ?? base),
      final: Number(state.promoPreview.final_price ?? base),
      discount: Number(state.promoPreview.discount_amount || 0),
      promoCode: state.promoPreview.promo_code || state.promoCode,
      rewardType: state.promoPreview.promo_reward_type || null,
      discountPercent: Number(state.promoPreview.promo_discount_percent || 0) || null,
      giftServiceName: state.promoPreview.promo_gift_service_name || null,
      giftAdded: Boolean(state.promoPreview.promo_gift_service_added)
    };
  }

  function renderConfirm() {
    const services = selectedServices();
    if (!services.length) {
      el.confirmServices.innerHTML = '<p class="meta" style="margin:0;">Услуги не выбраны.</p>';
      el.confirmPricing.innerHTML = '';
      return;
    }

    const pricing = currentPricing();
    const dateText = state.selectedDate ? formatDateLongByKey(state.selectedDate) : '—';
    const timeText = state.selectedSlot ? state.selectedSlot.label : '—';

    let serviceLines = services.map(function (service) {
      return '<div class="row-line"><span>' + escapeHtml(service.name) + '</span><span>' + money(service.price || 0) + ' ₽</span></div>';
    }).join('');

    if (pricing.rewardType === 'gift_service' && pricing.giftServiceName && pricing.giftAdded) {
      serviceLines += '<div class="row-line"><span>' + escapeHtml(pricing.giftServiceName) + '</span><span>подарок</span></div>';
    }

    el.confirmServices.innerHTML = ''
      + '<div class="row-line"><strong>Дата</strong><span>' + dateText + '</span></div>'
      + '<div class="row-line"><strong>Время</strong><span>' + timeText + '</span></div>'
      + '<div class="row-line"><strong>Услуги</strong><span>' + services.length + '</span></div>'
      + serviceLines;

    const promoLine = pricing.promoCode
      ? '<div class="row-line"><span>Промокод (' + escapeHtml(pricing.promoCode) + ')</span><span>−' + money(pricing.discount) + ' ₽</span></div>'
      : '';

    el.confirmPricing.innerHTML = ''
      + '<div class="row-line"><span>Стоимость</span><span>' + money(pricing.base) + ' ₽</span></div>'
      + promoLine
      + '<div class="row-line total"><span>Итого</span><span>' + money(pricing.final) + ' ₽</span></div>';

    el.promoInput.value = state.promoCode;
    el.promoHint.textContent = state.promoHint;
    el.noteInput.value = state.note;
  }

  async function applyPromo() {
    const code = String(el.promoInput.value || '').trim().toUpperCase();
    state.promoCode = code;

    if (!code) {
      state.promoPreview = null;
      state.promoHint = 'Промокод очищен';
      renderConfirm();
      showToast('Промокод убран');
      return;
    }

    if (!state.selectedServiceIds.length) {
      showToast('Сначала выберите услугу');
      return;
    }

    try {
      const preview = await apiPost('/public/master/' + slug + '/pricing-preview', {
        service_ids: normalizeServiceIdsForApi(state.selectedServiceIds.slice()),
        promo_code: code
      });

      state.promoPreview = preview.pricing || null;
      if (state.promoPreview && state.promoPreview.promo_reward_type === 'percent') {
        state.promoHint = 'Применено: скидка ' + Number(state.promoPreview.promo_discount_percent || 0) + '%';
      } else if (state.promoPreview && state.promoPreview.promo_reward_type === 'gift_service') {
        state.promoHint = 'Применено: зона в подарок';
      } else {
        state.promoHint = 'Промокод применен';
      }

      renderConfirm();
      showToast('Промокод применён');
    } catch (error) {
      state.promoPreview = null;
      state.promoHint = 'Промокод неактивен';
      renderConfirm();
      showToast(error.message || 'Промокод неактивен');
    }
  }

  async function submitBooking() {
    if (!state.selectedServiceIds.length || !state.selectedSlot) {
      showToast('Проверьте выбор услуги, даты и времени');
      return;
    }

    const note = String(el.noteInput.value || '').trim();
    state.note = note;

    if (state.editingBookingId) {
      try {
        showLoader();
        await apiPatch('/client/bookings/' + state.editingBookingId + '/reschedule', {
          new_start_at: state.selectedSlot.start
        });
        hideLoader();
        state.editingBookingId = null;
        state.promoPreview = null;
        state.promoCode = '';
        showToast('Запись перенесена');
        await loadBookings();
        openTab('bookings');
      } catch (error) {
        hideLoader();
        showToast(error.message);
      }
      return;
    }

    try {
      showLoader();
      const body = {
        service_ids: normalizeServiceIdsForApi(state.selectedServiceIds.slice()),
        start_at: state.selectedSlot.start,
        client_note: note || undefined
      };
      if (state.promoCode) {
        body.promo_code = state.promoCode;
      }

      const created = await apiPost('/public/master/' + slug + '/book', body);
      hideLoader();

      const pricing = created.pricing || {};
      const details = [];
      details.push('Дата: ' + formatDateLongByKey(state.selectedDate) + ', ' + state.selectedSlot.label);
      details.push('Стоимость: ' + money(pricing.final_price !== undefined ? pricing.final_price : selectedTotals().price) + ' ₽');
      if (pricing.promo_code) {
        let promoLine = 'Промокод: ' + pricing.promo_code;
        if (pricing.promo_reward_type === 'percent' && pricing.promo_discount_percent) {
          promoLine += ' (скидка ' + pricing.promo_discount_percent + '%)';
        }
        if (pricing.promo_reward_type === 'gift_service' && pricing.promo_gift_service_name) {
          promoLine += ' (подарок: ' + pricing.promo_gift_service_name + ')';
        }
        details.push(promoLine);
      }

      el.doneText.textContent = details.join(' · ');
      setFlow('done');

      if (tg && typeof tg.showAlert === 'function') {
        tg.showAlert('Вы успешно записаны!');
      }
    } catch (error) {
      hideLoader();
      showToast(error.message);
    }
  }

  async function loadBookings() {
    el.bookingsList.innerHTML = '<section class="card"><p class="meta" style="margin:0;">Загрузка...</p></section>';

    try {
      if (!localStorage.getItem('token')) {
        await initAuth();
      }

      const rows = await apiFetch('/client/bookings');
      state.bookings = Array.isArray(rows) ? rows : [];

      if (!state.bookings.length) {
        el.bookingsCount.textContent = '0';
        el.bookingsList.innerHTML = '<section class="card"><p class="meta" style="margin:0;">Записей пока нет.</p></section>';
        return;
      }

      const ordered = state.bookings.slice().sort(function (a, b) {
        return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
      });

      el.bookingsCount.textContent = ordered.length + ' шт';
      el.bookingsList.innerHTML = ordered.map(function (booking) {
        const status = String(booking.status || 'pending');
        const canceled = status === 'canceled';
        const tz = booking.master_timezone || (state.master && state.master.timezone) || 'Asia/Novosibirsk';
        const start = new Date(booking.start_at);
        const dateStr = formatDateByKey(isoDateInTimezone(start, tz));
        const timeStr = formatTimeIso(booking.start_at, tz);
        const endStr = booking.end_at ? formatTimeIso(booking.end_at, tz) : '';

        const statusLabel = {
          pending: 'Ожидает',
          confirmed: 'Запланирована',
          completed: 'Выполнена',
          canceled: 'Отменена'
        }[status] || status;

        let promo = '';
        if (booking.promo_code) {
          promo = '<br>Промокод: ' + escapeHtml(booking.promo_code);
        }

        const note = booking.client_note ? ('<br>Комментарий: ' + escapeHtml(booking.client_note)) : '';

        return ''
          + '<article class="booking-item ' + (canceled ? 'cancelled' : '') + '" data-booking-id="' + booking.id + '">'
          + '<div class="booking-head">'
          + '<h4 class="booking-title">' + escapeHtml(booking.service_name || 'Услуга') + '</h4>'
          + '<span class="booking-status ' + (canceled ? 'cancelled' : '') + '">' + statusLabel + '</span>'
          + '</div>'
          + '<p class="booking-meta">' + dateStr + ' · ' + timeStr + (endStr ? ' — ' + endStr : '') + ' · ' + money(booking.final_price || booking.service_price || 0) + ' ₽' + promo + note + '</p>'
          + (canceled || status === 'completed'
            ? ''
            : '<div class="booking-actions">'
              + '<button class="btn" data-action="reschedule">Перенести</button>'
              + '<button class="btn danger" data-action="cancel">Отменить</button>'
              + '</div>')
          + '</article>';
      }).join('');

      Array.prototype.slice.call(el.bookingsList.querySelectorAll('[data-action]')).forEach(function (btn) {
        btn.addEventListener('click', function () {
          const card = btn.closest('[data-booking-id]');
          const bookingId = Number(card.getAttribute('data-booking-id'));
          const action = btn.getAttribute('data-action');
          if (action === 'cancel') cancelBooking(bookingId);
          if (action === 'reschedule') rescheduleBooking(bookingId);
        });
      });
    } catch (error) {
      el.bookingsList.innerHTML = '<section class="card"><p class="meta" style="margin:0;">Не удалось загрузить записи.</p></section>';
      showToast(error.message);
    }
  }

  async function cancelBooking(id) {
    try {
      await apiPatch('/client/bookings/' + id + '/cancel');
      showToast('Запись отменена');
      await loadBookings();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function rescheduleBooking(id) {
    const booking = state.bookings.find(function (item) { return Number(item.id) === Number(id); });
    if (!booking) return;

    const ids = (Array.isArray(booking.extra_service_ids) && booking.extra_service_ids.length)
      ? [Number(booking.service_id)].concat(booking.extra_service_ids.map(Number))
      : [Number(booking.service_id)];

    state.selectedServiceIds = ids.filter(function (x) { return Number.isFinite(x) && x > 0; });
    state.editingBookingId = Number(id);
    state.promoCode = '';
    state.promoPreview = null;
    state.note = booking.client_note || '';

    const start = new Date(booking.start_at);
    state.selectedDate = isoDateInTimezone(start, (state.master && state.master.timezone) || 'Asia/Novosibirsk');
    state.currentMonth = startOfMonth(parseDateKey(state.selectedDate));
    state.selectedSlot = null;
    state.selectedSlotLabel = '';

    renderServices();
    renderCalendarInfo();

    try {
      showLoader();
      await loadSlotsRange();
      hideLoader();
      setFlow('calendar');
      renderCalendar();
      renderSlots();
      showToast('Выберите новую дату и время');
    } catch (error) {
      hideLoader();
      showToast(error.message);
    }
  }

  async function submitBookingWeb(channel) {
    if (!state.selectedServiceIds.length || !state.selectedSlot) {
      showToast('Проверьте выбор услуги, даты и времени');
      return;
    }

    if (!await initAuth()) return;

    try {
      showLoader();
      const note = String(el.noteInput ? el.noteInput.value || '' : '').trim();
      const body = {
        service_ids: normalizeServiceIdsForApi(state.selectedServiceIds.slice()),
        start_at: state.selectedSlot.start,
        client_note: note || undefined,
        web_contact_channel: channel
      };
      if (state.promoCode) body.promo_code = state.promoCode;

      const created = await apiPost('/public/master/' + slug + '/book', body);
      hideLoader();

      const token = created.web_confirm_token;
      const tgBotUsername = 'Rova_Epil_Bot';

      if (channel === 'tg' && token) {
        // Открываем Telegram бота с deep link
        const deepLink = 'https://t.me/' + tgBotUsername + '?start=booking_' + token;
        // Показываем экран done с инструкцией
        if (el.doneText) {
          el.doneText.textContent = 'Откройте Telegram-бота и подтвердите запись 👆';
        }
        setFlow('done');
        // Открываем Telegram в новой вкладке
        setTimeout(function () { window.open(deepLink, '_blank'); }, 300);
      } else {
        // VK — запись создана, пользователь уже авторизован через OAuth
        // Бот напишет ему когда он напишет сообществу
        if (el.doneText) {
          el.doneText.textContent = 'Запись оформлена! Напишите любое сообщение боту ВКонтакте для подтверждения.';
        }
        setFlow('done');
      }
    } catch (error) {
      hideLoader();
      showToast(error.message);
    }
  }

  function resetFlow() {
    state.flowScreen = 'services';
    screenStack = ['services'];
    state.selectedDate = dateKey(state.rangeStart);
    state.currentMonth = startOfMonth(state.rangeStart);
    state.selectedSlot = null;
    state.selectedSlotLabel = '';
    state.promoCode = '';
    state.promoPreview = null;
    state.promoHint = 'Введите промокод и нажмите «Применить»';
    state.note = '';
    state.editingBookingId = null;
    openTab('services');
    renderCalendar();
    renderSlots();
    renderConfirm();
    renderDock();
  }

  async function enterCalendar() {
    if (!state.selectedServiceIds.length) {
      showToast('Выберите хотя бы одну услугу');
      return;
    }

    try {
      showLoader();
      await loadSlotsRange();
      hideLoader();

      if (!state.selectedDate) {
        state.selectedDate = dateKey(state.rangeStart);
      }

      setFlow('calendar');
      renderCalendar();
      renderSlots();
    } catch (error) {
      hideLoader();
      showToast('Ошибка загрузки слотов: ' + error.message);
    }
  }

  function bind() {
    updateStatusTime();
    setInterval(updateStatusTime, 60000);

    el.headerBack.addEventListener('click', goBack);
    el.headerMore.addEventListener('click', function () {
      showToast('Меню пока не подключено');
    });

    el.calPrev.addEventListener('click', function () {
      if (el.calPrev.disabled) return;
      state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
      renderCalendar();
    });

    el.calNext.addEventListener('click', function () {
      if (el.calNext.disabled) return;
      state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
      renderCalendar();
    });

    el.promoApply.addEventListener('click', applyPromo);
    el.confirmBack.addEventListener('click', function () { setFlow('calendar'); });
    el.confirmSubmit.addEventListener('click', function () {
      // Для веб-браузера показываем экран выбора мессенджера перед созданием записи
      if (isWebBrowser) {
        setFlow('contact');
      } else {
        submitBooking();
      }
    });

    if (el.contactBack) {
      el.contactBack.addEventListener('click', function () { setFlow('confirm'); });
    }
    if (el.contactVk) {
      el.contactVk.addEventListener('click', function () {
        // Сохраняем состояние записи перед редиректом на VK OAuth
        try {
          sessionStorage.setItem('vk_pending_booking', JSON.stringify({
            serviceIds: state.selectedServiceIds.slice(),
            slotStart: state.selectedSlot ? state.selectedSlot.start : null,
            slotEnd: state.selectedSlot ? state.selectedSlot.end : null,
            slotLabel: state.selectedSlotLabel || '',
            note: el.noteInput ? String(el.noteInput.value || '') : '',
            promoCode: state.promoCode || ''
          }));
        } catch (e) { void e; }
        const currentSlug = slug || 'lera';
        window.location.href = '/api/auth/vk/oauth?slug=' + currentSlug;
      });
    }
    if (el.contactTg) {
      el.contactTg.addEventListener('click', function () {
        submitBookingWeb('tg');
      });
    }
    el.doneNew.addEventListener('click', resetFlow);
    el.doneBookings.addEventListener('click', function () { openTab('bookings'); });

    el.promoInput.addEventListener('input', function () {
      state.promoCode = String(el.promoInput.value || '').trim().toUpperCase();
      if (!state.promoCode) {
        state.promoPreview = null;
        state.promoHint = 'Введите промокод и нажмите «Применить»';
        renderConfirm();
      }
    });

    el.noteInput.addEventListener('input', function () {
      state.note = String(el.noteInput.value || '').trim();
    });

    el.dockAction.addEventListener('click', function () {
      if (state.flowScreen === 'services') {
        enterCalendar();
      } else if (state.flowScreen === 'calendar') {
        if (!state.selectedDate || !state.selectedSlot) {
          showToast('Выберите дату и время');
          return;
        }
        setFlow('confirm');
      }
    });

    el.tabButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        openTab(btn.getAttribute('data-tab'));
      });
    });
  }

  async function loadMaster() {
    if (!slug) {
      showToast('Некорректная ссылка для записи');
      return;
    }

    el.servicesList.innerHTML = '<section class="card"><p class="meta" style="margin:0;">Загрузка...</p></section>';

    try {
      const data = await apiFetch('/public/master/' + slug);
      state.master = data.master || {};
      state.settings = data.settings || state.settings;
      state.services = (Array.isArray(data.services) ? data.services : []).map(function (service, index) {
        const safe = service && typeof service === 'object' ? service : {};
        const candidateId = safe.id ?? safe.service_id ?? safe.serviceId;
        const normalizedId = candidateId !== undefined && candidateId !== null && String(candidateId).trim() !== ''
          ? candidateId
          : ('legacy-' + index);
        return {
          ...safe,
          id: normalizedId
        };
      });

      const profile = data.master && data.master.profile ? data.master.profile : {};
      const brandName = profile.brand || 'Ro Va';
      const subtitle = profile.subtitle || 'Epil & Care';
      const displayName = profile.name || state.master.display_name || 'Лера';
      const giftText = profile.gift_text || 'Подарок от меня на первое посещение по ссылке:';
      const giftUrl = profile.gift_url || 'https://vk.cc/cVmuLI';

      el.studioBrand.textContent = brandName;
      el.studioSubtitle.textContent = subtitle;
      el.masterName.textContent = displayName;
      if (el.giftText) el.giftText.textContent = giftText;
      el.giftLink.textContent = giftUrl.replace(/^https?:\/\//, '');
      el.giftLink.href = giftUrl;

      const today = startOfDay(new Date());
      state.rangeStart = today;
      state.rangeEnd = addDays(today, 30);
      state.currentMonth = startOfMonth(today);
      state.selectedDate = dateKey(today);

      renderMethodTabs();
      renderCategoryTabs();
      renderServices();
      renderCalendarInfo();
      renderCalendar();
      renderSlots();
      renderConfirm();
      renderHeader();
      renderTabs();
      renderScreens();
      renderDock();

      // После загрузки мастера проверяем, вернулись ли мы с VK OAuth с сохранённой записью
      tryRestoreVkPendingBooking();
    } catch (error) {
      showToast('Не удалось загрузить данные: ' + error.message);
      el.servicesList.innerHTML = '<section class="card"><p class="meta" style="margin:0;">Не удалось загрузить услуги.</p></section>';
    }
  }

  async function tryRestoreVkPendingBooking() {
    if (!localStorage.getItem('token')) return;
    let saved;
    try {
      const raw = sessionStorage.getItem('vk_pending_booking');
      if (!raw) return;
      saved = JSON.parse(raw);
      sessionStorage.removeItem('vk_pending_booking');
    } catch (e) { return; }

    if (!saved || !saved.serviceIds || !saved.slotStart) return;

    state.selectedServiceIds = saved.serviceIds;
    if (saved.slotStart) {
      state.selectedSlot = { start: saved.slotStart, end: saved.slotEnd, label: saved.slotLabel };
      state.selectedSlotLabel = saved.slotLabel || '';
    }
    if (el.noteInput && saved.note) el.noteInput.value = saved.note;
    state.promoCode = saved.promoCode || '';

    renderServices();
    renderDock();
    await submitBookingWeb('vk');
  }

  bind();

  if (slug) {
    initAuth()
      .then(function () { return loadMaster(); })
      .catch(function (error) {
        showToast('Ошибка авторизации: ' + error.message);
        loadMaster();
      });
  } else {
    showToast('Некорректная ссылка для записи');
  }

  window.BookingApp = {
    openTab: openTab,
    setFlow: setFlow,
    applyPromo: applyPromo,
    submitBooking: submitBooking,
    loadBookings: loadBookings,
    resetFlow: resetFlow,
    goBack: goBack
  };
})();
