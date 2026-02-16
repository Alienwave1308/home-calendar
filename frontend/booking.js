/* eslint-disable no-unused-vars */
/* global URLSearchParams */
/**
 * Booking Mini App — client-side booking flow.
 * Works only as Telegram Mini App.
 *
 * Flow: Select Service → Pick Date/Slot → Confirm → Done
 */

(function () {
  'use strict';

  // Telegram WebApp integration
  const tg = window.Telegram && window.Telegram.WebApp;
  const isCypress = Boolean(window.Cypress);
  const hasTelegramSession = Boolean(
    tg && (
      (typeof tg.initData === 'string' && tg.initData.length > 0)
      || (tg.initDataUnsafe && tg.initDataUnsafe.user)
    )
  );

  if (!isCypress && !hasTelegramSession) {
    document.body.innerHTML = '<main style="max-width:480px;margin:64px auto;padding:24px;text-align:center;font-family:system-ui,-apple-system,sans-serif;">'
      + '<h1 style="margin-bottom:12px;">Доступ только через Telegram</h1>'
      + '<p style="margin:0;color:#5b6575;">Откройте форму записи внутри Telegram Mini App.</p>'
      + '</main>';
    return;
  }

  if (tg) {
    tg.ready();
    tg.expand();
  }

  // Extract booking slug from URL: /book/:slug or ?slug=...
  const rawSlug = new URLSearchParams(window.location.search).get('slug')
    || window.location.pathname.split('/book/')[1]
    || '';
  const slug = String(rawSlug).split('?')[0].replace(/^\/+|\/+$/g, '');

  const API_BASE = '/api';
  const exportUtils = window.BookingExportUtils || {
    buildGoogleCalendarUrl: function () { return '#'; },
    buildIcsContent: function () { return ''; }
  };

  // State
  let master = null;
  let services = [];
  let selectedService = null;
  let selectedDate = null;
  let selectedSlot = null;
  let currentDateOffset = 0; // days from today
  const DAYS_TO_SHOW = 14;

  // === HELPERS ===

  function $(id) { return document.getElementById(id); }

  function showStep(stepId) {
    document.querySelectorAll('.step').forEach(function (s) {
      if (s.id === stepId) {
        s.style.display = '';
        s.classList.remove('step-out');
      } else {
        s.style.display = 'none';
      }
    });
  }

  function showToast(message) {
    let toast = $('networkToast');
    $('networkToastText').textContent = message;
    toast.style.display = 'flex';
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      toast.style.display = 'none';
    }, 5000);
  }

  function hideToast() {
    $('networkToast').style.display = 'none';
  }

  function showLoader() { $('fullLoader').style.display = 'flex'; }
  function hideLoader() { $('fullLoader').style.display = 'none'; }

  async function apiFetch(path) {
    let token = localStorage.getItem('token') || '';
    let headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let res = await fetch(API_BASE + path, { headers: headers });
    if (!res.ok) {
      let data = await res.json().catch(function () { return {}; });
      throw new Error(data.error || 'Ошибка сервера (' + res.status + ')');
    }
    return res.json();
  }

  async function apiPost(path, body) {
    let token = localStorage.getItem('token') || '';
    let headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let data = await res.json().catch(function () { return {}; });
      throw new Error(data.error || 'Ошибка сервера (' + res.status + ')');
    }
    return res.json();
  }

  // Format date helpers
  let DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  let MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function formatDate(dateStr) {
    let d = new Date(dateStr);
    return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
  }

  function formatTime(isoStr) {
    let d = new Date(isoStr);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function toDateStr(date) {
    return date.toISOString().slice(0, 10);
  }

  // === SKELETONS ===

  function renderServiceSkeletons() {
    let html = '';
    for (let i = 0; i < 3; i++) {
      html += '<div class="skeleton-service">'
        + '<div class="skeleton-left">'
        + '<div class="skeleton-line h16 w60"></div>'
        + '<div class="skeleton-line w40"></div>'
        + '</div>'
        + '<div class="skeleton-line h20 w30"></div>'
        + '</div>';
    }
    return html;
  }

  function renderSlotSkeletons() {
    let html = '';
    for (let i = 0; i < 6; i++) {
      html += '<div class="skeleton-slot"><div class="skeleton-line w60 h16"></div></div>';
    }
    return html;
  }

  function renderDateSkeletons() {
    let html = '';
    for (let i = 0; i < 7; i++) {
      html += '<div class="skeleton-date"></div>';
    }
    return html;
  }

  // === STEP 1: SERVICES ===

  async function loadMaster() {
    $('servicesList').innerHTML = renderServiceSkeletons();
    $('servicesEmpty').style.display = 'none';

    try {
      let data = await apiFetch('/public/master/' + slug);
      master = data.master;
      services = data.services || [];

      $('masterName').textContent = master.display_name;

      if (services.length === 0) {
        $('servicesList').innerHTML = '';
        $('servicesEmpty').style.display = '';
        return;
      }

      let html = '';
      services.forEach(function (s) {
        let priceText = s.price ? s.price + ' ₽' : '';
        html += '<div class="service-card" data-id="' + s.id + '" onclick="BookingApp.selectService(' + s.id + ')">'
          + '<div class="service-info">'
          + '<h3>' + escapeHtml(s.name) + '</h3>'
          + '<span class="service-meta">' + s.duration_minutes + ' мин</span>'
          + '</div>'
          + (priceText ? '<span class="service-price">' + priceText + '</span>' : '')
          + '</div>';
      });
      $('servicesList').innerHTML = html;

    } catch (err) {
      $('servicesList').innerHTML = '';
      showToast('Не удалось загрузить данные: ' + err.message);
    }
  }

  function selectService(serviceId) {
    selectedService = services.find(function (s) { return s.id === serviceId; });
    if (!selectedService) return;

    $('selectedServiceName').textContent = selectedService.name;
    showStep('stepSlots');
    currentDateOffset = 0;
    renderDateStrip();
    selectDate(toDateStr(new Date()));
  }

  // === STEP 2: DATE & SLOTS ===

  function renderDateStrip() {
    let html = '';
    let today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < DAYS_TO_SHOW; i++) {
      let d = new Date(today.getTime() + i * 86400000);
      let ds = toDateStr(d);
      let isActive = ds === selectedDate;
      html += '<div class="date-chip' + (isActive ? ' active' : '') + '" data-date="' + ds + '" onclick="BookingApp.selectDate(\'' + ds + '\')">'
        + '<div class="date-day">' + DAY_NAMES[d.getDay()] + '</div>'
        + '<div class="date-num">' + d.getDate() + '</div>'
        + '</div>';
    }
    $('dateStrip').innerHTML = html;
  }

  async function selectDate(dateStr) {
    selectedDate = dateStr;
    selectedSlot = null;

    // Update active chip
    document.querySelectorAll('.date-chip').forEach(function (c) {
      c.classList.toggle('active', c.dataset.date === dateStr);
    });

    // Load slots
    $('slotsList').innerHTML = renderSlotSkeletons();
    $('slotsEmpty').style.display = 'none';

    try {
      let data = await apiFetch('/public/master/' + slug + '/slots?service_id=' + selectedService.id + '&date_from=' + dateStr + '&date_to=' + dateStr);
      let slots = data.slots || data || [];

      if (slots.length === 0) {
        $('slotsList').innerHTML = '';
        $('slotsEmpty').style.display = '';
        return;
      }

      let html = '';
      slots.forEach(function (slot) {
        let time = formatTime(slot.start);
        html += '<button class="slot-btn" data-start="' + slot.start + '" data-end="' + slot.end + '" onclick="BookingApp.selectSlot(this)">'
          + time + '</button>';
      });
      $('slotsList').innerHTML = html;

    } catch (err) {
      $('slotsList').innerHTML = '';
      showToast('Ошибка загрузки слотов: ' + err.message);
    }
  }

  function selectSlot(btn) {
    document.querySelectorAll('.slot-btn').forEach(function (b) {
      b.classList.remove('selected');
    });
    btn.classList.add('selected');

    selectedSlot = {
      start: btn.dataset.start,
      end: btn.dataset.end
    };

    // Go to confirm
    $('confirmService').textContent = selectedService.name;
    $('confirmDate').textContent = formatDate(selectedSlot.start);
    $('confirmTime').textContent = formatTime(selectedSlot.start) + ' — ' + formatTime(selectedSlot.end);
    $('confirmDuration').textContent = selectedService.duration_minutes + ' мин';

    if (selectedService.price) {
      $('confirmPriceRow').style.display = '';
      $('confirmPrice').textContent = selectedService.price + ' ₽';
    } else {
      $('confirmPriceRow').style.display = 'none';
    }

    $('confirmNote').value = '';
    showStep('stepConfirm');
  }

  function nextDate() {
    if (!selectedDate) return;
    let d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    let next = toDateStr(d);
    renderDateStrip();
    selectDate(next);
    showStep('stepSlots');
  }

  // === STEP 3: CONFIRM ===

  async function confirmBooking() {
    let btn = $('btnBook');
    btn.disabled = true;
    btn.textContent = 'Записываем...';
    showLoader();

    try {
      let body = {
        service_id: selectedService.id,
        start_at: selectedSlot.start,
        client_note: $('confirmNote').value.trim() || undefined
      };

      const note = $('confirmNote').value.trim();
      await apiPost('/public/master/' + slug + '/book', body);

      hideLoader();
      $('doneDetails').textContent = selectedService.name + '\n'
        + formatDate(selectedSlot.start) + ', ' + formatTime(selectedSlot.start) + ' — ' + formatTime(selectedSlot.end);
      setupCalendarExport(note);
      showStep('stepDone');

      // Notify Telegram
      if (tg) {
        tg.showAlert('Вы успешно записаны!');
      }

    } catch (err) {
      hideLoader();
      btn.disabled = false;
      btn.textContent = 'Записаться';
      showToast(err.message);
    }
  }

  function setupCalendarExport(note) {
    const googleLink = $('doneGoogleLink');
    const appleBtn = $('doneAppleBtn');
    if (!googleLink || !appleBtn || !selectedSlot || !selectedService || !master) return;

    const eventTitle = 'Запись на депиляцию: ' + selectedService.name;
    const descriptionParts = [
      'Мастер: ' + (master.display_name || ''),
      note ? ('Комментарий клиента: ' + note) : ''
    ].filter(Boolean);
    const description = descriptionParts.join('\n');
    const timezone = master.timezone || 'UTC';

    const googleUrl = exportUtils.buildGoogleCalendarUrl({
      title: eventTitle,
      details: description,
      startIso: selectedSlot.start,
      endIso: selectedSlot.end,
      timezone: timezone
    });
    googleLink.href = googleUrl;
    googleLink.onclick = function (e) {
      if (!tg || typeof tg.openLink !== 'function') return;
      e.preventDefault();
      tg.openLink(googleUrl, { try_instant_view: false });
    };

    appleBtn.onclick = function () {
      const appleUrl = new window.URL(window.location.origin + '/api/public/export/booking.ics');
      appleUrl.searchParams.set('title', eventTitle);
      appleUrl.searchParams.set('details', description);
      appleUrl.searchParams.set('start_at', selectedSlot.start);
      appleUrl.searchParams.set('end_at', selectedSlot.end);
      appleUrl.searchParams.set('timezone', timezone);
      const href = appleUrl.toString();

      if (tg && typeof tg.openLink === 'function') {
        tg.openLink(href, { try_instant_view: false });
        return;
      }
      window.location.href = href;
    };
  }

  // === RESET ===

  function reset() {
    selectedService = null;
    selectedDate = null;
    selectedSlot = null;
    showStep('stepServices');
  }

  function goBack(toStepId) {
    showStep(toStepId);
    if (toStepId === 'stepSlots' && selectedDate) {
      renderDateStrip();
      selectDate(selectedDate);
    }
  }

  // === UTILS ===

  function escapeHtml(str) {
    let div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // === INIT ===

  if (slug) {
    loadMaster();
  } else {
    $('servicesList').innerHTML = '';
    $('servicesEmpty').style.display = '';
    $('servicesEmpty').querySelector('p').textContent = 'Некорректная ссылка. Попросите мастера прислать правильную ссылку для записи.';
  }

  // Public API
  window.BookingApp = {
    selectService: selectService,
    selectDate: selectDate,
    selectSlot: selectSlot,
    nextDate: nextDate,
    confirmBooking: confirmBooking,
    reset: reset,
    goBack: goBack,
    hideToast: hideToast
  };
})();
