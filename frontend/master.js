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

  let API_BASE = '/api/master';
  let token = localStorage.getItem('token') || '';
  let bookingsCache = [];
  let currentMasterSlug = '';
  const DAY_LABELS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

  function $(id) { return document.getElementById(id); }

  async function apiFetch(path) {
    let headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let res = await fetch(API_BASE + path, { headers: headers });
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      let data = await res.json().catch(function () { return {}; });
      throw new Error(data.error || 'Ошибка (' + res.status + ')');
    }
    return res.json();
  }

  async function apiMethod(method, path, body) {
    let headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let opts = { method: method, headers: headers };
    if (body) opts.body = JSON.stringify(body);

    let res = await fetch(API_BASE + path, opts);
    if (!res.ok) {
      let data = await res.json().catch(function () { return {}; });
      throw new Error(data.error || 'Ошибка (' + res.status + ')');
    }
    return res.json();
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
    return new Date(inputValue).toISOString();
  }

  // === TABS ===

  function switchTab(tabName) {
    document.querySelectorAll('.master-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.style.display = 'none';
    });

    let panel = $('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    if (panel) panel.style.display = '';

    if (tabName === 'today') loadToday();
    if (tabName === 'bookings') loadBookings();
    if (tabName === 'services') loadServices();
    if (tabName === 'settings') loadSettings();
  }

  // === TODAY ===

  async function loadToday() {
    let container = $('todayBookings');
    container.innerHTML = skeletonBookings(3);
    $('todayEmpty').style.display = 'none';

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
    } catch (err) {
      container.innerHTML = '';
      showToast(err.message);
    }
  }

  // === BOOKINGS ===

  async function loadBookings() {
    let container = $('bookingsList');
    container.innerHTML = skeletonBookings(4);
    $('bookingsEmpty').style.display = 'none';

    try {
      let status = $('bookingsStatus').value;
      let q = status ? '?status=' + status : '';
      let bookings = await apiFetch('/bookings' + q);
      bookingsCache = bookings;

      if (bookings.length === 0) {
        container.innerHTML = '';
        $('bookingsEmpty').style.display = '';
        return;
      }

      container.innerHTML = bookings.map(renderBookingCard).join('');
    } catch (err) {
      container.innerHTML = '';
      showToast(err.message);
    }
  }

  function renderBookingCard(b) {
    let actions = '<button class="btn-small btn-edit" onclick="MasterApp.openBookingForm(' + b.id + ')">Редактировать</button>';
    if (b.status === 'pending') {
      actions += '<button class="btn-small btn-confirm" onclick="MasterApp.updateBooking(' + b.id + ',\'confirmed\')">Запланировать</button>'
        + '<button class="btn-small btn-cancel" onclick="MasterApp.updateBooking(' + b.id + ',\'canceled\')">Отклонить</button>';
    } else if (b.status === 'confirmed') {
      actions += '<button class="btn-small btn-complete" onclick="MasterApp.updateBooking(' + b.id + ',\'completed\')">Завершить</button>'
        + '<button class="btn-small btn-cancel" onclick="MasterApp.updateBooking(' + b.id + ',\'canceled\')">Отменить</button>';
    }

    return '<div class="booking-card">'
      + '<div class="booking-card-header">'
      + '<h4>' + escapeHtml(b.service_name || 'Услуга') + '</h4>'
      + '<span class="booking-status ' + b.status + '">' + (STATUS_LABELS[b.status] || b.status) + '</span>'
      + '</div>'
      + '<div class="booking-card-meta">'
      + '<span>' + escapeHtml(b.client_name || 'Клиент') + '</span>'
      + '<span>' + formatDateTime(b.start_at) + '</span>'
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

      if (services.length === 0) {
        container.innerHTML = '';
        $('servicesEmpty').style.display = '';
        return;
      }

      container.innerHTML = services.map(function (s) {
        return '<div class="service-card">'
          + '<div class="service-info">'
          + '<h3>' + escapeHtml(s.name) + '</h3>'
          + '<span class="service-meta">' + s.duration_minutes + ' мин'
          + (s.price ? ' · ' + s.price + ' ₽' : '') + '</span>'
          + '</div>'
          + '</div>';
      }).join('');
    } catch (err) {
      container.innerHTML = '';
      showToast(err.message);
    }
  }

  function showAddService() {
    // Bottom sheet form
    let overlay = document.createElement('div');
    overlay.className = 'service-form-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="service-form-sheet">'
      + '<h3>Новая услуга</h3>'
      + '<div class="form-field"><label>Название</label><input id="newServiceName" placeholder="Маникюр"></div>'
      + '<div class="form-field"><label>Длительность (мин)</label><input id="newServiceDuration" type="number" value="60"></div>'
      + '<div class="form-field"><label>Цена (₽, необязательно)</label><input id="newServicePrice" type="number" placeholder="0"></div>'
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

      await apiMethod('POST', '/services', { name: name, duration_minutes: duration, price: price || undefined });

      // Remove form
      let overlay = document.querySelector('.service-form-overlay');
      if (overlay) overlay.remove();

      loadServices();
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

  // === SETTINGS ===

  async function loadSettings() {
    let appleSettings = null;
    try {
      let profile = await apiFetch('/profile');
      currentMasterSlug = profile.booking_slug || '';
      $('bookingLink').value = window.location.origin + '/book/' + profile.booking_slug;
    } catch (err) {
      $('bookingLink').value = 'Не удалось загрузить';
    }

    // Google Calendar status
    try {
      let res = await fetch('/api/calendar-sync/status', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      let data = await res.json();
      if (data.connected) {
        $('gcalStatus').innerHTML = '<span style="color:var(--success);">Подключен</span> (режим: ' + (data.binding.sync_mode || 'push') + ')';
      } else {
        $('gcalStatus').innerHTML = '<a href="#" onclick="MasterApp.connectGCal();return false;" style="color:var(--primary);font-weight:600;">Подключить</a>';
      }
    } catch (_) {
      $('gcalStatus').textContent = 'Не удалось проверить';
    }

    // Reminder settings
    try {
      let settings = await apiFetch('/settings');
      appleSettings = settings;
      $('reminderSettings').innerHTML = 'Напоминания за: <strong>' + (settings.reminder_hours || [24, 2]).join(', ') + '</strong> ч.'
        + (settings.quiet_hours_start ? '<br>Тихие часы: ' + settings.quiet_hours_start + ' — ' + settings.quiet_hours_end : '');
    } catch (_) {
      $('reminderSettings').textContent = 'Не удалось загрузить';
    }

    renderAppleCalendarSettings(appleSettings);
    await loadAvailabilitySettings();
  }

  async function loadAvailabilitySettings() {
    const rulesEl = $('availabilityRules');
    const exclusionsEl = $('availabilityExclusions');
    if (!rulesEl || !exclusionsEl) return;

    rulesEl.innerHTML = '<p class="settings-hint">Загрузка...</p>';
    exclusionsEl.innerHTML = '<p class="settings-hint">Загрузка...</p>';

    try {
      const [rules, exclusions] = await Promise.all([
        apiFetch('/availability'),
        apiFetch('/availability/exclusions')
      ]);

      if (!rules.length) {
        rulesEl.innerHTML = '<p class="settings-hint">Пока нет рабочих окон. Добавьте первое окно выше.</p>';
      } else {
        rulesEl.innerHTML = rules.map(function (rule) {
          return '<div class="settings-list-item">'
            + '<div>'
            + '<strong>' + DAY_LABELS[rule.day_of_week] + '</strong>'
            + '<div class="settings-hint">' + rule.start_time.slice(0, 5) + ' - ' + rule.end_time.slice(0, 5)
            + ' · шаг ' + rule.slot_granularity_minutes + ' мин</div>'
            + '</div>'
            + '<button class="btn-small btn-cancel" onclick="MasterApp.deleteAvailabilityRule(' + rule.id + ')">Удалить</button>'
            + '</div>';
        }).join('');
      }

      if (!exclusions.length) {
        exclusionsEl.innerHTML = '<p class="settings-hint">Нет выходных дат.</p>';
      } else {
        exclusionsEl.innerHTML = exclusions.map(function (item) {
          const reason = item.reason ? ' — ' + escapeHtml(item.reason) : '';
          return '<div class="settings-list-item">'
            + '<div><strong>' + item.date + '</strong><div class="settings-hint">' + reason + '</div></div>'
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
      const day = Number($('availabilityDay').value);
      const start = $('availabilityStart').value;
      const end = $('availabilityEnd').value;
      const step = Number($('availabilityStep').value || 30);

      if (!start || !end) {
        showToast('Выберите время начала и конца');
        return;
      }

      await apiMethod('POST', '/availability', {
        day_of_week: day,
        start_time: start,
        end_time: end,
        slot_granularity_minutes: step
      });
      await loadAvailabilitySettings();
      showToast('Окно добавлено');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function deleteAvailabilityRule(ruleId) {
    try {
      await apiMethod('DELETE', '/availability/' + ruleId);
      await loadAvailabilitySettings();
      showToast('Окно удалено');
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
      let res = await fetch('/api/calendar-sync/connect', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      let data = await res.json();
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
    saveService: saveService,
    bootstrapDefaultServices: bootstrapDefaultServices,
    copyLink: copyLink,
    copyAppleLink: copyAppleLink,
    openAppleCalendar: openAppleCalendar,
    connectGCal: connectGCal,
    enableAppleCalendar: enableAppleCalendar,
    rotateAppleCalendar: rotateAppleCalendar,
    disableAppleCalendar: disableAppleCalendar,
    addAvailabilityRule: addAvailabilityRule,
    deleteAvailabilityRule: deleteAvailabilityRule,
    addAvailabilityExclusion: addAvailabilityExclusion,
    deleteAvailabilityExclusion: deleteAvailabilityExclusion,
    logout: logout,
    hideToast: hideToast
  };
})();
