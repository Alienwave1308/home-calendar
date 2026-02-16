describe('Master Panel - Calendar Settings E2E', () => {
  beforeEach(() => {
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
});
