describe('Master Panel - Booking CRUD E2E', () => {
  beforeEach(() => {
    let bookings = [
      {
        id: 101,
        client_id: 2,
        client_name: 'Тест-клиент',
        service_id: 10,
        service_name: 'Шугаринг',
        start_at: '2026-03-10T06:00:00.000Z',
        status: 'confirmed',
        master_note: null
      }
    ];

    cy.intercept('GET', /\/api\/master\/calendar.*/, {
      statusCode: 200,
      body: { bookings }
    }).as('getCalendar');

    cy.intercept('GET', /\/api\/master\/bookings.*/, (req) => {
      req.reply({ statusCode: 200, body: bookings });
    }).as('getBookings');

    cy.intercept('GET', '/api/master/clients', {
      statusCode: 200,
      body: [{ user_id: 2, username: 'Тест-клиент' }]
    }).as('getClients');

    cy.intercept('GET', '/api/master/services', {
      statusCode: 200,
      body: [{ id: 10, name: 'Шугаринг', duration_minutes: 60, price: 2000 }]
    }).as('getServices');

    cy.intercept('POST', '/api/master/bookings', (req) => {
      const created = {
        id: 202,
        client_id: 2,
        client_name: 'Тест-клиент',
        service_id: 10,
        service_name: 'Шугаринг',
        start_at: req.body.start_at,
        status: req.body.status,
        master_note: req.body.master_note || null
      };
      bookings = [created, ...bookings];
      req.reply({ statusCode: 201, body: created });
    }).as('createBooking');

    cy.intercept('PUT', /\/api\/master\/bookings\/(\d+)/, (req) => {
      const id = Number(req.url.split('/').pop());
      bookings = bookings.map((booking) => (
        booking.id === id
          ? {
            ...booking,
            client_id: req.body.client_id,
            service_id: req.body.service_id,
            start_at: req.body.start_at,
            status: req.body.status,
            master_note: req.body.master_note || null
          }
          : booking
      ));
      req.reply({ statusCode: 200, body: { ok: true } });
    }).as('updateBooking');

    cy.intercept('PATCH', /\/api\/master\/bookings\/(\d+)/, (req) => {
      const id = Number(req.url.split('/').pop());
      bookings = bookings.map((booking) => (
        booking.id === id
          ? { ...booking, status: req.body.status }
          : booking
      ));
      req.reply({ statusCode: 200, body: { ok: true } });
    }).as('patchBooking');

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

  it('creates, edits and cancels booking', () => {
    cy.window().then((win) => {
      win.MasterApp.switchTab('bookings');
    });

    cy.get('#tabBookings').should('be.visible');
    cy.wait('@getBookings');
    cy.get('#tabBookings').contains('.booking-card', 'Тест-клиент').should('be.visible');
    cy.get('#tabBookings').contains('.booking-card', 'Запланировано').should('be.visible');

    cy.contains('button', 'Создать запись').click();
    cy.wait('@getClients');
    cy.wait('@getServices');

    cy.get('#bookingFormClient').select('2');
    cy.get('#bookingFormService').select('10');
    cy.get('#bookingFormStatus').select('confirmed');
    cy.get('#bookingFormStart').clear().type('2026-03-11T13:00');
    cy.get('#bookingFormNote').clear().type('Первичная консультация');
    cy.contains('.sheet-actions button', 'Сохранить').click();

    cy.wait('@createBooking').then((interception) => {
      expect(interception.request.body.client_id).to.equal(2);
      expect(interception.request.body.service_id).to.equal(10);
      expect(interception.request.body.status).to.equal('confirmed');
      expect(interception.request.body.start_at).to.be.a('string');
    });
    cy.wait('@getBookings');
    cy.get('#tabBookings').contains('.booking-card', 'Первичная консультация').should('be.visible');

    cy.get('#tabBookings').contains('.booking-card', 'Первичная консультация')
      .contains('button', 'Редактировать')
      .click();
    cy.get('#bookingFormNote').clear().type('Комментарий обновлен');
    cy.contains('.sheet-actions button', 'Сохранить').click();

    cy.wait('@updateBooking').then((interception) => {
      expect(interception.request.body.master_note).to.equal('Комментарий обновлен');
      expect(interception.request.body.status).to.equal('confirmed');
    });
    cy.wait('@getBookings');
    cy.get('#tabBookings').contains('.booking-card', 'Комментарий обновлен').should('be.visible');

    cy.get('#tabBookings').contains('.booking-card', 'Комментарий обновлен')
      .contains('button', 'Отменить')
      .click();

    cy.wait('@patchBooking').then((interception) => {
      expect(interception.request.body.status).to.equal('canceled');
    });
    cy.wait('@getBookings');
    cy.get('#tabBookings').contains('.booking-card', 'Отменено').should('be.visible');
  });
});
