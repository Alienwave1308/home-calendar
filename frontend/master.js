/* eslint-disable no-unused-vars */
/* global navigator */
/**
 * Master Panel — manage bookings, services, and settings.
 */

(function () {
  'use strict';

  function hasTelegramMiniAppSession() {
    if (window.Cypress) return true;
    const webApp = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    if (!webApp) return false;
    if (typeof webApp.initData === 'string' && webApp.initData.length > 0) return true;
    return Boolean(webApp.initDataUnsafe && webApp.initDataUnsafe.user);
  }

  function renderTelegramOnlyError() {
    document.body.innerHTML = '<main style="max-width:480px;margin:64px auto;padding:24px;text-align:center;font-family:system-ui,-apple-system,sans-serif;">'
      + '<h1 style="margin-bottom:12px;">Доступ только через Telegram</h1>'
      + '<p style="margin:0;color:#5b6575;">Откройте панель мастера внутри Telegram Mini App.</p>'
      + '</main>';
  }

  if (!hasTelegramMiniAppSession()) {
    renderTelegramOnlyError();
    return;
  }

  function normalizeOrigin(value) {
    if (!value) return '';
    return String(value).trim().replace(/\/+$/, '');
  }

  function isCanonicalHost(hostname) {
    return /(^|\.)rova-epil\.ru$/i.test(String(hostname || ''));
  }

  function buildRootApiCandidates() {
    const candidates = [];
    const pushCandidate = function (base) {
      if (!base || candidates.includes(base)) return;
      candidates.push(base);
    };

    const params = new window.URLSearchParams(window.location.search);
    const queryOrigin = normalizeOrigin(params.get('api_origin'));
    const globalOrigin = normalizeOrigin(window.__HC_API_ORIGIN__);
    const globalBase = normalizeOrigin(window.__HC_ROOT_API_BASE__);

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

  const ROOT_API_CANDIDATES = buildRootApiCandidates();
  const MASTER_API_CANDIDATES = ROOT_API_CANDIDATES.map(function (base) { return base + '/master'; });
  let ROOT_API_BASE = ROOT_API_CANDIDATES[0] || '/api';
  let API_BASE = MASTER_API_CANDIDATES[0] || '/api/master';
  const PUBLIC_APP_ORIGIN = isCanonicalHost(window.location.hostname)
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
    ? window.location.origin
    : 'https://rova-epil.ru';
  let token = localStorage.getItem('token') || '';
  let bookingsCache = [];
  let currentMasterSlug = '';
  let servicesCache = [];
  let filteredServices = [];
  let serviceMethodFilter = 'all';
  let serviceCategoryFilter = 'all';
  let editingServiceId = null;
  let leadsPeriod = 'day';
  let leadsHelpVisible = false;
  let leadsView = 'summary';
  let leadsUsersRaw = [];
  let promoCodesCache = [];
  let overviewPreset = 'day';
  let overviewFrom = '';
  let overviewTo = '';
  let masterProfileCache = null;
  let leadsMetricsRequestSeq = 0;
  let leadsUsersRequestSeq = 0;

  const DEFAULT_MASTER_PROFILE = Object.freeze({
    brand: 'Ro Va',
    subtitle: 'Epil & Care',
    name: 'Лера',
    role: 'Мастер эпиляции',
    city: 'Новосибирск',
    experience: '',
    phone: '',
    address: '',
    bio: '',
    gift_text: 'Подарок от меня на первое посещение по ссылке:',
    gift_url: 'https://vk.cc/cVmuLI'
  });

  function $(id) { return document.getElementById(id); }

  function clearAuthAndRedirect() {
    localStorage.removeItem('token');
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentRole');
    window.location.href = '/';
  }

  function shouldRetryWithNextBase(status) {
    return status >= 500 || status === 404;
  }

  async function requestJson(path, options) {
    const orderedBases = [API_BASE].concat(MASTER_API_CANDIDATES.filter(function (base) { return base !== API_BASE; }));
    let lastError = null;

    for (let i = 0; i < orderedBases.length; i++) {
      const base = orderedBases[i];
      try {
        const res = await fetch(base + path, options || {});
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            if (i < orderedBases.length - 1) continue;
            clearAuthAndRedirect();
            return null;
          }
          const data = await res.json().catch(function () { return {}; });
          const rawMessage = data.error || 'Ошибка (' + res.status + ')';
          const message = localizeApiErrorMessage(rawMessage);
          if (i < orderedBases.length - 1 && shouldRetryWithNextBase(res.status)) {
            lastError = new Error(message);
            continue;
          }
          throw new Error(message);
        }

        API_BASE = base;
        const rootBase = String(base).replace(/\/master$/, '');
        if (ROOT_API_CANDIDATES.includes(rootBase)) ROOT_API_BASE = rootBase;
        return res.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error || 'Ошибка сети'));
        if (i < orderedBases.length - 1) continue;
        throw lastError;
      }
    }

    throw (lastError || new Error('Ошибка сети'));
  }

  async function requestRootJson(path, options) {
    const orderedBases = [ROOT_API_BASE].concat(ROOT_API_CANDIDATES.filter(function (base) { return base !== ROOT_API_BASE; }));
    let lastError = null;

    for (let i = 0; i < orderedBases.length; i++) {
      const base = orderedBases[i];
      try {
        const res = await fetch(base + path, options || {});
        if (!res.ok) {
          const data = await res.json().catch(function () { return {}; });
          const rawMessage = data.error || 'Ошибка (' + res.status + ')';
          const message = localizeApiErrorMessage(rawMessage);
          if (i < orderedBases.length - 1 && shouldRetryWithNextBase(res.status)) {
            lastError = new Error(message);
            continue;
          }
          throw new Error(message);
        }

        ROOT_API_BASE = base;
        return res.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error || 'Ошибка сети'));
        if (i < orderedBases.length - 1) continue;
        throw lastError;
      }
    }

    throw (lastError || new Error('Ошибка сети'));
  }

  async function apiFetch(path) {
    let headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return requestJson(path, { headers: headers });
  }

  async function apiMethod(method, path, body) {
    let headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let opts = { method: method, headers: headers };
    if (body) opts.body = JSON.stringify(body);

    return requestJson(path, opts);
  }

  function showToast(msg) {
    $('networkToastText').textContent = msg;
    $('networkToast').style.display = 'flex';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { $('networkToast').style.display = 'none'; }, 4000);
  }

  function hideToast() {
    $('networkToast').style.display = 'none';
  }

  async function testNotification() {
    const btn = $('btnTestNotification');
    const result = $('testNotificationResult');
    btn.disabled = true;
    result.textContent = 'Отправляем...';
    try {
      const data = await apiMethod('POST', '/test-notification');
      if (data.ok) {
        result.textContent = '✅ Сообщение отправлено! Проверь Telegram.';
      } else if (data.reason === 'username_format') {
        result.textContent = '❌ Username не в формате tg_XXXXX: ' + (data.username || 'не задан');
      } else if (data.skipped) {
        result.textContent = '❌ Пропущено: нет токена бота или chatId';
      } else if (data.tgError) {
        result.textContent = '❌ Telegram HTTP ' + (data.status || '?') + ': ' + data.tgError;
      } else {
        result.textContent = '❌ Ошибка: ' + (data.error || 'неизвестно');
      }
    } catch (e) {
      result.textContent = '❌ Запрос не выполнен: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  function localizeApiErrorMessage(rawMessage) {
    const message = String(rawMessage || '').trim();
    if (!message) return 'Произошла ошибка';

    const knownErrors = {
      'code must be 3-64 chars': 'Промокод должен содержать от 3 до 64 символов',
      'code may contain only A-Z, 0-9, _ and -': 'Промокод может содержать только латинские буквы A-Z, цифры, "_" и "-"',
      'reward_type must be percent or gift_service': 'Выберите корректный тип промокода',
      'usage_mode must be always or single_use': 'Выберите корректный режим использования промокода',
      'discount_percent must be integer between 1 and 90': 'Скидка должна быть целым числом от 1 до 90',
      'gift_service_id must be a positive integer': 'Выберите подарочную зону',
      'gift service is not available': 'Подарочная зона недоступна',
      'gift service must be an epilation zone, not a complex': 'Подарком может быть только зона эпиляции, а не комплекс',
      'promo code already exists': 'Промокод уже существует'
    };
    return knownErrors[message] || message;
  }

  function escapeHtml(str) {
    let d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  let STATUS_LABELS = {
    pending: 'Ожидает',
    confirmed: 'Запланировано',
    completed: 'Выполнено',
    canceled: 'Отменено'
  };

  function formatDateTime(iso) {
    let d = new Date(iso);
    return d.toLocaleDateString('ru-RU') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function toInputDateTime(iso) {
    let d = new Date(iso);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function toIsoDateTime(inputValue) {
    // datetime-local gives "YYYY-MM-DDTHH:MM" without timezone
    // Treat it as local time by appending timezone offset
    let d = new Date(inputValue);
    if (isNaN(d.getTime())) {
      // Fallback: parse manually
      let parts = inputValue.split('T');
      let dateParts = parts[0].split('-');
      let timeParts = (parts[1] || '00:00').split(':');
      d = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]),
                    Number(timeParts[0]), Number(timeParts[1]));
    }
    return d.toISOString();
  }

  function toIsoDate(dateValue) {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function startOfLocalDay(dateValue) {
    const d = new Date(dateValue);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfLocalDay(dateValue) {
    const d = startOfLocalDay(dateValue);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  function formatMoney(value) {
    const num = Number(value || 0);
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(num)) + ' ₽';
  }

  function normalizeProfileText(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  }

  function normalizeGiftUrl(value) {
    const raw = normalizeProfileText(value);
    if (!raw) return '';
    const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw;
    try {
      const parsed = new window.URL(withProtocol);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      return parsed.toString();
    } catch {
      return '';
    }
  }

  function resolveMasterProfile(profileResponse) {
    const profile = profileResponse && profileResponse.profile && typeof profileResponse.profile === 'object'
      ? profileResponse.profile
      : {};
    return {
      brand: normalizeProfileText(profile.brand) || DEFAULT_MASTER_PROFILE.brand,
      subtitle: normalizeProfileText(profile.subtitle) || DEFAULT_MASTER_PROFILE.subtitle,
      name: normalizeProfileText(profile.name)
        || normalizeProfileText(profileResponse && profileResponse.display_name)
        || DEFAULT_MASTER_PROFILE.name,
      role: normalizeProfileText(profile.role) || DEFAULT_MASTER_PROFILE.role,
      city: normalizeProfileText(profile.city) || DEFAULT_MASTER_PROFILE.city,
      experience: normalizeProfileText(profile.experience),
      phone: normalizeProfileText(profile.phone),
      address: normalizeProfileText(profile.address),
      bio: normalizeProfileText(profile.bio),
      gift_text: normalizeProfileText(profile.gift_text) || DEFAULT_MASTER_PROFILE.gift_text,
      gift_url: normalizeGiftUrl(profile.gift_url) || DEFAULT_MASTER_PROFILE.gift_url
    };
  }

  // === TABS ===

  function switchTab(tabName) {
    const tabsContainer = $('masterTabs');
    let activeTab = null;
    document.querySelectorAll('.master-tab').forEach(function (t) {
      const isActive = t.dataset.tab === tabName;
      t.classList.toggle('active', isActive);
      if (isActive) activeTab = t;
    });
    if (
      tabsContainer
      && activeTab
      && typeof activeTab.scrollIntoView === 'function'
      && tabsContainer.scrollWidth > tabsContainer.clientWidth + 2
    ) {
      activeTab.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    }
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.style.display = 'none';
    });

    let panel = $('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    if (panel) panel.style.display = '';

    if (tabName === 'today') loadToday();
    if (tabName === 'profile') loadMasterProfile();
    if (tabName === 'bookings') loadBookings();
    if (tabName === 'leads') setLeadsView(leadsView);
    if (tabName === 'services') loadServices();
    if (tabName === 'settings') loadSettings();
  }

  function getFinishedNonCanceledBookings(bookings) {
    const nowTs = Date.now();
    return (bookings || []).filter(function (item) {
      if (!item || item.status === 'canceled') return false;
      const endTs = item.end_at ? new Date(item.end_at).getTime() : new Date(item.start_at).getTime();
      if (!Number.isFinite(endTs)) return false;
      return endTs < nowTs;
    });
  }

  function getOverviewBounds(bookings) {
    const done = getFinishedNonCanceledBookings(bookings);
    if (!done.length) return null;
    const sorted = done.slice().sort(function (a, b) {
      return new Date(a.end_at || a.start_at).getTime() - new Date(b.end_at || b.start_at).getTime();
    });
    return {
      min: toIsoDate(sorted[0].end_at || sorted[0].start_at),
      max: toIsoDate(sorted[sorted.length - 1].end_at || sorted[sorted.length - 1].start_at)
    };
  }

  function getOverviewRange(bounds) {
    const now = new Date();
    const maxDate = bounds && bounds.max ? startOfLocalDay(bounds.max) : startOfLocalDay(now);
    const minDate = bounds && bounds.min ? startOfLocalDay(bounds.min) : startOfLocalDay(now);
    let from;
    let to = startOfLocalDay(maxDate);

    if (overviewPreset === 'week') {
      from = startOfLocalDay(maxDate);
      from.setDate(from.getDate() - 6);
    } else if (overviewPreset === 'month') {
      from = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
    } else if (overviewPreset === 'all') {
      from = startOfLocalDay(minDate);
    } else {
      from = startOfLocalDay(maxDate);
    }

    if (!from) from = startOfLocalDay(maxDate);
    if (from < minDate) from = startOfLocalDay(minDate);
    if (to < from) to = startOfLocalDay(from);
    return { from: toIsoDate(from), to: toIsoDate(to) };
  }

  function renderOverviewPresetButtons() {
    const mapping = {
      day: 'overviewPresetDay',
      week: 'overviewPresetWeek',
      month: 'overviewPresetMonth',
      all: 'overviewPresetAll'
    };
    Object.keys(mapping).forEach(function (key) {
      const node = $(mapping[key]);
      if (node) node.classList.toggle('active', overviewPreset === key);
    });
  }

  function setOverviewPreset(preset) {
    overviewPreset = preset;
    overviewFrom = '';
    overviewTo = '';
    refreshOverview();
  }

  function applyOverviewPeriod() {
    const from = $('overviewFrom') ? $('overviewFrom').value : '';
    const to = $('overviewTo') ? $('overviewTo').value : '';
    if (!from || !to) {
      showToast('Укажите обе даты периода');
      return;
    }
    if (from > to) {
      showToast('Дата начала позже даты окончания');
      return;
    }
    overviewPreset = 'custom';
    overviewFrom = from;
    overviewTo = to;
    refreshOverview();
  }

  async function fetchOverviewBookings() {
    try {
      const data = await apiFetch('/bookings');
      return Array.isArray(data) ? data : [];
    } catch (_) {
      return [];
    }
  }

  async function refreshOverview() {
    const label = $('overviewRangeLabel');
    if (label) label.textContent = 'Период: загрузка...';
    renderOverviewPresetButtons();

    try {
      const bookings = await fetchOverviewBookings();
      const finished = getFinishedNonCanceledBookings(bookings);
      const bounds = getOverviewBounds(bookings);
      let range = null;
      if (overviewPreset === 'custom' && overviewFrom && overviewTo) {
        range = { from: overviewFrom, to: overviewTo };
      } else {
        range = getOverviewRange(bounds);
      }

      if ($('overviewFrom') && range && range.from) $('overviewFrom').value = range.from;
      if ($('overviewTo') && range && range.to) $('overviewTo').value = range.to;

      const fromTs = range ? startOfLocalDay(range.from).getTime() : -Infinity;
      const toTs = range ? endOfLocalDay(range.to).getTime() : Infinity;

      const rows = finished.filter(function (item) {
        const endTs = new Date(item.end_at || item.start_at).getTime();
        return endTs >= fromTs && endTs <= toTs;
      });

      const revenue = rows.reduce(function (sum, item) {
        const finalPrice = Number(item.pricing_final != null ? item.pricing_final : item.final_price);
        const fallbackPrice = Number(item.pricing_base != null ? item.pricing_base : item.service_price);
        if (Number.isFinite(finalPrice) && finalPrice > 0) return sum + finalPrice;
        if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) return sum + fallbackPrice;
        return sum;
      }, 0);
      const clients = new Set(rows.map(function (item) { return item.client_id || item.client_name || item.client_telegram_id || item.id; }));
      const avg = rows.length ? (revenue / rows.length) : 0;

      if ($('overviewKpiBookings')) $('overviewKpiBookings').textContent = String(rows.length);
      if ($('overviewKpiRevenue')) $('overviewKpiRevenue').textContent = formatMoney(revenue);
      if ($('overviewKpiAvg')) $('overviewKpiAvg').textContent = formatMoney(avg);
      if ($('overviewKpiClients')) $('overviewKpiClients').textContent = String(clients.size);
      if (label) {
        label.textContent = range
          ? ('Период: ' + range.from + ' — ' + range.to)
          : 'Период: —';
      }
    } catch (err) {
      if (label) label.textContent = 'Период: —';
      if ($('overviewKpiBookings')) $('overviewKpiBookings').textContent = '0';
      if ($('overviewKpiRevenue')) $('overviewKpiRevenue').textContent = '0 ₽';
      if ($('overviewKpiAvg')) $('overviewKpiAvg').textContent = '0 ₽';
      if ($('overviewKpiClients')) $('overviewKpiClients').textContent = '0';
    }
  }

  // === TODAY ===

  async function loadToday() {
    let container = $('todayBookings');
    container.innerHTML = skeletonBookings(3);
    $('todayEmpty').style.display = 'none';
    refreshOverview();

    try {
      let today = new Date().toISOString().slice(0, 10);
      let data = await apiFetch('/calendar?date_from=' + today + '&date_to=' + today);
      let bookings = (data.bookings || []).filter(function (b) { return b.status !== 'canceled'; });

      if (bookings.length === 0) {
        container.innerHTML = '';
        $('todayEmpty').style.display = '';
        return;
      }

      container.innerHTML = bookings.map(renderBookingCard).join('');
      bindBookingContactButtons(container);
    } catch (err) {
      container.innerHTML = '';
      showToast(err.message);
    }
  }

  // === BOOKINGS ===

  function bookingStartTimeMs(startAt) {
    const ts = new Date(startAt || '').getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  function bookingSortRank(booking, nowMs) {
    const status = String(booking && booking.status ? booking.status : '');
    const isActiveStatus = status === 'pending' || status === 'confirmed';
    const startAtMs = bookingStartTimeMs(booking && booking.start_at);
    if (isActiveStatus && startAtMs >= nowMs) return 0;
    if (isActiveStatus) return 1;
    if (status === 'completed') return 2;
    if (status === 'canceled') return 3;
    return 4;
  }

  function sortMasterBookings(bookings) {
    const nowMs = Date.now();
    return (Array.isArray(bookings) ? bookings.slice() : []).sort(function (a, b) {
      const rankA = bookingSortRank(a, nowMs);
      const rankB = bookingSortRank(b, nowMs);
      const rankDiff = rankA - rankB;
      if (rankDiff !== 0) return rankDiff;
      const aStart = bookingStartTimeMs(a && a.start_at);
      const bStart = bookingStartTimeMs(b && b.start_at);
      if (rankA === 0 && rankB === 0) {
        // For upcoming active bookings show nearest slot first.
        return aStart - bStart;
      }
      return bStart - aStart;
    });
  }

  async function loadBookings() {
    let container = $('bookingsList');
    container.innerHTML = skeletonBookings(4);
    $('bookingsEmpty').style.display = 'none';

    try {
      let status = $('bookingsStatus').value;
      let q = status ? '?status=' + status : '';
      const rawBookings = await apiFetch('/bookings' + q);
      const bookings = sortMasterBookings(rawBookings);
      bookingsCache = bookings;

      if (bookings.length === 0) {
        container.innerHTML = '';
        $('bookingsEmpty').style.display = '';
        return;
      }

      container.innerHTML = bookings.map(renderBookingCard).join('');
      bindBookingContactButtons(container);
    } catch (err) {
      container.innerHTML = '';
      showToast(err.message);
    }
  }

  function parseBookingClientViewData(booking) {
    const rawClientName = String(booking && booking.client_name ? booking.client_name : '').trim();
    const rawDisplayName = String(booking && booking.client_display_name ? booking.client_display_name : '').trim();
    const rawAvatarUrl = String(booking && booking.client_avatar_url ? booking.client_avatar_url : '').trim();
    const rawTelegramUsername = String(booking && booking.client_telegram_username ? booking.client_telegram_username : '')
      .trim()
      .replace(/^@/, '');
    const telegramUsername = /^tg_[0-9]+$/i.test(rawTelegramUsername) ? '' : rawTelegramUsername;

    let telegramId = Number(booking && booking.client_telegram_id ? booking.client_telegram_id : 0);
    const telegramMatch = rawClientName.match(/^tg_(\d+)$/i);
    if (!telegramId && telegramMatch) {
      telegramId = Number(telegramMatch[1]);
    }

    let vkUserId = Number(booking && booking.client_vk_user_id ? booking.client_vk_user_id : 0);
    const vkMatch = rawClientName.match(/^vk_(\d+)$/i);
    if (!vkUserId && vkMatch) {
      vkUserId = Number(vkMatch[1]);
    }

    const rawNameLooksTechnical = /^tg_[0-9]+$/i.test(rawClientName) || /^vk_[0-9]+$/i.test(rawClientName);
    const displayNameRaw = rawDisplayName
      || (telegramUsername ? ('@' + telegramUsername) : '')
      || (!rawNameLooksTechnical ? rawClientName : '')
      || (telegramId > 0 ? ('Telegram #' + telegramId) : '')
      || (vkUserId > 0 ? ('VK #' + vkUserId) : '')
      || 'Клиент';

    const loginRaw = telegramUsername
      ? ('@' + telegramUsername)
      : (telegramId > 0 ? ('Telegram ID: ' + telegramId) : (vkUserId > 0 ? ('VK ID: ' + vkUserId) : ''));

    const fallbackToken = vkUserId > 0
      ? 'VK'
      : (telegramId > 0 || telegramUsername ? 'TG' : String(displayNameRaw).trim().slice(0, 1).toUpperCase() || 'К');

    const avatarHtml = rawAvatarUrl
      ? '<img class="booking-client-avatar-img" src="' + escapeHtml(rawAvatarUrl) + '" alt="avatar">'
      : '<div class="booking-client-avatar-fallback">' + escapeHtml(fallbackToken) + '</div>';

    return {
      displayName: displayNameRaw,
      login: loginRaw,
      avatarHtml: avatarHtml,
      telegramId: telegramId,
      telegramUsername: telegramUsername,
      vkUserId: vkUserId,
      canContact: telegramId > 0 || Boolean(telegramUsername) || vkUserId > 0
    };
  }

  function openVkProfile(vkUserId) {
    const normalizedVkUserId = Number(vkUserId || 0);
    if (!normalizedVkUserId) {
      showToast('Нет данных VK для открытия диалога');
      return;
    }
    const targetLink = 'https://vk.com/id' + normalizedVkUserId;
    const webApp = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

    if (window.Cypress) {
      if (!Array.isArray(window.__openedVkLinks)) window.__openedVkLinks = [];
      window.__openedVkLinks.push(targetLink);
      return;
    }

    if (webApp && typeof webApp.openLink === 'function') {
      webApp.openLink(targetLink, { try_instant_view: false });
      return;
    }
    window.location.href = targetLink;
  }

  function openBookingClientContact(telegramUserId, telegramUsername, vkUserId) {
    const tgId = Number(telegramUserId || 0);
    const tgUsername = String(telegramUsername || '').trim();
    if (tgId > 0 || tgUsername) {
      openLeadChat(tgId, tgUsername);
      return;
    }
    if (Number(vkUserId || 0) > 0) {
      openVkProfile(vkUserId);
      return;
    }
    showToast('Нет данных для связи с клиентом');
  }

  function bindBookingContactButtons(root) {
    if (!root) return;
    root.querySelectorAll('.booking-contact-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const telegramId = Number(btn.getAttribute('data-tg-id') || 0);
        const telegramUsername = String(btn.getAttribute('data-tg-username') || '');
        const vkUserId = Number(btn.getAttribute('data-vk-id') || 0);
        openBookingClientContact(telegramId, telegramUsername, vkUserId);
      });
    });
  }

  function renderBookingCard(b) {
    const clientView = parseBookingClientViewData(b);
    const contactControl = clientView.canContact
      ? '<button class="btn-small btn-chat booking-contact-btn"'
        + ' data-tg-id="' + Number(clientView.telegramId || 0) + '"'
        + ' data-tg-username="' + escapeHtml(clientView.telegramUsername || '') + '"'
        + ' data-vk-id="' + Number(clientView.vkUserId || 0) + '"'
        + '>Связаться</button>'
      : '<span class="booking-client-contact-hint">Без контакта</span>';

    let actions = '<button class="btn-small btn-edit" onclick="MasterApp.openBookingForm(' + b.id + ')">Редактировать</button>';
    if (b.status === 'pending') {
      actions += '<button class="btn-small btn-confirm" onclick="MasterApp.updateBooking(' + b.id + ',\'confirmed\')">Запланировать</button>'
        + '<button class="btn-small btn-cancel" onclick="MasterApp.updateBooking(' + b.id + ',\'canceled\')">Отклонить</button>';
    } else if (b.status === 'confirmed') {
      actions += '<button class="btn-small btn-complete" onclick="MasterApp.updateBooking(' + b.id + ',\'completed\')">Завершить</button>'
        + '<button class="btn-small btn-cancel" onclick="MasterApp.updateBooking(' + b.id + ',\'canceled\')">Отменить</button>';
    }

    let discountBadge = '';
    if (b.promo_code) {
      if (b.promo_reward_type === 'percent' && b.promo_discount_percent) {
        discountBadge = '<span class="booking-discount-badge promo">🎟 ' + escapeHtml(b.promo_code) + ' −' + b.promo_discount_percent + '%</span>';
      } else if (b.promo_reward_type === 'gift_service') {
        discountBadge = '<span class="booking-discount-badge promo">🎟 ' + escapeHtml(b.promo_code) + ' (подарок)</span>';
      }
    } else if (b.hot_window_reward_type) {
      if (b.hot_window_reward_type === 'percent' && b.hot_window_discount_percent) {
        discountBadge = '<span class="booking-discount-badge hot">🔥 −' + b.hot_window_discount_percent + '%</span>';
      } else if (b.hot_window_reward_type === 'gift_service') {
        discountBadge = '<span class="booking-discount-badge hot">🔥 Подарок</span>';
      }
    }

    const extraNames = Array.isArray(b.extra_service_names) ? b.extra_service_names.filter(Boolean) : [];
    const allNames = [b.service_name].concat(extraNames).filter(Boolean);
    const serviceTitle = allNames.map(escapeHtml).join(' + ');

    return '<div class="booking-card">'
      + '<div class="booking-card-header">'
      + '<h4>' + serviceTitle + '</h4>'
      + '<span class="booking-status ' + b.status + '">' + (STATUS_LABELS[b.status] || b.status) + '</span>'
      + '</div>'
      + '<div class="booking-client-row">'
      + '<div class="booking-client-avatar">' + clientView.avatarHtml + '</div>'
      + '<div class="booking-client-main">'
      + '<span class="booking-client-name">' + escapeHtml(clientView.displayName) + '</span>'
      + (clientView.login ? '<span class="booking-client-login">' + escapeHtml(clientView.login) + '</span>' : '')
      + '</div>'
      + contactControl
      + '</div>'
      + '<div class="booking-card-meta">'
      + '<span>' + formatDateTime(b.start_at) + '</span>'
      + (b.pricing_final != null
        ? '<span class="booking-price">'
          + (b.pricing_discount_amount > 0
            && b.promo_reward_type !== 'gift_service'
            && b.hot_window_reward_type !== 'gift_service'
            ? '<s>' + formatMoney(b.pricing_base) + '</s> '
            : '')
          + '<strong>' + formatMoney(b.pricing_final) + '</strong>'
          + (discountBadge ? ' ' + discountBadge : '')
          + '</span>'
        : (discountBadge ? '<span>' + discountBadge + '</span>' : ''))
      + (b.master_note ? '<span>Комментарий: ' + escapeHtml(b.master_note) + '</span>' : '')
      + '</div>'
      + (actions ? '<div class="booking-card-actions">' + actions + '</div>' : '')
      + '</div>';
  }

  async function updateBooking(id, status) {
    try {
      await apiMethod('PATCH', '/bookings/' + id, { status: status });
      // Reload current tab
      let activeTab = document.querySelector('.master-tab.active');
      if (activeTab) switchTab(activeTab.dataset.tab);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function openBookingForm(bookingId) {
    let booking = bookingId ? bookingsCache.find(function (item) { return item.id === bookingId; }) : null;
    if (bookingId && !booking) {
      let allBookings = await apiFetch('/bookings');
      booking = allBookings.find(function (item) { return item.id === bookingId; }) || null;
    }

    const [clients, services] = await Promise.all([
      apiFetch('/clients'),
      apiFetch('/services')
    ]);

    if (!clients.length) {
      showToast('Сначала клиент должен хотя бы раз записаться через ссылку');
      return;
    }
    if (!services.length) {
      showToast('Добавьте хотя бы одну услугу');
      return;
    }

    let overlay = document.createElement('div');
    overlay.className = 'service-form-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

    let clientOptions = clients.map(function (c) {
      let selected = booking && booking.client_id === c.user_id ? ' selected' : '';
      return '<option value="' + c.user_id + '"' + selected + '>' + escapeHtml(c.username) + '</option>';
    }).join('');

    let serviceOptions = services.map(function (s) {
      let selected = booking && booking.service_id === s.id ? ' selected' : '';
      return '<option value="' + s.id + '"' + selected + '>' + escapeHtml(s.name) + ' (' + s.duration_minutes + ' мин)</option>';
    }).join('');

    let statusValue = booking ? booking.status : 'confirmed';
    let dateValue = booking ? toInputDateTime(booking.start_at) : toInputDateTime(new Date().toISOString());

    overlay.innerHTML = '<div class="service-form-sheet booking-form-sheet">'
      + '<h3>' + (booking ? 'Редактировать запись' : 'Новая запись') + '</h3>'
      + '<input type="hidden" id="bookingFormId" value="' + (booking ? booking.id : '') + '">'
      + '<div class="form-field"><label>Клиент</label><select id="bookingFormClient">' + clientOptions + '</select></div>'
      + '<div class="form-field"><label>Услуга</label><select id="bookingFormService">' + serviceOptions + '</select></div>'
      + '<div class="form-field"><label>Дата и время</label><input id="bookingFormStart" type="datetime-local" value="' + dateValue + '"></div>'
      + '<div class="form-field"><label>Статус</label>'
      + '<select id="bookingFormStatus">'
      + '<option value="pending"' + (statusValue === 'pending' ? ' selected' : '') + '>Ожидает</option>'
      + '<option value="confirmed"' + (statusValue === 'confirmed' ? ' selected' : '') + '>Запланировано</option>'
      + '<option value="completed"' + (statusValue === 'completed' ? ' selected' : '') + '>Выполнено</option>'
      + '<option value="canceled"' + (statusValue === 'canceled' ? ' selected' : '') + '>Отменено</option>'
      + '</select></div>'
      + '<div class="form-field"><label>Комментарий</label><textarea id="bookingFormNote" rows="3" placeholder="Комментарий мастера">'
      + escapeHtml(booking && booking.master_note ? booking.master_note : '') + '</textarea></div>'
      + '<div class="sheet-actions">'
      + '<button class="btn-secondary" onclick="MasterApp.closeBookingForm()">Отмена</button>'
      + '<button class="btn-primary" onclick="MasterApp.saveBookingForm()">Сохранить</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);
  }

  function closeBookingForm() {
    let overlay = document.querySelector('.service-form-overlay');
    if (overlay) overlay.remove();
  }

  async function saveBookingForm() {
    try {
      const bookingId = document.getElementById('bookingFormId').value;
      const clientId = Number(document.getElementById('bookingFormClient').value);
      const serviceId = Number(document.getElementById('bookingFormService').value);
      const startAtValue = document.getElementById('bookingFormStart').value;
      const status = document.getElementById('bookingFormStatus').value;
      const note = document.getElementById('bookingFormNote').value.trim();

      if (!clientId || !serviceId || !startAtValue) {
        showToast('Заполните клиента, услугу и время');
        return;
      }

      const payload = {
        client_id: clientId,
        service_id: serviceId,
        start_at: toIsoDateTime(startAtValue),
        status: status,
        master_note: note || null
      };

      if (bookingId) {
        await apiMethod('PUT', '/bookings/' + bookingId, payload);
      } else {
        await apiMethod('POST', '/bookings', payload);
      }

      closeBookingForm();
      await loadBookings();
      await loadToday();
      showToast('Запись сохранена');
    } catch (err) {
      showToast(err.message);
    }
  }

  // === SERVICES ===

  async function loadServices() {
    let container = $('servicesList');
    container.innerHTML = skeletonBookings(2);
    $('servicesEmpty').style.display = 'none';

    try {
      let services = await apiFetch('/services');
      servicesCache = services;
      if (services.length === 0) {
        container.innerHTML = '';
        $('servicesEmpty').style.display = '';
        return;
      }
      renderServices();
    } catch (err) {
      container.innerHTML = '';
      showToast(err.message);
    }
  }

  function parseServiceTaxonomy(service) {
    const name = String(service && service.name ? service.name : '');
    const description = String(service && service.description ? service.description : '');
    const source = (name + ' ' + description).toLowerCase();
    const method = source.includes('воск') || source.includes('wax') ? 'wax' : 'sugar';
    const category = description.includes('Комплексы') || /комплекс/i.test(name) ? 'Комплексы' : 'Услуги';
    return { method: method, category: category };
  }

  function renderServices() {
    const container = $('servicesList');
    const emptyEl = $('servicesEmpty');
    filteredServices = servicesCache.filter(function (s) {
      const tax = parseServiceTaxonomy(s);
      const passMethod = serviceMethodFilter === 'all' || tax.method === serviceMethodFilter;
      const passCategory = serviceCategoryFilter === 'all' || tax.category === serviceCategoryFilter;
      return passMethod && passCategory;
    });

    if (!filteredServices.length) {
      container.innerHTML = '';
      emptyEl.style.display = '';
      emptyEl.querySelector('p').textContent = 'По выбранным фильтрам услуг нет';
      return;
    }

    emptyEl.style.display = 'none';
    container.innerHTML = filteredServices.map(function (s) {
      const tax = parseServiceTaxonomy(s);
      return '<div class="service-card">'
        + '<div class="service-info">'
        + '<h3>' + escapeHtml(s.name) + '</h3>'
        + '<span class="service-meta">' + tax.category + ' · ' + s.duration_minutes + ' мин'
        + (s.price ? ' · ' + s.price + ' ₽' : '') + '</span>'
        + '</div>'
        + '<div class="service-card-actions">'
        + '<button class="btn-small btn-edit" onclick="event.stopPropagation();MasterApp.editService(' + s.id + ')">Изменить</button>'
        + '<button class="btn-small btn-cancel" onclick="event.stopPropagation();MasterApp.deleteService(' + s.id + ')">Удалить</button>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function setServiceMethodFilter(next) {
    serviceMethodFilter = next;
    document.querySelectorAll('#tabServices .service-tab[data-method]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.method === next);
    });
    renderServices();
  }

  function setServiceCategoryFilter(next) {
    serviceCategoryFilter = next;
    document.querySelectorAll('#tabServices .service-tab[data-category]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.category === next);
    });
    renderServices();
  }

  function showAddService() {
    editingServiceId = null;
    showServiceForm({ name: '', duration_minutes: 60, price: '' });
  }

  async function editService(serviceId) {
    let s = servicesCache.find(function (item) { return item.id === serviceId; });
    if (!s) {
      try {
        let all = await apiFetch('/services');
        s = all.find(function (item) { return item.id === serviceId; });
      } catch (_) {
        // ignore and show fallback message below
      }
    }
    if (!s) { showToast('Услуга не найдена'); return; }
    editingServiceId = serviceId;
    showServiceForm(s);
  }

  function showServiceForm(s) {
    let overlay = document.createElement('div');
    overlay.className = 'service-form-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="service-form-sheet">'
      + '<h3>' + (editingServiceId ? 'Редактировать услугу' : 'Новая услуга') + '</h3>'
      + '<div class="form-field"><label>Название</label><input id="newServiceName" value="' + escapeHtml(s.name || '') + '" placeholder="Маникюр"></div>'
      + '<div class="form-field"><label>Длительность (мин)</label><input id="newServiceDuration" type="number" value="' + (s.duration_minutes || 60) + '"></div>'
      + '<div class="form-field"><label>Цена (₽, необязательно)</label><input id="newServicePrice" type="number" value="' + (s.price || '') + '" placeholder="0"></div>'
      + '<button class="btn-primary" style="margin-top:12px;" onclick="MasterApp.saveService()">Сохранить</button>'
      + '</div>';
    document.body.appendChild(overlay);
  }

  async function saveService() {
    try {
      let name = document.getElementById('newServiceName').value.trim();
      let duration = parseInt(document.getElementById('newServiceDuration').value) || 60;
      let price = parseInt(document.getElementById('newServicePrice').value) || 0;

      if (!name) { showToast('Введите название услуги'); return; }

      if (editingServiceId) {
        await apiMethod('PUT', '/services/' + editingServiceId, { name: name, duration_minutes: duration, price: price || null });
      } else {
        await apiMethod('POST', '/services', { name: name, duration_minutes: duration, price: price || undefined });
      }
      const wasEditing = Boolean(editingServiceId);

      let overlay = document.querySelector('.service-form-overlay');
      if (overlay) overlay.remove();
      editingServiceId = null;

      loadServices();
      showToast(wasEditing ? 'Услуга обновлена' : 'Услуга добавлена');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function deleteService(serviceId) {
    if (!window.confirm('Удалить эту услугу?')) return;
    try {
      await apiMethod('DELETE', '/services/' + serviceId);
      loadServices();
      showToast('Услуга удалена');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function bootstrapDefaultServices() {
    try {
      const overwrite = window.confirm('Загрузить прайс по шаблону?\n\nЕсли услуги уже есть, они будут заменены.');
      if (!overwrite) return;

      const result = await apiMethod('POST', '/services/bootstrap-default', { overwrite: true });
      await loadServices();
      showToast('Прайс загружен: ' + result.inserted_count + ' услуг');
    } catch (err) {
      showToast(err.message);
    }
  }

  // === LEADS ===

  function formatSignedPercent(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    const rounded = Math.round(Number(value) * 10) / 10;
    if (rounded > 0) return '+' + rounded + '%';
    if (rounded < 0) return rounded + '%';
    return '0%';
  }

  function renderLeadsDelta(elementId, currentValue, previousValue) {
    const el = $(elementId);
    if (!el) return;
    const currentNum = Number(currentValue || 0);
    const previousNum = Number(previousValue || 0);
    if (previousNum <= 0) {
      el.textContent = currentNum > 0 ? 'Новый рост' : 'Без изменений';
      el.className = 'leads-delta';
      return;
    }
    const delta = ((currentNum - previousNum) / previousNum) * 100;
    el.textContent = formatSignedPercent(delta) + ' к прошлому периоду';
    el.className = 'leads-delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');
  }

  function conversionLabel(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    return (Math.round(Number(value) * 10) / 10) + '%';
  }

  function setLeadsPeriod(period) {
    leadsPeriod = period;
    document.querySelectorAll('[data-leads-period]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.leadsPeriod === period);
    });
    if (leadsView === 'summary') loadLeadsMetrics();
    if (leadsView === 'users') loadLeadsRegistrations();
  }

  function setLeadsView(view) {
    leadsView = view === 'users' ? 'users' : 'summary';
    document.querySelectorAll('[data-leads-view]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.leadsView === leadsView);
    });

    const summaryEl = $('leadsSummarySection');
    const usersEl = $('leadsUsersSection');
    if (summaryEl) summaryEl.style.display = leadsView === 'summary' ? '' : 'none';
    if (usersEl) usersEl.style.display = leadsView === 'users' ? '' : 'none';

    if (leadsView === 'summary') loadLeadsMetrics();
    else loadLeadsRegistrations();
  }

  function toggleLeadsHelp() {
    leadsHelpVisible = !leadsHelpVisible;
    const panel = $('leadsHelpPanel');
    const btn = $('leadsHelpToggleBtn');
    if (panel) panel.style.display = leadsHelpVisible ? '' : 'none';
    if (btn) {
      btn.textContent = leadsHelpVisible ? 'Скрыть подсказки' : 'Подсказки';
      btn.setAttribute('aria-expanded', leadsHelpVisible ? 'true' : 'false');
    }
  }

  async function loadLeadsMetrics() {
    const funnelEl = $('leadsFunnel');
    if (!funnelEl) return;
    const requestSeq = ++leadsMetricsRequestSeq;

    funnelEl.innerHTML = '<p class="settings-hint">Загрузка...</p>';
    try {
      const data = await apiFetch('/leads/metrics?period=' + encodeURIComponent(leadsPeriod));
      if (requestSeq !== leadsMetricsRequestSeq || leadsView !== 'summary') return;
      const current = data.current && data.current.metrics ? data.current.metrics : {};
      const previous = data.previous && data.previous.metrics ? data.previous.metrics : {};
      const conversion = data.current && data.current.conversion ? data.current.conversion : {};

      $('leadsVisitors').textContent = Number(current.visitors || 0);
      $('leadsAuthStarted').textContent = Number(current.auth_started || 0);
      $('leadsAuthSuccess').textContent = Number(current.auth_success || 0);
      $('leadsBookingStarted').textContent = Number(current.booking_started || 0);
      $('leadsBookingCreated').textContent = Number(current.booking_created || 0);

      renderLeadsDelta('leadsVisitorsDelta', current.visitors, previous.visitors);
      renderLeadsDelta('leadsAuthStartedDelta', current.auth_started, previous.auth_started);
      renderLeadsDelta('leadsAuthSuccessDelta', current.auth_success, previous.auth_success);
      renderLeadsDelta('leadsBookingStartedDelta', current.booking_started, previous.booking_started);
      renderLeadsDelta('leadsBookingCreatedDelta', current.booking_created, previous.booking_created);

      funnelEl.innerHTML = [
        '<div class="leads-funnel-row"><span>Visit → Auth start</span><strong>' + conversionLabel(conversion.visit_to_auth_start) + '</strong></div>',
        '<div class="leads-funnel-row"><span>Auth start → Auth success</span><strong>' + conversionLabel(conversion.auth_start_to_auth_success) + '</strong></div>',
        '<div class="leads-funnel-row"><span>Auth success → Booking created</span><strong>' + conversionLabel(conversion.auth_success_to_booking_created) + '</strong></div>',
        '<div class="leads-funnel-row"><span>Visit → Booking created</span><strong>' + conversionLabel(conversion.visit_to_booking_created) + '</strong></div>',
        '<div class="leads-funnel-row"><span>Booking started → Booking created</span><strong>' + conversionLabel(conversion.booking_started_to_booking_created) + '</strong></div>'
      ].join('');

      const start = data.current && data.current.range_start_local ? String(data.current.range_start_local).slice(0, 16).replace('T', ' ') : '';
      const end = data.current && data.current.range_end_local ? String(data.current.range_end_local).slice(0, 16).replace('T', ' ') : '';
      $('leadsRangeLabel').textContent = start && end
        ? 'Текущий период: ' + start + ' — ' + end + ' (' + (data.timezone || 'UTC') + ')'
        : 'Период не определен';
    } catch (err) {
      if (requestSeq !== leadsMetricsRequestSeq || leadsView !== 'summary') return;
      funnelEl.innerHTML = '<p class="settings-hint">Не удалось загрузить воронку</p>';
      showToast(err.message);
    }
  }

  function formatLeadDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU');
  }

  function getLeadsUsersUiState() {
    const sort = $('leadsUsersSort') ? $('leadsUsersSort').value : 'registered_desc';
    const bookingsFilter = $('leadsUsersBookingsFilter') ? $('leadsUsersBookingsFilter').value : 'all';
    const usernameFilter = $('leadsUsersUsernameFilter') ? $('leadsUsersUsernameFilter').value : 'all';
    const search = $('leadsUsersSearch') ? String($('leadsUsersSearch').value || '').trim().toLowerCase() : '';
    return { sort: sort, bookingsFilter: bookingsFilter, usernameFilter: usernameFilter, search: search };
  }

  function parseLeadUserViewData(u) {
    const rawTgUsername = String(u.telegram_username || '').trim();
    const tgUsername = /^tg_[0-9]+$/i.test(rawTgUsername) ? '' : rawTgUsername;
    const login = tgUsername ? ('@' + escapeHtml(tgUsername)) : 'Логин Telegram скрыт';
    const rawDisplayName = String(u.display_name || '').trim();
    const displayName = rawDisplayName
      ? escapeHtml(rawDisplayName)
      : (tgUsername ? ('@' + escapeHtml(tgUsername)) : 'Пользователь Telegram');
    const telegramId = u.telegram_user_id ? String(u.telegram_user_id) : 'неизвестно';
    const registeredAt = formatLeadDate(u.registered_at);
    const bookingsTotal = Number(u.bookings_total || 0);
    const avatarUrl = typeof u.avatar_url === 'string' ? u.avatar_url.trim() : '';
    const avatarHtml = avatarUrl
      ? '<img class="leads-user-avatar-img" src="' + escapeHtml(avatarUrl) + '" alt="avatar">'
      : '<div class="leads-user-avatar-fallback">' + displayName.slice(0, 1).toUpperCase() + '</div>';
    const usernameAttr = escapeHtml(String(u.telegram_username || ''));
    const canWrite = Boolean(tgUsername);
    return {
      tgUsername: tgUsername,
      login: login,
      displayName: displayName,
      telegramId: telegramId,
      registeredAt: registeredAt,
      bookingsTotal: bookingsTotal,
      avatarHtml: avatarHtml,
      usernameAttr: usernameAttr,
      canWrite: canWrite
    };
  }

  function getLeadRegistrationTime(u) {
    const t = new Date(u && u.registered_at ? u.registered_at : '').getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function applyLeadsUsersFilters(users, state) {
    const filtered = users.filter(function (u) {
      const view = parseLeadUserViewData(u);
      if (state.bookingsFilter === 'with_bookings' && view.bookingsTotal <= 0) return false;
      if (state.bookingsFilter === 'without_bookings' && view.bookingsTotal > 0) return false;
      if (state.usernameFilter === 'with_username' && !view.tgUsername) return false;
      if (state.usernameFilter === 'without_username' && view.tgUsername) return false;
      if (!state.search) return true;
      const searchable = [
        String(u.telegram_user_id || ''),
        String(u.display_name || ''),
        String(u.telegram_username || ''),
        String(u.username || '')
      ].join(' ').toLowerCase();
      return searchable.includes(state.search);
    });

    filtered.sort(function (a, b) {
      const bookingsA = Number(a.bookings_total || 0);
      const bookingsB = Number(b.bookings_total || 0);
      const regA = getLeadRegistrationTime(a);
      const regB = getLeadRegistrationTime(b);
      if (state.sort === 'bookings_desc') return bookingsB - bookingsA || regB - regA;
      if (state.sort === 'bookings_asc') return bookingsA - bookingsB || regB - regA;
      if (state.sort === 'registered_asc') return regA - regB;
      return regB - regA;
    });

    return filtered;
  }

  function renderLeadsUsersList(users) {
    const listEl = $('leadsUsersList');
    const emptyEl = $('leadsUsersEmpty');
    if (!listEl || !emptyEl) return;

    if (!users.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      const emptyText = emptyEl.querySelector('p');
      if (emptyText) {
        emptyText.textContent = leadsUsersRaw.length === 0
          ? 'За выбранный период новых регистраций нет'
          : 'По выбранным фильтрам пользователей не найдено';
      }
      return;
    }

    emptyEl.style.display = 'none';
    listEl.innerHTML = users.map(function (u) {
      const view = parseLeadUserViewData(u);
      return '<article class="leads-user-card">'
        + '<div class="leads-user-main">'
        + '<div class="leads-user-main-left">'
        + '<div class="leads-user-avatar">' + view.avatarHtml + '</div>'
        + '<div>'
        + '<div class="leads-user-name">' + view.displayName + '</div>'
        + '<div class="leads-user-login">' + view.login + '</div>'
        + '</div>'
        + '</div>'
        + '<div class="leads-user-id">ID: ' + view.telegramId + '</div>'
        + '</div>'
        + '<div class="leads-user-meta">'
        + '<span>Регистрация: ' + view.registeredAt + '</span>'
        + '<span>Записей у мастера: ' + view.bookingsTotal + '</span>'
        + '</div>'
        + '<div class="leads-user-actions">'
        + ((view.canWrite || Number(u.telegram_user_id || 0) > 0)
          ? '<button class="leads-write-btn" data-tg-id="' + Number(u.telegram_user_id || 0) + '" data-tg-username="' + view.usernameAttr + '">Написать</button>'
          : '<span class="leads-user-chat-hint">Нет Telegram-данных для открытия диалога</span>')
        + '</div>'
        + '</article>';
    }).join('');

    listEl.querySelectorAll('.leads-write-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const tgId = Number(btn.getAttribute('data-tg-id') || 0);
        const tgUsername = String(btn.getAttribute('data-tg-username') || '');
        openLeadChat(tgId, tgUsername);
      });
    });
  }

  function updateLeadsUsersFilters() {
    const state = getLeadsUsersUiState();
    const filtered = applyLeadsUsersFilters(leadsUsersRaw, state);
    const hint = $('leadsUsersFilteredHint');
    if (hint) hint.textContent = 'Показано: ' + filtered.length + ' из ' + leadsUsersRaw.length;
    renderLeadsUsersList(filtered);
  }

  function openLeadChat(telegramUserId, telegramUsername) {
    const tgId = Number(telegramUserId || 0);
    const username = String(telegramUsername || '').trim();
    const webApp = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    const cleanUsername = /^tg_[0-9]+$/i.test(username) ? '' : username;
    const userLink = cleanUsername ? ('https://t.me/' + encodeURIComponent(cleanUsername)) : '';
    const idLink = tgId > 0 ? ('tg://user?id=' + tgId) : '';

    if (!userLink && !idLink) {
      showToast('Нельзя открыть диалог: нет данных Telegram у пользователя');
      return;
    }

    const targetLink = userLink || idLink;

    if (window.Cypress) {
      if (!Array.isArray(window.__openedTelegramLinks)) window.__openedTelegramLinks = [];
      window.__openedTelegramLinks.push(targetLink);
      return;
    }

    if (webApp && typeof webApp.openTelegramLink === 'function') {
      webApp.openTelegramLink(targetLink);
      return;
    }
    if (webApp && typeof webApp.openLink === 'function') {
      webApp.openLink(targetLink, { try_instant_view: false });
      return;
    }
    window.location.href = targetLink;
  }

  async function loadLeadsRegistrations() {
    const listEl = $('leadsUsersList');
    const emptyEl = $('leadsUsersEmpty');
    if (!listEl || !emptyEl) return;
    const requestSeq = ++leadsUsersRequestSeq;

    listEl.innerHTML = '<p class="settings-hint">Загрузка...</p>';
    emptyEl.style.display = 'none';

    try {
      const data = await apiFetch('/leads/registrations?period=' + encodeURIComponent(leadsPeriod));
      if (requestSeq !== leadsUsersRequestSeq || leadsView !== 'users') return;
      const users = Array.isArray(data.users) ? data.users : [];
      const start = data.range_start_local ? String(data.range_start_local).slice(0, 16).replace('T', ' ') : '';
      const end = data.range_end_local ? String(data.range_end_local).slice(0, 16).replace('T', ' ') : '';
      $('leadsUsersRangeLabel').textContent = start && end
        ? 'Период: ' + start + ' — ' + end + ' (' + (data.timezone || 'UTC') + ')'
        : 'Период не определен';
      leadsUsersRaw = users;
      updateLeadsUsersFilters();
    } catch (err) {
      if (requestSeq !== leadsUsersRequestSeq || leadsView !== 'users') return;
      leadsUsersRaw = [];
      listEl.innerHTML = '<p class="settings-hint">Не удалось загрузить список</p>';
      showToast(err.message);
    }
  }

  // === PROFILE ===

  function renderProfilePreview() {
    if (!masterProfileCache) return;
    const profile = masterProfileCache;
    if ($('profilePreviewBrand')) $('profilePreviewBrand').textContent = profile.brand;
    if ($('profilePreviewSub')) $('profilePreviewSub').textContent = profile.subtitle;
    if ($('profilePreviewName')) {
      $('profilePreviewName').textContent = profile.name + (profile.role ? ' · ' + profile.role : '');
    }
    if ($('profilePreviewCity')) $('profilePreviewCity').textContent = profile.city || DEFAULT_MASTER_PROFILE.city;
    if ($('profilePreviewExp')) $('profilePreviewExp').textContent = profile.experience || '—';
    if ($('profilePreviewPhone')) $('profilePreviewPhone').textContent = profile.phone || '—';
    if ($('profilePreviewAddress')) $('profilePreviewAddress').textContent = profile.address || '—';
    if ($('profilePreviewBio')) {
      $('profilePreviewBio').textContent = profile.bio || 'Заполните блок «О себе», чтобы он отображался в карточке.';
    }
    if ($('profilePreviewGiftText')) $('profilePreviewGiftText').textContent = profile.gift_text;
    if ($('profilePreviewGiftUrl')) {
      const normalized = normalizeGiftUrl(profile.gift_url) || DEFAULT_MASTER_PROFILE.gift_url;
      $('profilePreviewGiftUrl').href = normalized;
      $('profilePreviewGiftUrl').textContent = normalized.replace(/^https?:\/\//, '');
    }
  }

  function fillProfileForm() {
    if (!masterProfileCache) return;
    const profile = masterProfileCache;
    if ($('profileBrand')) $('profileBrand').value = profile.brand;
    if ($('profileSubtitle')) $('profileSubtitle').value = profile.subtitle;
    if ($('profileName')) $('profileName').value = profile.name;
    if ($('profileRole')) $('profileRole').value = profile.role;
    if ($('profileExperience')) $('profileExperience').value = profile.experience;
    if ($('profileCity')) $('profileCity').value = profile.city;
    if ($('profilePhone')) $('profilePhone').value = profile.phone;
    if ($('profileAddress')) $('profileAddress').value = profile.address;
    if ($('profileBio')) $('profileBio').value = profile.bio;
    if ($('profileGiftText')) $('profileGiftText').value = profile.gift_text;
    if ($('profileGiftUrl')) $('profileGiftUrl').value = profile.gift_url;
  }

  async function loadMasterProfile(force) {
    if (masterProfileCache && !force) {
      fillProfileForm();
      renderProfilePreview();
      return;
    }

    try {
      const profileResponse = await apiFetch('/profile');
      currentMasterSlug = profileResponse.booking_slug || currentMasterSlug;
      if ($('bookingLink') && currentMasterSlug) {
        $('bookingLink').value = window.location.origin + '/book/' + currentMasterSlug;
      }
      masterProfileCache = resolveMasterProfile(profileResponse);
      fillProfileForm();
      renderProfilePreview();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function saveMasterProfile() {
    try {
      const giftUrlRaw = $('profileGiftUrl') ? $('profileGiftUrl').value : '';
      const giftUrl = normalizeGiftUrl(giftUrlRaw);
      if (giftUrlRaw && !giftUrl) {
        showToast('Проверьте ссылку подарка (только http/https)');
        return;
      }

      const payload = {
        profile: {
          brand: $('profileBrand') ? $('profileBrand').value : '',
          subtitle: $('profileSubtitle') ? $('profileSubtitle').value : '',
          name: $('profileName') ? $('profileName').value : '',
          role: $('profileRole') ? $('profileRole').value : '',
          experience: $('profileExperience') ? $('profileExperience').value : '',
          city: $('profileCity') ? $('profileCity').value : '',
          phone: $('profilePhone') ? $('profilePhone').value : '',
          address: $('profileAddress') ? $('profileAddress').value : '',
          bio: $('profileBio') ? $('profileBio').value : '',
          gift_text: $('profileGiftText') ? $('profileGiftText').value : '',
          gift_url: giftUrl || ''
        }
      };

      const updated = await apiMethod('PUT', '/profile', payload);
      masterProfileCache = resolveMasterProfile(updated);
      fillProfileForm();
      renderProfilePreview();
      showToast('Профиль сохранен');
    } catch (err) {
      showToast(err.message);
    }
  }

  function openGiftLink() {
    const value = $('profileGiftUrl') ? $('profileGiftUrl').value : '';
    const link = normalizeGiftUrl(value);
    if (!link) {
      showToast('Ссылка не задана');
      return;
    }

    const webApp = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    if (webApp && typeof webApp.openLink === 'function') {
      webApp.openLink(link, { try_instant_view: false });
      return;
    }
    window.open(link, '_blank', 'noopener,noreferrer');
  }

  // === SETTINGS ===

  async function loadSettings() {
    let appleSettings = null;
    try {
      await loadMasterProfile(true);
      if ($('bookingLink')) {
        $('bookingLink').value = currentMasterSlug
          ? PUBLIC_APP_ORIGIN + '/book/' + currentMasterSlug
          : 'Не удалось загрузить';
      }
    } catch (err) {
      if ($('bookingLink')) $('bookingLink').value = 'Не удалось загрузить';
    }

    // Google Calendar status
    try {
      let data = await requestRootJson('/calendar-sync/status', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const gcalStatusEl = $('gcalStatus');
      if (gcalStatusEl) {
        if (data.connected) {
          const syncMode = String((data.binding && data.binding.sync_mode) || 'push');
          gcalStatusEl.textContent = '';
          const connectedEl = document.createElement('span');
          connectedEl.style.color = 'var(--success)';
          connectedEl.textContent = 'Подключен';
          gcalStatusEl.appendChild(connectedEl);
          gcalStatusEl.appendChild(document.createTextNode(' (режим: ' + syncMode + ')'));
        } else {
          gcalStatusEl.textContent = '';
          const connectLink = document.createElement('a');
          connectLink.href = '#';
          connectLink.style.color = 'var(--primary)';
          connectLink.style.fontWeight = '600';
          connectLink.textContent = 'Подключить';
          connectLink.addEventListener('click', function (event) {
            event.preventDefault();
            connectGCal();
          });
          gcalStatusEl.appendChild(connectLink);
        }
      }
    } catch (_) {
      if ($('gcalStatus')) $('gcalStatus').textContent = 'Не удалось проверить';
    }

    // Reminder and pricing settings
    try {
      let settings = await apiFetch('/settings');
      appleSettings = settings;
      const minBookingNotice = settings.min_booking_notice_minutes ?? 60;
      const reminderHours = Array.isArray(settings.reminder_hours) ? settings.reminder_hours : [24, 2];
      const firstReminderRaw = Number(reminderHours[0]);
      const secondReminderRaw = Number(reminderHours[1]);
      const firstReminder = Number.isFinite(firstReminderRaw) ? firstReminderRaw : 24;
      const secondReminder = Number.isFinite(secondReminderRaw) ? secondReminderRaw : 2;
      const reminderSettingsEl = $('reminderSettings');
      if (reminderSettingsEl) {
        reminderSettingsEl.textContent = '';
        reminderSettingsEl.appendChild(document.createTextNode('Напоминания за: '));
        const hoursStrong = document.createElement('strong');
        hoursStrong.textContent = [firstReminder, secondReminder].join(', ');
        reminderSettingsEl.appendChild(hoursStrong);
        reminderSettingsEl.appendChild(document.createTextNode(' ч.'));
        reminderSettingsEl.appendChild(document.createElement('br'));
        reminderSettingsEl.appendChild(document.createTextNode('Минимум до записи: '));
        const minStrong = document.createElement('strong');
        minStrong.textContent = String(Number(minBookingNotice));
        reminderSettingsEl.appendChild(minStrong);
        reminderSettingsEl.appendChild(document.createTextNode(' мин'));
      }
      $('reminderHoursFirst').value = firstReminder;
      $('reminderHoursSecond').value = secondReminder;
      $('minBookingNoticeMinutes').value = Number(minBookingNotice);
    } catch (_) {
      $('reminderSettings').textContent = 'Не удалось загрузить';
    }

    renderAppleCalendarSettings(appleSettings);
    await loadAvailabilitySettings();
    await loadHotWindows();
    await loadPromoCodes();
  }

  async function loadAvailabilitySettings() {
    const rulesEl = $('availabilityRules');
    const exclusionsEl = $('availabilityExclusions');
    if (!rulesEl || !exclusionsEl) return;

    rulesEl.innerHTML = '<p class="settings-hint">Загрузка...</p>';
    exclusionsEl.innerHTML = '<p class="settings-hint">Загрузка...</p>';

    try {
      const [rules, exclusions] = await Promise.all([
        apiFetch('/availability/windows'),
        apiFetch('/availability/exclusions')
      ]);

      if (!rules.length) {
        rulesEl.innerHTML = '<p class="settings-hint">Пока нет рабочих окон. Добавьте первое окно выше.</p>';
      } else {
        rulesEl.innerHTML = rules.map(function (rule) {
          const dateText = escapeHtml(String(rule.date || '').slice(0, 10));
          const startText = escapeHtml(String(rule.start_time || '').slice(0, 5));
          const endText = escapeHtml(String(rule.end_time || '').slice(0, 5));
          return '<div class="settings-list-item">'
            + '<div>'
            + '<strong>' + dateText + '</strong>'
            + '<div class="settings-hint">' + startText + ' - ' + endText + '</div>'
            + '</div>'
            + '<button class="btn-small btn-cancel" onclick="MasterApp.deleteAvailabilityRule(' + rule.id + ')">Удалить</button>'
            + '</div>';
        }).join('');
      }

      if (!exclusions.length) {
        exclusionsEl.innerHTML = '<p class="settings-hint">Нет выходных дат.</p>';
      } else {
        exclusionsEl.innerHTML = exclusions.map(function (item) {
          const dateText = escapeHtml(String(item.date || '').slice(0, 10));
          const reason = item.reason ? ' — ' + escapeHtml(String(item.reason)) : '';
          return '<div class="settings-list-item">'
            + '<div><strong>' + dateText + '</strong><div class="settings-hint">' + reason + '</div></div>'
            + '<button class="btn-small btn-cancel" onclick="MasterApp.deleteAvailabilityExclusion(' + item.id + ')">Удалить</button>'
            + '</div>';
        }).join('');
      }
    } catch (err) {
      rulesEl.innerHTML = '<p class="settings-hint">Не удалось загрузить</p>';
      exclusionsEl.innerHTML = '<p class="settings-hint">Не удалось загрузить</p>';
      showToast(err.message);
    }
  }

  async function addAvailabilityRule() {
    try {
      const date = $('availabilityDate').value;
      const start = $('availabilityStart').value;
      const end = $('availabilityEnd').value;

      if (!date || !start || !end) {
        showToast('Выберите дату и время');
        return;
      }

      await apiMethod('POST', '/availability/windows', {
        date: date,
        start_time: start,
        end_time: end
      });
      await loadAvailabilitySettings();
      showToast('Окно добавлено');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function deleteAvailabilityRule(ruleId) {
    if (!window.confirm('Удалить это окно записи?')) return;
    try {
      await apiMethod('DELETE', '/availability/windows/' + ruleId);
      await loadAvailabilitySettings();
      showToast('Окно удалено');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function saveReminderSettings() {
    try {
      const first = Number($('reminderHoursFirst').value || 24);
      const second = Number($('reminderHoursSecond').value || 2);
      if (!Number.isInteger(first) || !Number.isInteger(second) || first < 1 || second < 1) {
        showToast('Введите корректные часы напоминаний');
        return;
      }
      await apiMethod('PUT', '/settings', {
        reminder_hours: [first, second]
      });
      await loadSettings();
      showToast('Напоминания сохранены');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function savePricingSettings() {
    try {
      const minMinutesRaw = $('minBookingNoticeMinutes').value;
      const minMinutes = minMinutesRaw === '' ? 60 : Number(minMinutesRaw);
      await apiMethod('PUT', '/settings', {
        min_booking_notice_minutes: minMinutes
      });
      await loadSettings();
      showToast('Ограничение по времени сохранено');
    } catch (err) {
      showToast(err.message);
    }
  }

  function onPromoRewardTypeChange() {
    const typeEl = $('promoRewardType');
    const discountEl = $('promoDiscountPercent');
    if (!typeEl || !discountEl) return;

    const isPercent = typeEl.value === 'percent';
    discountEl.style.display = isPercent ? '' : 'none';
  }

  function renderPromoCodes() {
    const listEl = $('promoCodesList');
    if (!listEl) return;

    if (!promoCodesCache.length) {
      listEl.innerHTML = '<p class="settings-hint">Промокодов пока нет</p>';
      return;
    }

    listEl.innerHTML = promoCodesCache.map(function (promo) {
      const reward = promo.reward_type === 'percent'
        ? 'Скидка ' + Number(promo.discount_percent || 0) + '%'
        : 'Подарок: ' + escapeHtml(promo.gift_service_name || 'Зона в подарок');
      const usageMode = String(promo.usage_mode || 'always');
      const usageLabel = usageMode === 'single_use' ? 'Одноразовый' : 'Постоянный';
      const actualUses = Number(promo.actual_uses_count != null ? promo.actual_uses_count : promo.uses_count || 0);
      const usageState = usageMode === 'single_use'
        ? (actualUses > 0 ? 'использован' : 'не использован')
        : ('применён ' + actualUses + ' ' + (actualUses === 1 ? 'раз' : actualUses >= 2 && actualUses <= 4 ? 'раза' : 'раз'));
      const status = promo.is_active ? 'Активен' : 'Выключен';
      const toggleLabel = promo.is_active ? 'Выключить' : 'Включить';
      const nextActive = promo.is_active ? 'false' : 'true';

      return '<div class="settings-list-item">'
        + '<div>'
        + '<strong>' + escapeHtml(promo.code) + '</strong>'
        + '<div class="settings-hint">' + reward + ' · ' + usageLabel + ' · ' + usageState + ' · ' + status + '</div>'
        + '</div>'
        + '<div class="settings-list-actions">'
        + '<button class="btn-small btn-edit" onclick="MasterApp.togglePromoCodeActive(' + promo.id + ',' + nextActive + ')">' + toggleLabel + '</button>'
        + '<button class="btn-small btn-cancel" onclick="MasterApp.deletePromoCode(' + promo.id + ')">Удалить</button>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  async function loadPromoCodes() {
    const listEl = $('promoCodesList');
    if (!listEl) return;

    listEl.innerHTML = '<p class="settings-hint">Загрузка...</p>';

    try {
      const promoCodes = await apiFetch('/promo-codes');
      promoCodesCache = Array.isArray(promoCodes) ? promoCodes : [];
      renderPromoCodes();
      onPromoRewardTypeChange();
    } catch (err) {
      promoCodesCache = [];
      listEl.innerHTML = '<p class="settings-hint">Не удалось загрузить промокоды</p>';
      showToast(err.message);
    }
  }

  async function createPromoCode() {
    try {
      const codeEl = $('promoCodeValue');
      const typeEl = $('promoRewardType');
      const usageModeEl = $('promoUsageMode');
      const discountEl = $('promoDiscountPercent');
      if (!codeEl || !typeEl || !usageModeEl || !discountEl) return;

      const code = String(codeEl.value || '').trim().toUpperCase();
      const rewardType = String(typeEl.value || '');
      const usageMode = String(usageModeEl.value || 'always');
      if (!code) {
        showToast('Введите промокод');
        return;
      }

      const payload = { code: code, reward_type: rewardType, usage_mode: usageMode };
      if (rewardType === 'percent') {
        const discount = Number(discountEl.value);
        if (!Number.isInteger(discount) || discount < 1 || discount > 90) {
          showToast('Скидка должна быть целым числом от 1 до 90');
          return;
        }
        payload.discount_percent = discount;
      }

      await apiMethod('POST', '/promo-codes', payload);
      codeEl.value = '';
      await loadPromoCodes();
      showToast('Промокод создан');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function togglePromoCodeActive(promoId, isActive) {
    try {
      await apiMethod('PATCH', '/promo-codes/' + promoId, { is_active: Boolean(isActive) });
      await loadPromoCodes();
      showToast(isActive ? 'Промокод включен' : 'Промокод выключен');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function deletePromoCode(promoId) {
    if (!window.confirm('Удалить промокод?')) return;
    try {
      await apiMethod('DELETE', '/promo-codes/' + promoId);
      await loadPromoCodes();
      showToast('Промокод удален');
    } catch (err) {
      showToast(err.message);
    }
  }

  // ─── Hot Windows ────────────────────────────────────────────────────────────

  let hotWindowsCache = [];

  function onHwRewardTypeChange() {
    const typeEl = $('hwRewardType');
    const discountEl = $('hwDiscountPercent');
    const giftEl = $('hwGiftServiceId');
    if (!typeEl) return;
    const isPercent = typeEl.value === 'percent';
    if (discountEl) discountEl.style.display = isPercent ? '' : 'none';
    if (giftEl) giftEl.style.display = isPercent ? 'none' : '';
  }

  function populateHwGiftServiceSelect() {
    const giftEl = $('hwGiftServiceId');
    if (!giftEl) return;
    const zones = servicesCache.filter(function (s) {
      return s.is_active && !/комплекс/i.test(String(s.name || '')) && !/комплекс/i.test(String(s.description || ''));
    });
    giftEl.innerHTML = zones.length
      ? zones.map(function (s) { return '<option value="' + s.id + '">' + escapeHtml(s.name) + ' (' + Number(s.price) + ' ₽)</option>'; }).join('')
      : '<option value="">Нет доступных зон</option>';
  }

  function renderHotWindows() {
    const listEl = $('hotWindowsList');
    if (!listEl) return;
    if (!hotWindowsCache.length) {
      listEl.innerHTML = '<p class="settings-hint">Горячих окон пока нет</p>';
      return;
    }
    listEl.innerHTML = hotWindowsCache.map(function (hw) {
      const dateStr = String(hw.date || '').slice(0, 10);
      const timeRange = String(hw.start_time || '').slice(0, 5) + ' – ' + String(hw.end_time || '').slice(0, 5);
      const reward = hw.reward_type === 'percent'
        ? 'Скидка ' + Number(hw.discount_percent || 0) + '%'
        : 'Подарок: ' + escapeHtml(hw.gift_service_name || 'Зона в подарок');
      return '<div class="settings-list-item">'
        + '<div>'
        + '<strong>🔥 ' + dateStr + ' · ' + timeRange + '</strong>'
        + '<div class="settings-hint">' + reward + '</div>'
        + '</div>'
        + '<button class="btn-small btn-cancel" onclick="MasterApp.deleteHotWindow(' + hw.id + ')">Удалить</button>'
        + '</div>';
    }).join('');
  }

  async function loadHotWindows() {
    const listEl = $('hotWindowsList');
    if (!listEl) return;
    listEl.innerHTML = '<p class="settings-hint">Загрузка...</p>';
    try {
      const data = await apiFetch('/hot-windows');
      hotWindowsCache = Array.isArray(data) ? data : [];
      renderHotWindows();
    } catch (err) {
      hotWindowsCache = [];
      listEl.innerHTML = '<p class="settings-hint">Не удалось загрузить</p>';
    }
    populateHwGiftServiceSelect();
    onHwRewardTypeChange();
  }

  async function createHotWindow() {
    try {
      const dateEl = $('hwDate');
      const startEl = $('hwStartTime');
      const endEl = $('hwEndTime');
      const typeEl = $('hwRewardType');
      const discountEl = $('hwDiscountPercent');
      const giftEl = $('hwGiftServiceId');
      if (!dateEl || !startEl || !endEl || !typeEl) return;

      const date = dateEl.value;
      const start_time = startEl.value;
      const end_time = endEl.value;
      const reward_type = typeEl.value;

      if (!date || !start_time || !end_time) {
        showToast('Укажите дату и диапазон времени');
        return;
      }
      if (start_time >= end_time) {
        showToast('Начало должно быть раньше окончания');
        return;
      }

      const payload = { date: date, start_time: start_time, end_time: end_time, reward_type: reward_type };
      if (reward_type === 'percent') {
        const pct = Number(discountEl && discountEl.value);
        if (!Number.isInteger(pct) || pct < 1 || pct > 90) {
          showToast('Скидка должна быть от 1 до 90 %');
          return;
        }
        payload.discount_percent = pct;
      } else {
        const svcId = Number(giftEl && giftEl.value);
        if (!svcId) {
          showToast('Выберите зону в подарок');
          return;
        }
        payload.gift_service_id = svcId;
      }

      await apiMethod('POST', '/hot-windows', payload);
      if (dateEl) dateEl.value = '';
      await loadHotWindows();
      showToast('Горячее окно добавлено');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function deleteHotWindow(hwId) {
    if (!window.confirm('Удалить горячее окно?')) return;
    try {
      await apiMethod('DELETE', '/hot-windows/' + hwId);
      await loadHotWindows();
      showToast('Удалено');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function addAvailabilityExclusion() {
    try {
      const date = $('availabilityExclusionDate').value;
      const reason = $('availabilityExclusionReason').value.trim();

      if (!date) {
        showToast('Выберите дату');
        return;
      }

      await apiMethod('POST', '/availability/exclusions', {
        date: date,
        reason: reason || null
      });

      $('availabilityExclusionDate').value = '';
      $('availabilityExclusionReason').value = '';
      await loadAvailabilitySettings();
      showToast('Выходной добавлен');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function deleteAvailabilityExclusion(exclusionId) {
    if (!window.confirm('Удалить выходной день?')) return;
    try {
      await apiMethod('DELETE', '/availability/exclusions/' + exclusionId);
      await loadAvailabilitySettings();
      showToast('Выходной удален');
    } catch (err) {
      showToast(err.message);
    }
  }

  function getAppleCalendarFeedUrl(tokenValue) {
    if (!currentMasterSlug || !tokenValue) return '';
    return window.location.origin
      + '/api/public/master/'
      + encodeURIComponent(currentMasterSlug)
      + '/calendar.ics?token='
      + encodeURIComponent(tokenValue);
  }

  function renderAppleCalendarSettings(settings) {
    const statusEl = $('appleCalStatus');
    const rowEl = $('appleCalLinkRow');
    const linkEl = $('appleCalendarLink');
    const openBtn = $('appleCalendarOpenBtn');
    if (!statusEl || !rowEl || !linkEl || !openBtn) return;

    const isEnabled = Boolean(settings && settings.apple_calendar_enabled && settings.apple_calendar_token);
    if (!isEnabled) {
      statusEl.textContent = 'Отключен';
      rowEl.style.display = 'none';
      openBtn.style.display = 'none';
      linkEl.value = '';
      return;
    }

    statusEl.innerHTML = '<span style="color:var(--success);">Подключен</span> (подписка .ics)';
    linkEl.value = getAppleCalendarFeedUrl(settings.apple_calendar_token);
    rowEl.style.display = '';
    openBtn.style.display = '';
  }

  function copyLink() {
    let input = $('bookingLink');
    navigator.clipboard.writeText(input.value).then(function () {
      showToast('Ссылка скопирована!');
      // Make toast green for success
      $('networkToast').style.background = 'var(--success)';
      setTimeout(function () { $('networkToast').style.background = ''; }, 3000);
    });
  }

  async function connectGCal() {
    try {
      let data = await requestRootJson('/calendar-sync/connect', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (data.url) window.location.href = data.url;
    } catch (err) {
      showToast('Ошибка подключения: ' + err.message);
    }
  }

  async function enableAppleCalendar() {
    try {
      await apiMethod('POST', '/settings/apple-calendar/enable');
      await loadSettings();
      showToast('Apple Calendar включен');
    } catch (err) {
      showToast('Ошибка Apple Calendar: ' + err.message);
    }
  }

  async function rotateAppleCalendar() {
    try {
      await apiMethod('POST', '/settings/apple-calendar/rotate');
      await loadSettings();
      showToast('Ссылка Apple Calendar обновлена');
    } catch (err) {
      showToast('Ошибка Apple Calendar: ' + err.message);
    }
  }

  async function disableAppleCalendar() {
    try {
      await apiMethod('DELETE', '/settings/apple-calendar');
      await loadSettings();
      showToast('Apple Calendar отключен');
    } catch (err) {
      showToast('Ошибка Apple Calendar: ' + err.message);
    }
  }

  function copyAppleLink() {
    const input = $('appleCalendarLink');
    if (!input || !input.value) {
      showToast('Ссылка пока не доступна');
      return;
    }
    navigator.clipboard.writeText(input.value).then(function () {
      showToast('Ссылка Apple Calendar скопирована');
      $('networkToast').style.background = 'var(--success)';
      setTimeout(function () { $('networkToast').style.background = ''; }, 3000);
    });
  }

  function openAppleCalendar() {
    const input = $('appleCalendarLink');
    if (!input || !input.value) {
      showToast('Ссылка пока не доступна');
      return;
    }
    const webApp = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    const httpsUrl = input.value;
    if (webApp && typeof webApp.openLink === 'function') {
      webApp.openLink(httpsUrl, { try_instant_view: false });
      return;
    }
    const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');
    window.location.href = webcalUrl;
  }

  function logout() {
    localStorage.removeItem('token');
    window.location.href = '/';
  }

  function updateKeyboardOffset() {
    if (!window.visualViewport) {
      document.documentElement.style.setProperty('--keyboard-offset', '0px');
      return;
    }
    const vv = window.visualViewport;
    const rawOffset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const keyboardOffset = rawOffset > 110 ? rawOffset : 0;
    document.documentElement.style.setProperty('--keyboard-offset', keyboardOffset + 'px');
  }

  function setupKeyboardVisibilityHelpers() {
    const isFocusableFormControl = function (node) {
      return Boolean(node
        && node.nodeType === 1
        && typeof node.matches === 'function'
        && node.matches('input, textarea, select'));
    };

    window.addEventListener('focusin', function (event) {
      const target = event.target;
      if (!isFocusableFormControl(target)) return;
      window.setTimeout(function () {
        if (typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
      }, 180);
      updateKeyboardOffset();
    });

    window.addEventListener('focusout', function () {
      window.setTimeout(updateKeyboardOffset, 120);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateKeyboardOffset);
      window.visualViewport.addEventListener('scroll', updateKeyboardOffset);
    }

    updateKeyboardOffset();
  }

  // === SKELETONS ===

  function skeletonBookings(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<div class="booking-card">'
        + '<div class="skeleton-line h16 w60" style="margin-bottom:8px;"></div>'
        + '<div class="skeleton-line w40" style="margin-bottom:4px;"></div>'
        + '<div class="skeleton-line w30"></div>'
        + '</div>';
    }
    return html;
  }

  // === INIT ===

  if (!token) {
    window.location.href = '/';
  } else {
    setupKeyboardVisibilityHelpers();
    loadToday();
  }

  window.MasterApp = {
    switchTab: switchTab,
    loadBookings: loadBookings,
    updateBooking: updateBooking,
    openBookingForm: openBookingForm,
    closeBookingForm: closeBookingForm,
    saveBookingForm: saveBookingForm,
    showAddService: showAddService,
    setServiceMethodFilter: setServiceMethodFilter,
    setServiceCategoryFilter: setServiceCategoryFilter,
    setOverviewPreset: setOverviewPreset,
    applyOverviewPeriod: applyOverviewPeriod,
    setLeadsPeriod: setLeadsPeriod,
    setLeadsView: setLeadsView,
    updateLeadsUsersFilters: updateLeadsUsersFilters,
    openLeadChat: openLeadChat,
    toggleLeadsHelp: toggleLeadsHelp,
    editService: editService,
    deleteService: deleteService,
    saveService: saveService,
    bootstrapDefaultServices: bootstrapDefaultServices,
    loadMasterProfile: loadMasterProfile,
    saveMasterProfile: saveMasterProfile,
    openGiftLink: openGiftLink,
    copyLink: copyLink,
    copyAppleLink: copyAppleLink,
    openAppleCalendar: openAppleCalendar,
    connectGCal: connectGCal,
    enableAppleCalendar: enableAppleCalendar,
    rotateAppleCalendar: rotateAppleCalendar,
    disableAppleCalendar: disableAppleCalendar,
    saveReminderSettings: saveReminderSettings,
    savePricingSettings: savePricingSettings,
    onHwRewardTypeChange: onHwRewardTypeChange,
    createHotWindow: createHotWindow,
    deleteHotWindow: deleteHotWindow,
    onPromoRewardTypeChange: onPromoRewardTypeChange,
    createPromoCode: createPromoCode,
    togglePromoCodeActive: togglePromoCodeActive,
    deletePromoCode: deletePromoCode,
    addAvailabilityRule: addAvailabilityRule,
    deleteAvailabilityRule: deleteAvailabilityRule,
    addAvailabilityExclusion: addAvailabilityExclusion,
    deleteAvailabilityExclusion: deleteAvailabilityExclusion,
    testNotification: testNotification,
    logout: logout,
    hideToast: hideToast
  };
})();
