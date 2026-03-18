describe('Master Panel - Promo Codes E2E', () => {
  beforeEach(() => {
    let promoCodes = [
      {
        id: 77,
        code: 'USEDONCE',
        reward_type: 'percent',
        discount_percent: 15,
        gift_service_id: null,
        usage_mode: 'single_use',
        uses_count: 1,
        is_active: false
      }
    ];

    cy.intercept('GET', /\/api\/master\/calendar.*/, {
      statusCode: 200,
      body: { bookings: [], blocks: [] }
    }).as('getCalendar');
    cy.intercept('GET', /\/api\/master\/bookings(?:\?.*)?$/, {
      statusCode: 200,
      body: []
    }).as('getBookings');

    cy.intercept('GET', /\/api\/master\/profile\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: { booking_slug: 'master-slug', display_name: 'Мастер' }
    }).as('getProfile');

    cy.intercept('GET', /\/api\/calendar-sync\/status\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: { connected: false }
    }).as('getGcalStatus');

    cy.intercept('GET', /\/api\/master\/settings\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: {
        reminder_hours: [24, 2],
        min_booking_notice_minutes: 60,
        apple_calendar_enabled: false,
        apple_calendar_token: null
      }
    }).as('getSettings');

    cy.intercept('GET', /\/api\/master\/availability\/windows\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: []
    }).as('getAvailabilityWindows');

    cy.intercept('GET', /\/api\/master\/availability\/exclusions\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: []
    }).as('getAvailabilityExclusions');

    cy.intercept('GET', /\/api\/master\/services\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: [
        { id: 1, name: 'Сахар: Голень', duration_minutes: 35, price: 800, description: 'Услуги', is_active: true },
        { id: 2, name: 'Сахар: Комплекс + ноги', duration_minutes: 70, price: 1600, description: 'Комплексы', is_active: true }
      ]
    }).as('getServices');

    cy.intercept('GET', /\/api\/master\/promo-codes\/?(?:\?.*)?$/, (req) => {
      req.reply({
        statusCode: 200,
        body: promoCodes
      });
    }).as('getPromoCodes');

    cy.intercept('POST', '/api/master/promo-codes', (req) => {
      const created = {
        id: Date.now(),
        code: String(req.body.code || '').toUpperCase(),
        reward_type: req.body.reward_type,
        discount_percent: req.body.reward_type === 'percent' ? Number(req.body.discount_percent || 0) : null,
        gift_service_id: req.body.reward_type === 'gift_service'
          ? (req.body.gift_service_id ? Number(req.body.gift_service_id) : null)
          : null,
        gift_service_name: null,
        usage_mode: req.body.usage_mode || 'always',
        uses_count: 0,
        is_active: true
      };
      promoCodes = [created].concat(promoCodes);
      req.reply({ statusCode: 201, body: created });
    }).as('createPromo');

    cy.intercept('PATCH', /\/api\/master\/promo-codes\/(\d+)/, (req) => {
      const id = Number(req.url.split('/').pop());
      const current = promoCodes.find((p) => p.id === id);
      if (!current) {
        req.reply({ statusCode: 404, body: { error: 'Promo code not found' } });
        return;
      }
      if (req.body.is_active === true && current.usage_mode === 'single_use' && Number(current.uses_count || 0) >= 1) {
        req.reply({ statusCode: 400, body: { error: 'Одноразовый промокод уже использован и не может быть включён' } });
        return;
      }

      promoCodes = promoCodes.map((promo) => (
        promo.id === id
          ? { ...promo, is_active: Boolean(req.body.is_active) }
          : promo
      ));
      req.reply({ statusCode: 200, body: promoCodes.find((p) => p.id === id) });
    }).as('togglePromo');

    cy.visit('/master.html', {
      onBeforeLoad(win) {
        win.Telegram = {
          WebApp: {
            initData: 'test-init-data',
            initDataUnsafe: { user: { id: 777, username: 'master' } },
            ready() {},
            expand() {}
          }
        };
        win.localStorage.setItem('token', 'mock-token');
        win.localStorage.setItem('authToken', 'mock-token');
      }
    });
  });

  function openSettingsTab() {
    cy.window().then((win) => {
      win.MasterApp.switchTab('settings');
    });
    cy.get('#tabSettings').should('be.visible');
    cy.get('#promoCodeValue').should('be.visible');
    cy.get('#promoCodesList', { timeout: 10000 }).should(($list) => {
      const text = $list.text();
      expect(text).not.to.contain('Загрузка');
      expect(text).not.to.contain('Не удалось загрузить промокоды');
    });
    cy.contains('#promoCodesList .settings-list-item', 'USEDONCE', { timeout: 10000 }).should('be.visible');
  }

  it('creates always and single-use promo codes from settings', () => {
    openSettingsTab();

    cy.window().then((win) => {
      win.document.getElementById('promoCodeValue').value = 'always20';
      win.document.getElementById('promoRewardType').value = 'percent';
      win.document.getElementById('promoUsageMode').value = 'always';
      win.document.getElementById('promoDiscountPercent').value = '20';
      return win.MasterApp.createPromoCode();
    });

    cy.wait('@createPromo').then((interception) => {
      expect(interception.request.body).to.deep.include({
        code: 'ALWAYS20',
        reward_type: 'percent',
        discount_percent: 20,
        usage_mode: 'always'
      });
    });
    cy.contains('#promoCodesList .settings-list-item', 'ALWAYS20', { timeout: 10000 }).should('contain.text', 'Постоянный');

    cy.window().then((win) => {
      win.document.getElementById('promoCodeValue').value = 'giftonce';
      win.document.getElementById('promoRewardType').value = 'gift_service';
      win.document.getElementById('promoUsageMode').value = 'single_use';
      win.MasterApp.onPromoRewardTypeChange();
      return win.MasterApp.createPromoCode();
    });

    cy.wait('@createPromo').then((interception) => {
      expect(interception.request.body).to.deep.include({
        code: 'GIFTONCE',
        reward_type: 'gift_service',
        usage_mode: 'single_use'
      });
    });
    cy.contains('#promoCodesList .settings-list-item', 'GIFTONCE', { timeout: 10000 }).should('contain.text', 'Одноразовый');
  });

  it('shows backend error when enabling already used single-use promo code', () => {
    openSettingsTab();
    cy.get('#networkToastText').should('exist');

    cy.window().then((win) => {
      return win.MasterApp.togglePromoCodeActive(77, true);
    });

    cy.wait('@togglePromo');
    cy.get('#networkToastText', { timeout: 10000 }).should('contain.text', 'Одноразовый промокод уже использован');
  });
});
