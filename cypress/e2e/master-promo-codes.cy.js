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
        gift_service_id: req.body.reward_type === 'gift_service' ? Number(req.body.gift_service_id) : null,
        gift_service_name: req.body.reward_type === 'gift_service' ? 'Сахар: Голень' : null,
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
    cy.wait('@getProfile');
    cy.wait('@getGcalStatus');
    cy.wait('@getSettings');
    cy.wait('@getAvailabilityWindows');
    cy.wait('@getAvailabilityExclusions');
    cy.wait('@getServices');
    cy.wait('@getPromoCodes');
  }

  it('creates always and single-use promo codes from settings', () => {
    openSettingsTab();

    cy.get('#promoCodeValue').clear().type('always20');
    cy.get('#promoRewardType').select('percent');
    cy.get('#promoUsageMode').select('always');
    cy.get('#promoDiscountPercent').clear().type('20');
    cy.contains('button', 'Создать промокод').click();

    cy.wait('@createPromo').then((interception) => {
      expect(interception.request.body).to.deep.include({
        code: 'ALWAYS20',
        reward_type: 'percent',
        discount_percent: 20,
        usage_mode: 'always'
      });
    });
    cy.wait('@getServices');
    cy.wait('@getPromoCodes');
    cy.contains('#promoCodesList .settings-list-item', 'ALWAYS20').should('contain.text', 'Постоянный');

    cy.get('#promoCodeValue').clear().type('giftonce');
    cy.get('#promoRewardType').select('gift_service');
    cy.get('#promoUsageMode').select('single_use');
    cy.get('#promoGiftServiceId').select('1');
    cy.contains('button', 'Создать промокод').click();

    cy.wait('@createPromo').then((interception) => {
      expect(interception.request.body).to.deep.include({
        code: 'GIFTONCE',
        reward_type: 'gift_service',
        gift_service_id: 1,
        usage_mode: 'single_use'
      });
    });
    cy.wait('@getServices');
    cy.wait('@getPromoCodes');
    cy.contains('#promoCodesList .settings-list-item', 'GIFTONCE').should('contain.text', 'Одноразовый');
  });

  it('shows backend error when enabling already used single-use promo code', () => {
    openSettingsTab();

    cy.contains('#promoCodesList .settings-list-item', 'USEDONCE')
      .contains('button', 'Включить')
      .click();

    cy.wait('@togglePromo');
    cy.get('#networkToastText').should('contain.text', 'Одноразовый промокод уже использован');
  });
});
