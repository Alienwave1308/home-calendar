describe('Master Panel - Calendar Settings E2E', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/master/profile', {
      statusCode: 200,
      body: { booking_slug: 'master-slug', display_name: 'Мастер' }
    }).as('profile');

    cy.intercept('GET', '/api/calendar-sync/status', {
      statusCode: 200,
      body: { connected: false }
    }).as('gcalStatus');

    cy.intercept('GET', '/api/master/settings', {
      statusCode: 200,
      body: {
        reminder_hours: [24, 2],
        quiet_hours_start: null,
        quiet_hours_end: null,
        apple_calendar_enabled: false,
        apple_calendar_token: null
      }
    }).as('settingsInitial');

    cy.intercept('POST', '/api/master/settings/apple-calendar/enable', {
      statusCode: 200,
      body: {
        apple_calendar_enabled: true,
        apple_calendar_token: 'token-123'
      }
    }).as('enableApple');

    cy.intercept('GET', '/api/master/settings', {
      statusCode: 200,
      body: {
        reminder_hours: [24, 2],
        quiet_hours_start: null,
        quiet_hours_end: null,
        apple_calendar_enabled: true,
        apple_calendar_token: 'token-123'
      }
    }).as('settingsEnabled');

    cy.visit('/master', {
      onBeforeLoad(win) {
        win.localStorage.setItem('token', 'mock-token');
      }
    });
  });

  it('should enable apple calendar and render subscription link', () => {
    cy.get('.master-tab[data-tab="settings"]').click();
    cy.wait('@profile');
    cy.wait('@gcalStatus');
    cy.wait('@settingsInitial');

    cy.contains('Apple Calendar').should('be.visible');
    cy.contains('Отключен').should('be.visible');

    cy.contains('button', 'Включить').click();
    cy.wait('@enableApple');
    cy.wait('@settingsEnabled');

    cy.get('#appleCalendarLink')
      .should('be.visible')
      .and('contain.value', '/api/public/master/master-slug/calendar.ics?token=token-123');
  });
});
