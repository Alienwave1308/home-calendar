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
  });
});
