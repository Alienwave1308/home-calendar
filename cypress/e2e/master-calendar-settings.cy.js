describe('Master Panel - Calendar Settings E2E', () => {
  beforeEach(() => {
    let seeded = false;

    cy.intercept('GET', /\/api\/master\/calendar.*/, {
      statusCode: 200,
      body: { bookings: [], blocks: [] }
    }).as('calendar');

    cy.intercept('GET', /\/api\/master\/services\/?(?:\?.*)?$/, () => {
      if (!seeded) {
        return {
          statusCode: 200,
          body: []
        };
      }
      return {
        statusCode: 200,
        body: [
          { id: 1, name: 'Сахар: Бёдра', duration_minutes: 40, price: 900, is_active: true },
          { id: 2, name: 'Воск: Ноги полностью', duration_minutes: 60, price: 2000, is_active: true }
        ]
      };
    }).as('services');

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

    cy.wait('@services');
    cy.contains('Заполнить прайс по шаблону').click();
    cy.wait('@bootstrapServices');
    cy.wait('@services');

    cy.contains('.service-card', 'Сахар: Бёдра').should('be.visible');
    cy.contains('.service-card', 'Воск: Ноги полностью').should('be.visible');
  });
});
