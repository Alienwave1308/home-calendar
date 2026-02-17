describe('Booking Mini App - Calendar Export E2E', () => {
  beforeEach(() => {
    cy.intercept('GET', /\/api\/public\/master\/[^/]+\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: {
        master: {
          id: 1,
          display_name: 'Мастер',
          timezone: 'Asia/Novosibirsk',
          booking_slug: 'test-master'
        },
        services: [{ id: 10, name: 'Шугаринг', duration_minutes: 60, price: 2000 }]
      }
    }).as('getMaster');

    cy.intercept('GET', /\/api\/public\/master\/test-master\/slots.*/, {
      statusCode: 200,
      body: {
        slots: [{ start: '2026-02-20T10:00:00.000Z', end: '2026-02-20T11:00:00.000Z' }]
      }
    }).as('getSlots');

    cy.intercept('POST', /\/api\/public\/master\/test-master\/book\/?$/, (req) => {
      expect(req.body).to.include({
        service_id: 10,
        start_at: '2026-02-20T10:00:00.000Z',
        client_note: 'Зона подмышек'
      });
      req.reply({ statusCode: 201, body: { id: 1, status: 'confirmed' } });
    }).as('postBook');

    cy.intercept('GET', /\/api\/client\/bookings\/1\/calendar-feed\/?$/, {
      statusCode: 200,
      body: {
        feed_path: '/api/public/master/test-master/client-calendar.ics?token=test-client-token'
      }
    }).as('getClientCalendarFeed');

    cy.visit('/booking.html?slug=test-master', {
      onBeforeLoad(win) {
        win.Telegram = {
          WebApp: {
            initData: 'test-init-data',
            initDataUnsafe: { user: { id: 1, username: 'client' } },
            ready() {},
            expand() {},
            openLink() {}
          }
        };
      }
    });
    cy.wait('@getMaster', { timeout: 10000 });

    cy.window().then((win) => {
      cy.stub(win.Telegram.WebApp, 'openLink').as('openLink');
    });
  });

  it('shows calendar export actions after successful booking', () => {
    cy.contains('.service-card', 'Шугаринг').click();
    cy.wait('@getSlots');

    cy.get('.slot-btn').first().click();
    cy.get('#confirmNote').type('Зона подмышек');
    cy.get('#btnBook').click();
    cy.wait('@postBook');

    cy.get('#stepDone').should('be.visible');
    cy.get('#doneGoogleLink')
      .should('be.visible')
      .and('have.attr', 'href')
      .and('include', 'calendar.google.com')
      .and('include', 'ctz=Asia%2FNovosibirsk');
    cy.get('#doneAppleBtn').should('be.visible');

    cy.get('#doneAppleBtn').click();
    cy.wait('@getClientCalendarFeed');
    cy.get('@openLink').should('have.been.called');
    cy.get('@openLink').its('lastCall.args.0').should('match', /^https?:\/\//);
    cy.get('@openLink').its('lastCall.args.0').should('include', 'client-calendar.ics');
    cy.get('@openLink').its('lastCall.args.0').should('include', 'token=test-client-token');
  });
});
