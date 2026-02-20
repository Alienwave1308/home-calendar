describe('TG Mini App - Clients E2E', () => {
  const testUser = 'cypressuser';
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
  });

  it('should show clients section after login', () => {
    cy.intercept('GET', '/api/master/clients', {
      statusCode: 200,
      body: []
    }).as('getClientsEmpty');

    cy.get('.nav-item[data-route="clients"]').click();
    cy.location('hash').should('eq', '#/clients');
    cy.wait('@getClientsEmpty');

    cy.get('#clientsSection').should('be.visible');
    cy.contains('Клиенты');
    cy.contains('Пользователи Telegram, которые когда-либо записывались к мастеру');
  });

  it('should render empty state when there are no clients', () => {
    cy.intercept('GET', '/api/master/clients', {
      statusCode: 200,
      body: []
    }).as('getClientsEmpty');

    cy.get('.nav-item[data-route="clients"]').click();
    cy.wait('@getClientsEmpty');

    cy.get('#clientsList').should('be.empty');
    cy.get('#clientsEmpty').should('be.visible');
    cy.get('#clientBookingsSection').should('not.be.visible');
  });

  it('should show error when clients endpoint returns 403', () => {
    cy.intercept('GET', '/api/master/clients', {
      statusCode: 403,
      body: { error: 'forbidden' }
    }).as('getClientsForbidden');

    cy.get('.nav-item[data-route="clients"]').click();
    cy.wait('@getClientsForbidden');

    cy.get('#clientsError')
      .should('be.visible')
      .and('contain', 'Раздел клиентов доступен только мастеру');
  });

  it('should load and render selected client bookings', () => {
    cy.intercept('GET', '/api/master/clients', {
      statusCode: 200,
      body: [
        {
          user_id: 42,
          username: 'alice',
          telegram_user_id: 4242,
          bookings_total: 3,
          upcoming_total: 1
        }
      ]
    }).as('getClients');

    cy.intercept('GET', '/api/master/clients/42/bookings', {
      statusCode: 200,
      body: [
        {
          id: 501,
          start_at: '2026-02-20T10:00:00.000Z',
          status: 'confirmed',
          service_name: 'Шугаринг',
          client_note: 'Тестовая заметка'
        }
      ]
    }).as('getClientBookings');

    cy.get('.nav-item[data-route="clients"]').click();
    cy.wait('@getClients');

    cy.contains('.client-card', 'alice').click();
    cy.wait('@getClientBookings');

    cy.get('#clientBookingsSection').should('be.visible');
    cy.get('#clientBookingsTitle').should('contain', 'alice');
    cy.get('#clientBookingsList').contains('Шугаринг');
    cy.get('#clientBookingsList').contains('Запланировано');
    cy.get('#clientBookingsList').contains('Тестовая заметка');
  });

  it('should show bookings loading error for selected client', () => {
    cy.intercept('GET', '/api/master/clients', {
      statusCode: 200,
      body: [{ user_id: 7, username: 'bob', telegram_user_id: null, bookings_total: 0, upcoming_total: 0 }]
    }).as('getClients');

    cy.intercept('GET', '/api/master/clients/7/bookings', {
      statusCode: 500,
      body: { error: 'Server error' }
    }).as('getClientBookingsFail');

    cy.get('.nav-item[data-route="clients"]').click();
    cy.wait('@getClients');
    cy.contains('.client-card', 'bob').click();
    cy.wait('@getClientBookingsFail');

    cy.get('#clientsError')
      .should('be.visible')
      .and('contain', 'Не удалось загрузить историю клиента');
    cy.get('#clientBookingsEmpty').should('be.visible');
  });
});
