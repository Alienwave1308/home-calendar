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
  let masterSettings = { first_visit_discount_percent: 15, min_booking_notice_minutes: 60 };
  let services = [];
  let visibleServices = [];
  let selectedService = null;
  let selectedDate = null;
  let selectedSlot = null;
  let selectedPricing = null;
  let lastCreatedBookingId = null;
  let isFirstVisitClient = false;
  let methodFilter = 'all';
  let categoryFilter = 'all';
  let rescheduleBookingId = null;
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

  function parseServiceTaxonomy(service) {
    const name = String(service && service.name ? service.name : '');
    const description = String(service && service.description ? service.description : '');
    const source = (name + ' ' + description).toLowerCase();
    const method = source.includes('воск') || source.includes('wax') ? 'wax' : 'sugar';
    const category = description.includes('Комплексы') || /комплекс/i.test(name) ? 'Комплексы' : 'Услуги';
    return { method: method, category: category };
  }

  function formatDate(dateStr) {
    let d = new Date(dateStr);
    const timezone = (master && master.timezone) || 'Asia/Novosibirsk';
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short'
    }).format(d);
  }

  function formatTime(isoStr) {
    let d = new Date(isoStr);
    const timezone = (master && master.timezone) || 'Asia/Novosibirsk';
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(d);
  }

  function formatPriceRub(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(num));
  }

  function toDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
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
      masterSettings = data.settings || masterSettings;
      services = data.services || [];

      $('masterName').textContent = 'Лера';
      try {
        const bookings = await apiFetch('/client/bookings');
        isFirstVisitClient = Array.isArray(bookings) && bookings.filter(function (b) {
          return Number(b.master_id) === Number(master.id);
        }).length === 0;
      } catch (_) {
        isFirstVisitClient = false;
      }

      if (isFirstVisitClient && Number(masterSettings.first_visit_discount_percent || 0) > 0) {
        $('firstVisitBanner').style.display = '';
        $('firstVisitBannerText').textContent = 'Скидка на первый визит: '
          + Number(masterSettings.first_visit_discount_percent) + '%';
      } else {
        $('firstVisitBanner').style.display = 'none';
      }

      if (services.length === 0) {
        $('servicesList').innerHTML = '';
        $('servicesEmpty').style.display = '';
        return;
      }

      $('serviceMethodTabs').style.display = '';
      $('serviceCategoryTabs').style.display = '';
      setMethodFilter('all', true);
      setCategoryFilter('all', true);
      renderServices();

    } catch (err) {
      $('servicesList').innerHTML = '';
      showToast('Не удалось загрузить данные: ' + err.message);
    }
  }

  function renderServices() {
    visibleServices = services.filter(function (s) {
      const tax = parseServiceTaxonomy(s);
      const passMethod = methodFilter === 'all' || tax.method === methodFilter;
      const passCategory = categoryFilter === 'all' || tax.category === categoryFilter;
      return passMethod && passCategory;
    });

    if (!visibleServices.length) {
      $('servicesList').innerHTML = '';
      $('servicesEmpty').style.display = '';
      $('servicesEmpty').querySelector('p').textContent = 'По выбранным фильтрам услуг нет';
      return;
    }

    $('servicesEmpty').style.display = 'none';
    let html = '';
    visibleServices.forEach(function (s) {
      let priceText = s.price ? s.price + ' ₽' : '';
      let discountedText = '';
      const tax = parseServiceTaxonomy(s);
      if (isFirstVisitClient && s.price && Number(masterSettings.first_visit_discount_percent || 0) > 0) {
        const finalPrice = Math.max(0, Number(s.price) - (Number(s.price) * Number(masterSettings.first_visit_discount_percent) / 100));
        discountedText = '<span class="service-meta">Первый визит: ' + Math.round(finalPrice) + ' ₽</span>';
      }
      html += '<div class="service-card" data-id="' + s.id + '" onclick="BookingApp.selectService(' + s.id + ')">'
        + '<div class="service-info">'
        + '<h3>' + escapeHtml(s.name) + '</h3>'
        + '<span class="service-meta">' + tax.category + ' · ' + s.duration_minutes + ' мин</span>'
        + discountedText
        + '</div>'
        + (priceText ? '<span class="service-price">' + priceText + '</span>' : '')
        + '</div>';
    });
    $('servicesList').innerHTML = html;
  }

  function setMethodFilter(next, silent) {
    methodFilter = next;
    document.querySelectorAll('#serviceMethodTabs .service-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.method === next);
    });
    if (!silent) renderServices();
  }

  function setCategoryFilter(next, silent) {
    categoryFilter = next;
    document.querySelectorAll('#serviceCategoryTabs .service-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.category === next);
    });
    if (!silent) renderServices();
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
    selectedPricing = null;

    if (rescheduleBookingId) {
      confirmReschedule();
      return;
    }

    // Go to confirm
    $('confirmService').textContent = selectedService.name;
    $('confirmDate').textContent = formatDate(selectedSlot.start);
    $('confirmTime').textContent = formatTime(selectedSlot.start) + ' — ' + formatTime(selectedSlot.end);
    $('confirmDuration').textContent = selectedService.duration_minutes + ' мин';

    if (selectedService.price) {
      $('confirmPriceRow').style.display = '';
      $('confirmPrice').textContent = selectedService.price + ' ₽';
      const discountPercent = isFirstVisitClient ? Number(masterSettings.first_visit_discount_percent || 0) : 0;
      if (discountPercent > 0) {
        const finalPrice = Math.max(0, Number(selectedService.price) - (Number(selectedService.price) * discountPercent / 100));
        $('confirmDiscountRow').style.display = '';
        $('confirmDiscount').textContent = '-' + discountPercent + '%';
        $('confirmFinalPriceRow').style.display = '';
        $('confirmFinalPrice').textContent = Math.round(finalPrice) + ' ₽';
      } else {
        $('confirmDiscountRow').style.display = 'none';
        $('confirmFinalPriceRow').style.display = 'none';
      }
    } else {
      $('confirmPriceRow').style.display = 'none';
      $('confirmDiscountRow').style.display = 'none';
      $('confirmFinalPriceRow').style.display = 'none';
    }

    $('confirmNote').value = '';
    showStep('stepConfirm');
  }

  async function confirmReschedule() {
    if (!selectedSlot || !rescheduleBookingId) return;
    try {
      const token = localStorage.getItem('token') || '';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch(API_BASE + '/client/bookings/' + rescheduleBookingId + '/reschedule', {
        method: 'PATCH',
        headers: headers,
        body: JSON.stringify({ new_start_at: selectedSlot.start })
      });
      if (!res.ok) {
        const data = await res.json().catch(function () { return {}; });
        throw new Error(data.error || 'Не удалось перенести запись');
      }
      rescheduleBookingId = null;
      showToast('Запись перенесена');
      await showMyBookings();
    } catch (err) {
      showToast(err.message);
    }
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
      const created = await apiPost('/public/master/' + slug + '/book', body);
      selectedPricing = created.pricing || null;

      hideLoader();
      $('doneDetails').textContent = selectedService.name + '\n'
        + formatDate(selectedSlot.start) + ', ' + formatTime(selectedSlot.start) + ' — ' + formatTime(selectedSlot.end)
        + '\nАдрес: Мкр Околица д.1, квартира 60'
        + (selectedPricing && selectedPricing.first_visit_discount_percent
          ? '\nСкидка: ' + selectedPricing.first_visit_discount_percent + '%, итог: ' + selectedPricing.final_price + ' ₽'
            + '\nПри отмене первой записи скидка аннулируется.'
          : '');
      lastCreatedBookingId = created.id || null;
      setupCalendarExport(note, lastCreatedBookingId);
      showStep('stepDone');

      // Notify Telegram
      if (tg) {
        const alertText = selectedPricing && selectedPricing.first_visit_discount_percent
          ? 'Вы успешно записаны! Первая запись со скидкой. При отмене первой записи скидка аннулируется.'
          : 'Вы успешно записаны!';
        tg.showAlert(alertText);
      }

    } catch (err) {
      hideLoader();
      btn.disabled = false;
      btn.textContent = 'Записаться';
      showToast(err.message);
    }
  }

  function setupCalendarExport(note, bookingId) {
    const googleLink = $('doneGoogleLink');
    const appleBtn = $('doneAppleBtn');
    if (!googleLink || !appleBtn || !selectedSlot || !selectedService || !master) return;

    const address = 'Мкр Околица д.1, квартира 60';
    const calendarName = 'RoVa Epil';
    const eventTitle = 'Запись на депиляцию: ' + selectedService.name;
    const descriptionParts = [
      'Услуга: ' + selectedService.name,
      'Мастер: ' + (master.display_name || ''),
      'Адрес: ' + address,
      note ? ('Комментарий клиента: ' + note) : ''
    ].filter(Boolean);
    const description = descriptionParts.join('\n');
    const timezone = master.timezone || 'UTC';

    const googleUrl = exportUtils.buildGoogleCalendarUrl({
      title: eventTitle,
      details: description,
      location: address,
      calendarName: calendarName,
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

    appleBtn.onclick = async function () {
      try {
        if (!bookingId) {
          throw new Error('Идентификатор записи не найден');
        }
        const linkData = await apiFetch('/client/bookings/' + bookingId + '/calendar-feed');
        const feedPath = linkData && linkData.feed_path ? String(linkData.feed_path) : '';
        if (!feedPath) {
          throw new Error('Ссылка календаря не сформирована');
        }

        const httpsUrl = new window.URL(feedPath, window.location.origin).toString();
        const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');

        // Telegram Mini App openLink accepts only http/https URLs.
        if (tg && typeof tg.openLink === 'function') {
          tg.openLink(httpsUrl, { try_instant_view: false });
          return;
        }
        window.location.href = webcalUrl;
      } catch (error) {
        showToast('Не удалось открыть экспорт: ' + error.message);
      }
    };
  }

  // === MY BOOKINGS ===

  let STATUS_LABELS = {
    pending: 'Ожидает',
    confirmed: 'Запланировано',
    completed: 'Выполнено',
    canceled: 'Отменено'
  };

  async function showMyBookings() {
    showStep('stepMyBookings');
    $('myBookingsList').innerHTML = renderServiceSkeletons();
    $('myBookingsEmpty').style.display = 'none';

    try {
      let bookings = await apiFetch('/client/bookings');

      if (!bookings.length) {
        $('myBookingsList').innerHTML = '';
        $('myBookingsEmpty').style.display = '';
        return;
      }

      let html = '';
      bookings.forEach(function (b) {
        let tz = b.master_timezone || (master && master.timezone) || 'Asia/Novosibirsk';
        let startDate = new Date(b.start_at);
        let dateStr = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: 'short' }).format(startDate);
        let timeStr = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(startDate);
        let endTimeStr = b.end_at ? new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(b.end_at)) : '';

        let statusClass = b.status || 'pending';
        let statusLabel = STATUS_LABELS[b.status] || b.status;

        const canExport = b.status !== 'canceled';
        const canManage = b.status === 'confirmed' || b.status === 'pending';
        let actions = '';
        if (canExport || canManage) {
          actions = '<div class="my-booking-actions">'
            + (canExport
              ? '<button class="btn-secondary" onclick="BookingApp.exportBookingToGoogle(' + b.id + ')">Экспорт в Google Calendar</button>'
                + '<button class="btn-secondary" onclick="BookingApp.exportBookingToApple(' + b.id + ')">Экспорт в Apple Calendar (.ics)</button>'
              : '')
            + (canManage
              ? '<button class="btn-secondary" onclick="BookingApp.startReschedule(' + b.id + ')">Перенести запись</button>'
                + '<button class="btn-secondary btn-cancel-booking" onclick="BookingApp.cancelBooking(' + b.id + ')">Отменить запись</button>'
              : '')
            + '</div>';
        }

        html += '<div class="my-booking-card">'
          + '<div class="my-booking-header">'
          + '<strong>' + escapeHtml(b.service_name || 'Услуга') + '</strong>'
          + '<span class="booking-status-badge ' + statusClass + '">' + statusLabel + '</span>'
          + '</div>'
          + '<div class="my-booking-meta">'
          + '<span>' + dateStr + ', ' + timeStr + (endTimeStr ? ' — ' + endTimeStr : '') + '</span>'
          + (b.service_price !== null && b.service_price !== undefined
            ? '<span class="my-booking-price">Стоимость: '
              + (b.discount_percent > 0
                ? '<s>' + formatPriceRub(b.service_price) + ' ₽</s> → ' + formatPriceRub(b.final_price) + ' ₽ (скидка ' + b.discount_percent + '%)'
                : formatPriceRub(b.final_price) + ' ₽')
              + '</span>'
            : '')
          + '</div>'
          + actions
          + '</div>';
      });
      $('myBookingsList').innerHTML = html;
    } catch (err) {
      $('myBookingsList').innerHTML = '';
      showToast('Ошибка загрузки записей: ' + err.message);
    }
  }

  async function cancelBooking(bookingId) {
    if (!window.confirm('Вы уверены, что хотите отменить запись?')) return;

    try {
      let token = localStorage.getItem('token') || '';
      let headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      let res = await fetch(API_BASE + '/client/bookings/' + bookingId + '/cancel', {
        method: 'PATCH',
        headers: headers
      });
      if (!res.ok) {
        let data = await res.json().catch(function () { return {}; });
        throw new Error(data.error || 'Ошибка отмены');
      }
      showToast('Запись отменена');
      showMyBookings();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function startReschedule(bookingId) {
    try {
      const bookings = await apiFetch('/client/bookings');
      const booking = (bookings || []).find(function (b) { return Number(b.id) === Number(bookingId); });
      if (!booking) {
        showToast('Запись не найдена');
        return;
      }
      const service = services.find(function (s) { return Number(s.id) === Number(booking.service_id); });
      if (!service) {
        showToast('Услуга записи больше недоступна');
        return;
      }
      rescheduleBookingId = booking.id;
      selectedService = service;
      $('selectedServiceName').textContent = service.name;
      showStep('stepSlots');
      renderDateStrip();
      selectDate(toDateStr(new Date()));
      showToast('Выберите новый слот для переноса');
    } catch (err) {
      showToast('Ошибка загрузки записи: ' + err.message);
    }
  }

  function buildBookingExportPayload(booking) {
    const address = 'Мкр Околица д.1, квартира 60';
    const timezone = booking.master_timezone || (master && master.timezone) || 'Asia/Novosibirsk';
    const title = 'Запись на депиляцию: ' + (booking.service_name || 'Услуга');
    const details = [
      'Услуга: ' + (booking.service_name || 'Услуга'),
      'Мастер: ' + (booking.master_name || 'Лера'),
      'Адрес: ' + address,
      booking.client_note ? ('Комментарий: ' + booking.client_note) : ''
    ].filter(Boolean).join('\n');
    return {
      title: title,
      details: details,
      location: address,
      calendarName: 'RoVa Epil',
      startIso: booking.start_at,
      endIso: booking.end_at,
      timezone: timezone
    };
  }

  async function exportBookingToGoogle(bookingId) {
    try {
      const bookings = await apiFetch('/client/bookings');
      const booking = (bookings || []).find(function (b) { return Number(b.id) === Number(bookingId); });
      if (!booking) {
        showToast('Запись не найдена');
        return;
      }
      const payload = buildBookingExportPayload(booking);
      const googleUrl = exportUtils.buildGoogleCalendarUrl(payload);
      if (tg && typeof tg.openLink === 'function') {
        tg.openLink(googleUrl, { try_instant_view: false });
        return;
      }
      window.open(googleUrl, '_blank', 'noopener');
    } catch (err) {
      showToast('Не удалось открыть экспорт: ' + err.message);
    }
  }

  async function exportBookingToApple(bookingId) {
    try {
      const linkData = await apiFetch('/client/bookings/' + bookingId + '/calendar-feed');
      const feedPath = linkData && linkData.feed_path ? String(linkData.feed_path) : '';
      if (!feedPath) {
        throw new Error('Ссылка календаря не сформирована');
      }

      const httpsUrl = new window.URL(feedPath, window.location.origin).toString();
      const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');

      // Telegram Mini App openLink accepts only http/https URLs.
      if (tg && typeof tg.openLink === 'function') {
        tg.openLink(httpsUrl, { try_instant_view: false });
        return;
      }
      window.location.href = webcalUrl;
    } catch (err) {
      showToast('Не удалось открыть экспорт: ' + err.message);
    }
  }

  // === RESET ===

  function reset() {
    selectedService = null;
    selectedDate = null;
    selectedSlot = null;
    rescheduleBookingId = null;
    showStep('stepServices');
  }

  function goBack(toStepId) {
    if (toStepId === 'stepServices') {
      if (rescheduleBookingId) {
        rescheduleBookingId = null;
        showMyBookings();
        return;
      }
      rescheduleBookingId = null;
    }
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
    showMyBookings: showMyBookings,
    cancelBooking: cancelBooking,
    startReschedule: startReschedule,
    exportBookingToGoogle: exportBookingToGoogle,
    exportBookingToApple: exportBookingToApple,
    setMethodFilter: setMethodFilter,
    setCategoryFilter: setCategoryFilter,
    reset: reset,
    goBack: goBack,
    hideToast: hideToast
  };
})();
