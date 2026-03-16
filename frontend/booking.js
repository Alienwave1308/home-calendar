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

  // VK Mini App integration
  const urlParams = new URLSearchParams(window.location.search);
  const hasVkSession = Boolean(window.vkBridge && urlParams.get('vk_user_id'));

  if (!isCypress && !hasTelegramSession && !hasVkSession) {
    document.body.innerHTML = '<main style="max-width:480px;margin:64px auto;padding:24px;text-align:center;font-family:system-ui,-apple-system,sans-serif;">'
      + '<h1 style="margin-bottom:12px;">Откройте через Telegram или ВКонтакте</h1>'
      + '<p style="margin:0;color:#5b6575;">Форма записи доступна только в Telegram Mini App или VK Mini App.</p>'
      + '</main>';
    return;
  }

  if (tg && hasTelegramSession) {
    tg.ready();
    tg.expand();
  }

  if (hasVkSession) {
    try { window.vkBridge.send('VKWebAppInit'); } catch (e) { /* VKWebAppInit optional */ }
  }

  async function initAuth() {
    if (localStorage.getItem('token')) return true;

    if (hasTelegramSession) {
      let res = await fetch(API_BASE + '/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData })
      });
      if (res.ok) {
        let data = await res.json();
        if (data.token) { localStorage.setItem('token', data.token); return true; }
      }
      let errData = await res.json().catch(function () { return {}; });
      throw new Error(errData.error || 'Ошибка авторизации Telegram (' + res.status + ')');
    }

    if (hasVkSession) {
      let res = await fetch(API_BASE + '/auth/vk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchParams: window.location.search.slice(1) })
      });
      if (res.ok) {
        let data = await res.json();
        if (data.token) { localStorage.setItem('token', data.token); return true; }
      }
      let errData = await res.json().catch(function () { return {}; });
      throw new Error(errData.error || 'Ошибка авторизации ВКонтакте (' + res.status + ')');
    }

    return false;
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
  let masterSettings = { min_booking_notice_minutes: 60 };
  let services = [];
  let visibleServices = [];
  // Multi-select: list of selected services (zones freely combined; complex is solo)
  let selectedServices = [];
  // Legacy alias kept for reschedule flow compatibility
  let selectedService = null;
  let selectedDate = null;
  let selectedSlot = null;
  let selectedPricing = null;
  let lastCreatedBookingId = null;
  let methodFilter = 'all';
  let categoryFilter = 'all';
  let rescheduleBookingId = null;
  let calendarMonthAnchor = null;

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
  let MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

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

  function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
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

  // Returns true if the current selection contains a complex
  function selectionHasComplex() {
    return selectedServices.some(function (s) {
      return parseServiceTaxonomy(s).category === 'Комплексы';
    });
  }

  // Returns true if the current selection contains any zone
  function selectionHasZone() {
    return selectedServices.some(function (s) {
      return parseServiceTaxonomy(s).category === 'Услуги';
    });
  }

  // Compute totals from selectedServices
  function selectionTotals() {
    const totalMinutes = selectedServices.reduce(function (acc, s) { return acc + Number(s.duration_minutes || 0); }, 0);
    const totalPrice = selectedServices.reduce(function (acc, s) { return acc + Number(s.price || 0); }, 0);
    return { totalMinutes: totalMinutes, totalPrice: totalPrice };
  }

  function updateSelectionBar() {
    const bar = $('selectionBar');
    if (!selectedServices.length) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';

    const count = selectedServices.length;
    const totals = selectionTotals();
    $('selectionBarCount').textContent = count + ' ' + (count === 1 ? 'услуга' : count < 5 ? 'услуги' : 'услуг');

    let metaParts = [totals.totalMinutes + ' мин'];
    if (totals.totalPrice > 0) {
      metaParts.push(formatPriceRub(totals.totalPrice) + ' ₽');
    }
    $('selectionBarMeta').textContent = metaParts.join(' · ');
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
      updateSelectionBar();
      return;
    }

    $('servicesEmpty').style.display = 'none';
    const hasComplex = selectionHasComplex();
    const hasZone = selectionHasZone();

    let html = '';
    visibleServices.forEach(function (s) {
      const tax = parseServiceTaxonomy(s);
      const isComplex = tax.category === 'Комплексы';
      const isSelected = selectedServices.some(function (sel) { return sel.id === s.id; });

      // Disable condition:
      // - complex disabled if any zone already selected
      // - zone disabled if any complex already selected
      // - complex disabled if another complex is selected (and this one isn't it)
      const isDisabled = (!isSelected) && (
        (isComplex && hasZone) ||
        (!isComplex && hasComplex) ||
        (isComplex && hasComplex)
      );

      let priceText = s.price ? formatPriceRub(s.price) + ' ₽' : '';
      const cardClass = 'service-card'
        + (isSelected ? ' service-card--selected' : '')
        + (isDisabled ? ' service-card--disabled' : '');
      const onclickAttr = isDisabled ? '' : ' onclick="BookingApp.toggleService(' + s.id + ')"';

      html += '<div class="' + cardClass + '" data-id="' + s.id + '"' + onclickAttr + '>'
        + (isSelected ? '<span class="service-card-check">✓</span>' : '')
        + '<div class="service-info">'
        + '<h3>' + escapeHtml(s.name) + '</h3>'
        + '<span class="service-meta">' + tax.category + ' · ' + s.duration_minutes + ' мин</span>'
        + '</div>'
        + (priceText ? '<span class="service-price">' + (isDisabled ? '<span style="opacity:.4">' + priceText + '</span>' : priceText) + '</span>' : '')
        + '</div>';
    });
    $('servicesList').innerHTML = html;
    updateSelectionBar();
  }

  // Toggle a service in/out of the selection (multi-select with complex rules)
  function toggleService(serviceId) {
    const service = services.find(function (s) { return s.id === serviceId; });
    if (!service) return;

    const tax = parseServiceTaxonomy(service);
    const isComplex = tax.category === 'Комплексы';
    const alreadySelected = selectedServices.some(function (s) { return s.id === serviceId; });

    if (alreadySelected) {
      // Deselect
      selectedServices = selectedServices.filter(function (s) { return s.id !== serviceId; });
    } else if (isComplex) {
      // Complex: can only be selected alone; clears everything else
      selectedServices = [service];
    } else {
      // Zone: cannot be added if a complex is selected
      if (selectionHasComplex()) return;
      selectedServices.push(service);
    }

    renderServices();
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

  // Called by "Далее →" in the selection bar — move to slot picking
  function proceedToSlots() {
    if (!selectedServices.length) return;
    // Set legacy alias to the first selected service (used in reschedule + calendar export)
    selectedService = selectedServices[0];

    // Header in step 2: show service names as chips
    const totals = selectionTotals();
    if (selectedServices.length === 1) {
      $('selectedServiceName').textContent = selectedService.name;
      $('selectedServicesChips').style.display = 'none';
    } else {
      $('selectedServiceName').textContent = selectedServices.length + ' услуги · ' + totals.totalMinutes + ' мин';
      const chipsEl = $('selectedServicesChips');
      chipsEl.innerHTML = selectedServices.map(function (s) {
        return '<span class="service-chip">' + escapeHtml(s.name) + '</span>';
      }).join('');
      chipsEl.style.display = 'flex';
    }

    showStep('stepSlots');
    calendarMonthAnchor = startOfMonth(startOfToday());
    renderDateStrip();
    selectDate(toDateStr(new Date()));
  }

  // Legacy single-service select (used only in reschedule flow)
  function selectService(serviceId) {
    selectedService = services.find(function (s) { return s.id === serviceId; });
    if (!selectedService) return;
    selectedServices = [selectedService];

    $('selectedServiceName').textContent = selectedService.name;
    $('selectedServicesChips').style.display = 'none';
    showStep('stepSlots');
    calendarMonthAnchor = startOfMonth(startOfToday());
    renderDateStrip();
    selectDate(toDateStr(new Date()));
  }

  // === STEP 2: DATE & SLOTS ===

  function renderDateStrip() {
    const gridEl = $('dateStrip');
    if (!gridEl) return;

    const today = startOfToday();
    const monthLimitStart = startOfMonth(today);
    const monthLimitEnd = startOfMonth(endOfMonth(today));
    if (!calendarMonthAnchor) {
      calendarMonthAnchor = selectedDate
        ? startOfMonth(new Date(selectedDate + 'T00:00:00'))
        : monthLimitStart;
    }
    if (calendarMonthAnchor < monthLimitStart) calendarMonthAnchor = monthLimitStart;
    if (calendarMonthAnchor > monthLimitEnd) calendarMonthAnchor = monthLimitEnd;

    const monthStart = startOfMonth(calendarMonthAnchor);
    const monthEnd = endOfMonth(monthStart);
    const visibleMonth = monthStart.getMonth();
    const visibleYear = monthStart.getFullYear();

    const labelEl = $('calMonth');
    if (labelEl) {
      labelEl.textContent = MONTH_NAMES[visibleMonth] + ' ' + visibleYear;
    }

    const prevEl = $('calPrev');
    if (prevEl) {
      prevEl.disabled = monthStart <= monthLimitStart;
    }
    const nextEl = $('calNext');
    if (nextEl) {
      nextEl.disabled = monthStart >= monthLimitEnd;
    }

    const firstWeekDay = (monthStart.getDay() + 6) % 7; // Monday-first
    const daysInMonth = monthEnd.getDate();
    const allowedEnd = endOfMonth(today);
    let html = '';

    for (let i = 0; i < firstWeekDay; i++) {
      html += '<div class="calendar-cell calendar-cell--empty" aria-hidden="true"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(visibleYear, visibleMonth, day);
      const ds = toDateStr(dateObj);
      const inAllowedRange = dateObj >= today && dateObj <= allowedEnd;
      const isActive = ds === selectedDate;
      const classes = ['calendar-cell'];
      if (isActive) classes.push('active');
      if (!inAllowedRange) classes.push('disabled');
      const disabledAttr = inAllowedRange ? '' : ' disabled';
      html += '<button type="button" class="' + classes.join(' ') + '" data-date="' + ds + '"' + disabledAttr
        + ' onclick="BookingApp.selectDate(\'' + ds + '\')">'
        + '<span>' + day + '</span>'
        + '</button>';
    }

    const totalCells = firstWeekDay + daysInMonth;
    const tail = (7 - (totalCells % 7)) % 7;
    for (let j = 0; j < tail; j++) {
      html += '<div class="calendar-cell calendar-cell--empty" aria-hidden="true"></div>';
    }

    gridEl.innerHTML = html;
  }

  function shiftCalendarMonth(diff) {
    const base = calendarMonthAnchor || startOfMonth(startOfToday());
    const candidate = startOfMonth(new Date(base.getFullYear(), base.getMonth() + diff, 1));
    const minMonth = startOfMonth(startOfToday());
    const maxMonth = startOfMonth(endOfMonth(startOfToday()));
    if (candidate < minMonth || candidate > maxMonth) {
      showToast('Доступны даты только до конца текущего месяца');
      return;
    }
    calendarMonthAnchor = candidate;
    renderDateStrip();
  }

  async function selectDate(dateStr) {
    const parsedDate = new Date(dateStr + 'T00:00:00');
    const today = startOfToday();
    const allowedEnd = endOfMonth(today);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate < today || parsedDate > allowedEnd) {
      showToast('Дата недоступна для записи');
      return;
    }

    selectedDate = dateStr;
    selectedSlot = null;
    calendarMonthAnchor = startOfMonth(parsedDate);
    renderDateStrip();

    // Load slots
    $('slotsList').innerHTML = renderSlotSkeletons();
    $('slotsEmpty').style.display = 'none';

    try {
      const totals = selectionTotals();
      const primaryId = selectedService ? selectedService.id : (selectedServices[0] && selectedServices[0].id);
      let slotsUrl = '/public/master/' + slug + '/slots?service_id=' + primaryId + '&date_from=' + dateStr + '&date_to=' + dateStr;
      if (totals.totalMinutes > 0 && selectedServices.length > 1) {
        slotsUrl += '&duration_minutes=' + totals.totalMinutes;
      }
      let data = await apiFetch(slotsUrl);
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

    // Build service list block for confirm screen
    const confirmServicesBlock = $('confirmServicesBlock');
    if (selectedServices.length > 1) {
      let blockHtml = selectedServices.map(function (s, idx) {
        return '<div class="confirm-row">'
          + '<span class="confirm-label">' + (idx === 0 ? 'Услуги' : '') + '</span>'
          + '<span class="confirm-value">' + escapeHtml(s.name) + '</span>'
          + '</div>';
      }).join('');
      confirmServicesBlock.innerHTML = blockHtml;
    } else {
      confirmServicesBlock.innerHTML = '<div class="confirm-row">'
        + '<span class="confirm-label">Услуга</span>'
        + '<span id="confirmService" class="confirm-value">' + escapeHtml(selectedService.name) + '</span>'
        + '</div>';
    }

    const totals = selectionTotals();
    $('confirmDate').textContent = formatDate(selectedSlot.start);
    $('confirmTime').textContent = formatTime(selectedSlot.start) + ' — ' + formatTime(selectedSlot.end);
    $('confirmDuration').textContent = totals.totalMinutes + ' мин';

    if (totals.totalPrice > 0) {
      $('confirmPriceRow').style.display = '';
      $('confirmPrice').textContent = formatPriceRub(totals.totalPrice) + ' ₽';
      $('confirmDiscountRow').style.display = 'none';
      $('confirmFinalPriceRow').style.display = 'none';
    } else {
      $('confirmPriceRow').style.display = 'none';
      $('confirmDiscountRow').style.display = 'none';
      $('confirmFinalPriceRow').style.display = 'none';
    }

    $('confirmNote').value = '';
    if ($('confirmPromoCode')) $('confirmPromoCode').value = '';
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
    const d = new Date(selectedDate + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return;

    const nextDateObj = new Date(d);
    nextDateObj.setDate(nextDateObj.getDate() + 1);

    const monthEnd = endOfMonth(startOfToday());
    if (nextDateObj > monthEnd) {
      showToast('Доступны даты только до конца текущего месяца');
      return;
    }

    const next = toDateStr(nextDateObj);
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
      const note = $('confirmNote').value.trim();
      const promoCodeValue = $('confirmPromoCode') ? $('confirmPromoCode').value.trim().toUpperCase() : '';
      let body = {
        service_ids: selectedServices.map(function (s) { return s.id; }),
        start_at: selectedSlot.start,
        client_note: note || undefined
      };
      if (promoCodeValue) {
        body.promo_code = promoCodeValue;
      }

      const created = await apiPost('/public/master/' + slug + '/book', body);
      selectedPricing = created.pricing || null;

      hideLoader();
      const serviceNamesText = selectedServices.length > 1
        ? selectedServices.map(function (s) { return s.name; }).join(', ')
        : selectedService.name;
      $('doneDetails').textContent = serviceNamesText + '\n'
        + formatDate(selectedSlot.start) + ', ' + formatTime(selectedSlot.start) + ' — ' + formatTime(selectedSlot.end)
        + '\nАдрес: Мкр Околица д.1, квартира 60'
        + (selectedPricing && selectedPricing.final_price !== undefined
          ? '\nСтоимость: ' + formatPriceRub(selectedPricing.final_price) + ' ₽'
          : '')
        + (selectedPricing && selectedPricing.promo_code
          ? '\nПромокод: ' + selectedPricing.promo_code
            + (selectedPricing.promo_reward_type === 'percent' && selectedPricing.promo_discount_percent
              ? ' (скидка ' + selectedPricing.promo_discount_percent + '%)'
              : '')
            + (selectedPricing.promo_reward_type === 'gift_service' && selectedPricing.promo_gift_service_name
              ? ' (подарок: ' + selectedPricing.promo_gift_service_name + ')'
              : '')
          : '');
      lastCreatedBookingId = created.id || null;
      setupCalendarExport(note, lastCreatedBookingId);
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
      if (!localStorage.getItem('token')) {
        await initAuth();
      }
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
        const basePrice = b.base_price !== null && b.base_price !== undefined
          ? Number(b.base_price)
          : (b.service_price !== null && b.service_price !== undefined ? Number(b.service_price) : null);
        const finalPrice = b.final_price !== null && b.final_price !== undefined ? Number(b.final_price) : null;
        const discountAmount = Number(b.discount_amount || 0);
        const hasPrice = finalPrice !== null && Number.isFinite(finalPrice);
        let promoText = '';
        if (b.promo_code) {
          promoText = 'Промокод: ' + escapeHtml(b.promo_code);
          if (b.promo_reward_type === 'percent' && b.discount_percent > 0) {
            promoText += ' (−' + b.discount_percent + '%)';
          } else if (b.promo_reward_type === 'gift_service' && b.promo_gift_service_name) {
            promoText += ' (подарок: ' + escapeHtml(b.promo_gift_service_name) + ')';
          }
        }

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
          + (hasPrice
            ? '<span class="my-booking-price">Стоимость: '
              + (discountAmount > 0 && basePrice !== null && basePrice > finalPrice
                ? '<s>' + formatPriceRub(basePrice) + ' ₽</s> → ' + formatPriceRub(finalPrice) + ' ₽'
                : formatPriceRub(finalPrice) + ' ₽')
              + '</span>'
            : '')
          + (promoText ? '<span class="my-booking-price">' + promoText + '</span>' : '')
          + '</div>'
          + actions
          + '</div>';
      });
      $('myBookingsList').innerHTML = html;
    } catch (err) {
      $('myBookingsList').innerHTML = '';
      if (err.message && (err.message.includes('No token') || err.message.includes('Access denied') || err.message.includes('авторизации'))) {
        showToast('Не удалось войти. Закройте и откройте приложение заново.');
      } else {
        showToast('Ошибка загрузки записей: ' + err.message);
      }
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
      calendarMonthAnchor = startOfMonth(startOfToday());
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
    selectedServices = [];
    selectedService = null;
    selectedDate = null;
    selectedSlot = null;
    selectedPricing = null;
    rescheduleBookingId = null;
    calendarMonthAnchor = startOfMonth(startOfToday());
    if ($('confirmPromoCode')) $('confirmPromoCode').value = '';
    if ($('confirmNote')) $('confirmNote').value = '';
    renderServices();
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
      calendarMonthAnchor = startOfMonth(new Date(selectedDate + 'T00:00:00'));
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
    initAuth().then(function () { loadMaster(); }).catch(function (err) {
      showToast('Ошибка авторизации: ' + err.message);
      loadMaster();
    });
  } else {
    $('servicesList').innerHTML = '';
    $('servicesEmpty').style.display = '';
    $('servicesEmpty').querySelector('p').textContent = 'Некорректная ссылка. Попросите мастера прислать правильную ссылку для записи.';
  }

  // Public API
  window.BookingApp = {
    toggleService: toggleService,
    proceedToSlots: proceedToSlots,
    selectService: selectService, // kept for reschedule flow
    selectDate: selectDate,
    selectSlot: selectSlot,
    nextDate: nextDate,
    shiftCalendarMonth: shiftCalendarMonth,
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
