describe('Master Panel - Leads Tab E2E', () => {
  beforeEach(() => {
    const dayPayload = {
      period: 'day',
      timezone: 'Asia/Novosibirsk',
      data_source: 'current_entities_proxy',
      current: {
        range_start_local: '2026-02-21T00:00:00.000Z',
        range_end_local: '2026-02-22T00:00:00.000Z',
        metrics: {
          visitors: 20,
          auth_started: 20,
          auth_success: 20,
          booking_started: 8,
          booking_created: 5
        },
        conversion: {
          visit_to_auth_start: 100,
          auth_start_to_auth_success: 100,
          auth_success_to_booking_created: 25,
          visit_to_booking_created: 25,
          booking_started_to_booking_created: 62.5
        }
      },
      previous: {
        range_start_local: '2026-02-20T00:00:00.000Z',
        range_end_local: '2026-02-21T00:00:00.000Z',
        metrics: {
          visitors: 10,
          auth_started: 10,
          auth_success: 10,
          booking_started: 4,
          booking_created: 2
        },
        conversion: {
          visit_to_auth_start: 100,
          auth_start_to_auth_success: 100,
          auth_success_to_booking_created: 20,
          visit_to_booking_created: 20,
          booking_started_to_booking_created: 50
        }
      }
    };

    const weekPayload = {
      ...dayPayload,
      period: 'week',
      current: {
        ...dayPayload.current,
        metrics: {
          visitors: 70,
          auth_started: 70,
          auth_success: 70,
          booking_started: 25,
          booking_created: 14
        },
        conversion: {
          visit_to_auth_start: 100,
          auth_start_to_auth_success: 100,
          auth_success_to_booking_created: 20,
          visit_to_booking_created: 20,
          booking_started_to_booking_created: 56
        }
      },
      previous: {
        ...dayPayload.previous,
        metrics: {
          visitors: 60,
          auth_started: 60,
          auth_success: 60,
          booking_started: 20,
          booking_created: 10
        },
        conversion: {
          visit_to_auth_start: 100,
          auth_start_to_auth_success: 100,
          auth_success_to_booking_created: 16.7,
          visit_to_booking_created: 16.7,
          booking_started_to_booking_created: 50
        }
      }
    };

    const usersDayPayload = {
      period: 'day',
      timezone: 'Asia/Novosibirsk',
      range_start_local: '2026-02-21T00:00:00.000Z',
      range_end_local: '2026-02-22T00:00:00.000Z',
      users: [
        {
          user_id: 101,
          username: 'tg_123456',
          telegram_username: 'irina_client',
          display_name: 'Ирина',
          avatar_url: 'https://example.com/avatar-irina.jpg',
          telegram_user_id: 123456,
          registered_at: '2026-02-21T10:00:00.000Z',
          bookings_total: 2
        }
      ]
    };

    const usersWeekPayload = {
      ...usersDayPayload,
      period: 'week',
      users: [
        {
          user_id: 102,
          username: 'tg_654321',
          telegram_username: 'tg_654321',
          display_name: 'Катя',
          avatar_url: 'https://example.com/avatar-katya.jpg',
          telegram_user_id: 654321,
          registered_at: '2026-02-20T09:00:00.000Z',
          bookings_total: 0
        },
        {
          user_id: 103,
          username: 'tg_999999',
          telegram_username: 'real_client',
          display_name: 'Ольга',
          avatar_url: '',
          telegram_user_id: 999999,
          registered_at: '2026-02-19T09:00:00.000Z',
          bookings_total: 1
        }
      ]
    };

    cy.intercept('GET', /\/api\/master\/calendar.*/, {
      statusCode: 200,
      body: { bookings: [], blocks: [] }
    }).as('calendar');

    cy.intercept('GET', '/api/master/leads/metrics?period=day', {
      statusCode: 200,
      body: dayPayload
    }).as('leadsDay');

    cy.intercept('GET', '/api/master/leads/metrics?period=week', {
      statusCode: 200,
      body: weekPayload
    }).as('leadsWeek');

    cy.intercept('GET', '/api/master/leads/registrations?period=day', {
      statusCode: 200,
      body: usersDayPayload
    }).as('leadsUsersDay');

    cy.intercept('GET', '/api/master/leads/registrations?period=week', {
      statusCode: 200,
      body: usersWeekPayload
    }).as('leadsUsersWeek');

    cy.visit('/master.html', {
      onBeforeLoad(win) {
        win.__openedTelegramLinks = [];
        win.Telegram = {
          WebApp: {
            initData: 'test-init-data',
            initDataUnsafe: { user: { id: 777, username: 'master' } },
            ready() {},
            expand() {},
            openTelegramLink(link) {
              win.__openedTelegramLinks.push(link);
            }
          }
        };
        win.localStorage.setItem('token', 'mock-token');
        win.localStorage.setItem('authToken', 'mock-token');
      }
    });
  });

  it('shows leads metrics and switches period', () => {
    cy.window().then((win) => {
      win.MasterApp.switchTab('leads');
    });

    cy.wait('@leadsDay');
    cy.get('#tabLeads').should('be.visible');
    cy.get('#leadsHelpPanel').should('not.be.visible');
    cy.get('#leadsHelpToggleBtn').click();
    cy.get('#leadsHelpPanel').should('be.visible');
    cy.get('#leadsHelpToggleBtn').should('contain.text', 'Скрыть подсказки');
    cy.get('#leadsHelpPanel').should('contain.text', 'Как читать показатели');
    cy.get('#leadsHelpPanel').should('contain.text', 'Создали запись');
    cy.get('#leadsVisitors').should('have.text', '20');
    cy.get('#leadsBookingCreated').should('have.text', '5');
    cy.get('#leadsVisitorsDelta').should('contain.text', '+100%');
    cy.get('#leadsFunnel').should('contain.text', 'Visit → Booking created');
    cy.get('#leadsFunnel').should('contain.text', '25%');

    cy.contains('#tabLeads button', 'Неделя').click();
    cy.wait('@leadsWeek');

    cy.get('#leadsVisitors').should('have.text', '70');
    cy.get('#leadsBookingCreated').should('have.text', '14');
    cy.get('#leadsFunnel').should('contain.text', '56%');

    cy.contains('#tabLeads button', 'Люди').click();
    cy.wait('@leadsUsersWeek');
    cy.get('#leadsUsersList').should('not.contain.text', '@tg_654321');
    cy.get('#leadsUsersList').should('contain.text', 'Логин Telegram скрыт');
    cy.get('#leadsUsersList').should('contain.text', 'ID: 654321');
    cy.get('#leadsUsersList').should('contain.text', 'Катя');
    cy.get('#leadsUsersList').contains('button', 'Написать').should('have.length', 2);

    cy.get('#leadsUsersList .leads-user-card').eq(0).contains('button', 'Написать').click();
    cy.window().its('__openedTelegramLinks.0').should('eq', 'tg://user?id=654321');

    cy.get('#leadsUsersList .leads-user-card').eq(1).contains('button', 'Написать').click();
    cy.window().its('__openedTelegramLinks.1').should('eq', 'https://t.me/real_client');
  });
});
