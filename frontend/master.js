/* eslint-disable no-unused-vars */
/* global navigator */
/**
 * Master Panel — manage bookings, services, and settings.
 */

(function () {
  'use strict';

  let API_BASE = '/api/master';
  let token = localStorage.getItem('token') || '';

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
    confirmed: 'Подтверждена',
    completed: 'Завершена',
    canceled: 'Отменена'
  };

  function formatDateTime(iso) {
    let d = new Date(iso);
    return d.toLocaleDateString('ru-RU') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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
    let actions = '';
    if (b.status === 'pending') {
      actions = '<button class="btn-small btn-confirm" onclick="MasterApp.updateBooking(' + b.id + ',\'confirmed\')">Подтвердить</button>'
        + '<button class="btn-small btn-cancel" onclick="MasterApp.updateBooking(' + b.id + ',\'canceled\')">Отклонить</button>';
    } else if (b.status === 'confirmed') {
      actions = '<button class="btn-small btn-complete" onclick="MasterApp.updateBooking(' + b.id + ',\'completed\')">Завершить</button>'
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

  // === SETTINGS ===

  async function loadSettings() {
    try {
      let profile = await apiFetch('/profile');
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
      $('reminderSettings').innerHTML = 'Напоминания за: <strong>' + (settings.reminder_hours || [24, 2]).join(', ') + '</strong> ч.'
        + (settings.quiet_hours_start ? '<br>Тихие часы: ' + settings.quiet_hours_start + ' — ' + settings.quiet_hours_end : '');
    } catch (_) {
      $('reminderSettings').textContent = 'Не удалось загрузить';
    }
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
    showAddService: showAddService,
    saveService: saveService,
    copyLink: copyLink,
    connectGCal: connectGCal,
    logout: logout,
    hideToast: hideToast
  };
})();
