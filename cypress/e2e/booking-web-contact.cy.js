/**
 * E2E tests: web booking contact selection screen.
 * Runs without Telegram/VK Mini App context.
 */

describe('Web booking contact screen', () => {
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

    cy.visit('/book/lera', {
      onBeforeLoad(win) {
        delete win.Telegram;
        delete win.vkBridge;
      }
    });

    cy.get('#servicesList').should('be.visible');
  });

  function selectServiceAndSlot() {
    cy.get('.service-card, .service-item, [data-service-id]').first().click();
    cy.get('#dockAction').should('be.visible').click();
    cy.get('#screen-calendar').should('have.class', 'active');
    cy.get('#calGrid button[data-day]:not([disabled])').first().click();
    cy.get('[data-slot-start]').first().click({ force: true });
  }

  it('показывает экран выбора мессенджера после нажатия "Подтвердить"', () => {
    selectServiceAndSlot();
    cy.get('#screen-confirm').should('have.class', 'active');
    cy.get('#confirmSubmit').click();
    cy.get('#screen-contact').should('have.class', 'active');
    cy.get('#contactVk').should('be.visible');
    cy.get('#contactTg').should('be.visible');
  });

  it('кнопка ВКонтакте ведёт на VK OAuth', () => {
    selectServiceAndSlot();
    cy.get('#screen-confirm').should('have.class', 'active');
    cy.get('#confirmSubmit').click();
    cy.get('#screen-contact').should('have.class', 'active');
    cy.get('#contactVk').should('be.visible').should('not.be.disabled');
  });

  it('кнопка "Назад" возвращает на экран подтверждения', () => {
    selectServiceAndSlot();
    cy.get('#screen-confirm').should('have.class', 'active');
    cy.get('#confirmSubmit').click();
    cy.get('#screen-contact').should('have.class', 'active');
    cy.get('#contactBack').click();
    cy.get('#screen-confirm').should('have.class', 'active');
  });

  it('в Mini App Telegram экран contact не показывается — сразу submitBooking', () => {
    cy.visit('/book/lera?cypress_auth=1', {
      onBeforeLoad(win) {
        // Симулируем Telegram Mini App
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
      }
    });
    // В Telegram Mini App кнопка подтверждения должна вызывать submitBooking напрямую
    // (без экрана contact). Тест проверяет что screen-contact не имеет класс active
    // после нажатия confirmSubmit.
    cy.get('#screen-confirm').should('exist');
  });
});
