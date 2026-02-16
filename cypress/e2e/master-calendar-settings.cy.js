describe('Master Panel - Calendar Settings E2E', () => {
  beforeEach(() => {
    let seeded = false;
    let availabilityRules = [];
    let exclusions = [];
    let availabilitySeq = 100;

    cy.intercept('GET', /\/api\/master\/calendar.*/, {
      statusCode: 200,
      body: { bookings: [], blocks: [] }
    }).as('calendar');

    cy.intercept('GET', /\/api\/master\/services\/?(?:\?.*)?$/, (req) => {
      if (!seeded) {
        req.alias = 'servicesEmpty';
        req.reply({
          statusCode: 200,
          body: []
        });
        return;
      }
      req.alias = 'servicesSeeded';
      req.reply({
        statusCode: 200,
        body: [
          { id: 1, name: 'Сахар: Бёдра', duration_minutes: 40, price: 900, is_active: true },
          { id: 2, name: 'Воск: Ноги полностью', duration_minutes: 60, price: 2000, is_active: true }
        ]
      });
    });

    cy.intercept('POST', '/api/master/services/bootstrap-default', (req) => {
      expect(req.body).to.deep.equal({ overwrite: true });
      seeded = true;
      req.reply({
        statusCode: 201,
        body: {
          inserted_count: 30,
          overwrite: true,
          services: [{ id: 1, name: 'Сахар: Бёдра' }]
        }
      });
    }).as('bootstrapServices');

    cy.intercept('GET', /\/api\/master\/profile\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: { booking_slug: 'master-slug', display_name: 'Мастер' }
    }).as('profile');

    cy.intercept('GET', /\/api\/calendar-sync\/status\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: { connected: false }
    }).as('gcalStatus');

    cy.intercept('POST', '/api/master/settings/apple-calendar/enable', {
      statusCode: 200,
      body: {
        apple_calendar_enabled: true,
        apple_calendar_token: 'token-123'
      }
    }).as('enableApple');

    cy.intercept('GET', /\/api\/master\/settings\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: {
        reminder_hours: [24, 2],
        quiet_hours_start: null,
        quiet_hours_end: null,
        apple_calendar_enabled: true,
        apple_calendar_token: 'token-123'
      }
    }).as('settingsEnabled');

    cy.intercept('GET', /\/api\/master\/availability\/windows\/?(?:\?.*)?$/, (req) => {
      req.reply({
        statusCode: 200,
        body: availabilityRules
      });
    }).as('availability');

    cy.intercept('POST', '/api/master/availability/windows', (req) => {
      availabilitySeq += 1;
      availabilityRules.push({
        id: availabilitySeq,
        date: req.body.date,
        start_time: req.body.start_time,
        end_time: req.body.end_time
      });
      req.reply({
        statusCode: 201,
        body: availabilityRules[availabilityRules.length - 1]
      });
    }).as('addAvailability');

    cy.intercept('GET', /\/api\/master\/availability\/exclusions\/?(?:\?.*)?$/, (req) => {
      req.reply({
        statusCode: 200,
        body: exclusions
      });
    }).as('availabilityExclusions');

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

  it('should enable apple calendar', () => {
    cy.window().then((win) => {
      win.MasterApp.switchTab('settings');
    });
    cy.wait('@profile');
    cy.wait('@gcalStatus');

    cy.contains('Apple Calendar').should('be.visible');

    cy.contains('button', 'Включить').click();
    cy.wait('@enableApple');
  });

  it('should bootstrap default services from template', () => {
    cy.window().then((win) => {
      cy.stub(win, 'confirm').returns(true);
      win.MasterApp.switchTab('services');
    });

    cy.wait('@servicesEmpty');
    cy.contains('button:visible', 'Заполнить прайс по шаблону').click();
    cy.wait('@bootstrapServices');
    cy.wait('@servicesSeeded').its('response.body').should('have.length', 2);

    cy.contains('.service-card', 'Сахар: Бёдра').should('be.visible');
    cy.contains('.service-card', 'Воск: Ноги полностью').should('be.visible');
  });

  it('should allow adding availability rule for booking slots', () => {
    cy.window().then((win) => {
      win.MasterApp.switchTab('settings');
    });

    cy.wait('@availability');
    cy.wait('@availabilityExclusions');
    cy.get('#availabilityDate').type('2026-02-23');
    cy.get('#availabilityStart').clear().type('10:00');
    cy.get('#availabilityEnd').clear().type('18:00');
    cy.contains('button', 'Добавить окно').click();

    cy.wait('@addAvailability').its('request.body').should('deep.include', {
      date: '2026-02-23',
      start_time: '10:00',
      end_time: '18:00'
    });
    cy.contains('#availabilityRules', '2026-02-23').should('be.visible');
    cy.contains('#availabilityRules', '10:00 - 18:00').should('be.visible');
  });

  it('should allow bulk availability input', () => {
    cy.window().then((win) => {
      win.MasterApp.switchTab('settings');
    });

    cy.wait('@availability');
    cy.wait('@availabilityExclusions');

    cy.get('#availabilityBulkInput').type('2026-02-24 10:00-12:00, 13:00-14:00{enter}2026-02-25 11:00-15:00');
    cy.contains('button', 'Добавить из строк').click();

    cy.wait('@addAvailability');
    cy.wait('@addAvailability');
    cy.wait('@addAvailability');

    cy.contains('#availabilityRules', '2026-02-24').should('be.visible');
    cy.contains('#availabilityRules', '2026-02-25').should('be.visible');
  });
});
