describe('Master Panel - Overview Metrics E2E', () => {
  function isoAt(dayOffset, hour, minute) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  }

  beforeEach(() => {
    const bookings = [
      {
        id: 1,
        status: 'confirmed',
        start_at: isoAt(-1, 9, 0),
        end_at: isoAt(-1, 10, 0),
        final_price: 1000,
        client_id: 100
      },
      {
        id: 2,
        status: 'completed',
        start_at: isoAt(-2, 13, 0),
        end_at: isoAt(-2, 14, 0),
        final_price: 2000,
        client_id: 200
      },
      {
        id: 3,
        status: 'completed',
        start_at: isoAt(-40, 12, 0),
        end_at: isoAt(-40, 13, 0),
        final_price: 3000,
        client_id: 100
      },
      {
        id: 4,
        status: 'canceled',
        start_at: isoAt(-1, 11, 0),
        end_at: isoAt(-1, 12, 0),
        final_price: 9000,
        client_id: 999
      },
      {
        id: 5,
        status: 'confirmed',
        start_at: isoAt(1, 15, 0),
        end_at: isoAt(1, 16, 0),
        final_price: 7000,
        client_id: 777
      }
    ];

    cy.intercept('GET', /\/api\/master\/calendar.*/, {
      statusCode: 200,
      body: { bookings: [], blocks: [] }
    }).as('calendar');

    cy.intercept('GET', /\/api\/master\/bookings\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: bookings
    }).as('bookings');

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

  it('counts only non-canceled finished bookings and supports period filters', () => {
    cy.wait('@calendar');
    cy.wait('@bookings');

    cy.get('#overviewKpiBookings').should('have.text', '1');
    cy.get('#overviewKpiRevenue').should('contain.text', '1 000 ₽');
    cy.get('#overviewKpiAvg').should('contain.text', '1 000 ₽');
    cy.get('#overviewKpiClients').should('have.text', '1');

    cy.get('#overviewPresetWeek').click();
    cy.wait('@bookings');
    cy.get('#overviewKpiBookings').should('have.text', '2');
    cy.get('#overviewKpiRevenue').should('contain.text', '3 000 ₽');
    cy.get('#overviewKpiAvg').should('contain.text', '1 500 ₽');
    cy.get('#overviewKpiClients').should('have.text', '2');

    cy.get('#overviewPresetAll').click();
    cy.wait('@bookings');
    cy.get('#overviewKpiBookings').should('have.text', '3');
    cy.get('#overviewKpiRevenue').should('contain.text', '6 000 ₽');
    cy.get('#overviewKpiAvg').should('contain.text', '2 000 ₽');
    cy.get('#overviewKpiClients').should('have.text', '2');

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 40);
    const oldIso = oldDate.toISOString().slice(0, 10);
    cy.get('#overviewFrom').clear().type(oldIso);
    cy.get('#overviewTo').clear().type(oldIso);
    cy.contains('button', 'Применить').click();

    cy.wait('@bookings');
    cy.get('#overviewKpiBookings').should('have.text', '1');
    cy.get('#overviewKpiRevenue').should('contain.text', '3 000 ₽');
    cy.get('#overviewKpiClients').should('have.text', '1');
  });
});
