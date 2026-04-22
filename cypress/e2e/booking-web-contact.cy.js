/**
 * E2E tests: web booking native auth modal (TG Login Widget + VK OAuth).
 * Runs without Telegram/VK Mini App context (isWebBrowser=true).
 */

describe('Web booking native auth modal', () => {
  beforeEach(() => {
    cy.intercept('GET', /\/api\/public\/master\/[^/]+$/, {
      statusCode: 200,
      body: {
        display_name: 'Лера',
        brand: 'RoVa',
        subtitle: 'Epil & Care',
        gift_url: '',
        gift_text: '',
        services: [
          { id: 11, name: 'Шугаринг ноги', duration_minutes: 60, price: 1200, is_active: true, method: 'sugar', category: 'legs' }
        ]
      }
    }).as('profile');

    cy.intercept('GET', '/api/public/master/*/slots*', {
      statusCode: 200,
      body: {
        slots: [
          { start: new Date(Date.now() + 3600000).toISOString(), end: new Date(Date.now() + 7200000).toISOString(), label: '14:00' }
        ]
      }
    }).as('slots');

    // Token must look like a real JWT with username=guest_* so isGuestToken() detects it
    cy.intercept('POST', /\/api\/auth\/guest/, {
      statusCode: 200,
      body: { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Imd1ZXN0X3Rlc3QxMjMiLCJpZCI6MX0.fakesig' }
    }).as('guestAuth');

    cy.intercept('POST', /\/api\/auth\/telegram-widget/, {
      statusCode: 200,
      body: { token: 'real-tg-token' }
    }).as('tgWidgetAuth');

    cy.intercept('POST', /\/api\/public\/master\/[^/]+\/book/, {
      statusCode: 201,
      body: { id: 1, status: 'confirmed', pricing: {} }
    }).as('postBook');

    cy.visit('/book/lera', {
      onBeforeLoad(win) {
        delete win.Telegram;
        delete win.vkBridge;
        delete win.Cypress;
      }
    });

    cy.wait('@guestAuth');
    cy.get('#servicesList').should('be.visible');
  });

  function selectServiceAndSlot() {
    cy.get('.service-card, .service-item, [data-service-id]').first().click();
    cy.get('#dockAction').should('be.visible').click();
    cy.get('#screen-calendar').should('have.class', 'active');
    cy.get('#calGrid button[data-day]:not([disabled])').first().click();
    cy.get('[data-slot-start]').first().click({ force: true });
    cy.get('#dockAction').click();
  }

  it('показывает модал авторизации после нажатия "Подтвердить"', () => {
    selectServiceAndSlot();
    cy.get('#screen-confirm').should('have.class', 'active');
    cy.get('#confirmSubmit').click();
    cy.get('#web-auth-modal').should('be.visible');
    cy.get('#web-auth-tg-widget').should('exist');
    cy.get('#web-auth-cancel').should('be.visible');
  });

  it('кнопка отмены скрывает модал и остаётся на экране подтверждения', () => {
    selectServiceAndSlot();
    cy.get('#confirmSubmit').click();
    cy.get('#web-auth-modal').should('be.visible');
    cy.get('#web-auth-cancel').click();
    cy.get('#web-auth-modal').should('not.be.visible');
    cy.get('#screen-confirm').should('have.class', 'active');
  });

  it('авторизация через TG виджет закрывает модал и создаёт запись', () => {
    selectServiceAndSlot();
    cy.get('#confirmSubmit').click();
    cy.get('#web-auth-modal').should('be.visible');

    cy.window().then((win) => {
      win.__onTelegramWidgetAuth__({
        id: '123456',
        first_name: 'Test',
        auth_date: String(Math.floor(Date.now() / 1000)),
        hash: 'fakehash'
      });
    });

    cy.wait('@tgWidgetAuth');
    cy.get('#web-auth-modal').should('not.be.visible');
    cy.wait('@postBook');
    cy.get('#screen-done').should('have.class', 'active');
  });

  it('в Mini App Telegram модал не показывается — submitBooking вызывается напрямую', () => {
    cy.intercept('POST', /\/api\/auth\/telegram/, {
      statusCode: 200,
      body: { token: 'tg-mini-app-token' }
    }).as('tgAuth');

    cy.visit('/book/lera', {
      onBeforeLoad(win) {
        win.Telegram = {
          WebApp: {
            initData: 'query_id=test&user=%7B%22id%22%3A12345%7D',
            initDataUnsafe: { user: { id: 12345 } },
            ready: () => {},
            expand: () => {},
            disableVerticalSwipes: () => {},
            setHeaderColor: () => {},
            themeParams: {}
          }
        };
        win.localStorage.setItem('token', 'tg-mini-app-token');
        win.localStorage.setItem('bookingAuthSession', 'tg:12345');
      }
    });

    cy.get('#screen-confirm').should('exist');
    cy.get('#web-auth-modal').should('not.exist');
  });
});
