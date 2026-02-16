describe('Home Calendar - Auth E2E', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
  });

  it('shows telegram-only auth state without web forms', () => {
    cy.visit('/');
    cy.contains('Календарь мастера');
    cy.contains('Подтверждаем вход через Telegram');
    cy.contains('Не удалось подтвердить сессию Telegram');
    cy.get('#loginForm').should('not.exist');
    cy.get('#registerForm').should('not.exist');
    cy.get('#tgAuthRetryBtn').should('be.visible');
  });

  it('auto logins through Telegram and opens app', () => {
    cy.intercept('POST', '/api/auth/telegram', {
      statusCode: 200,
      body: {
        token: 'tg-token',
        user: { id: 101, username: 'tg_client' },
        role: 'client',
        booking_slug: 'wife-master'
      }
    }).as('telegramAuth');

    cy.visit('/', {
      onBeforeLoad(win) {
        win.Telegram = {
          WebApp: {
            initData: 'query_id=abc&user=%7B%22id%22%3A777%7D&auth_date=1700000000&hash=test',
            initDataUnsafe: { user: { id: 777, username: 'telegram_user' } },
            ready() {},
            expand() {}
          }
        };
      }
    });

    cy.wait('@telegramAuth');
    cy.get('#appScreen').should('be.visible');
    cy.location('hash').should('eq', '#/dashboard');
    cy.contains('tg_client');
  });

  it('logs out back to telegram-only auth screen', () => {
    cy.intercept('POST', '/api/auth/telegram', {
      statusCode: 200,
      body: {
        token: 'tg-token',
        user: { id: 102, username: 'tg_client_logout' },
        role: 'client',
        booking_slug: 'wife-master'
      }
    }).as('telegramAuthLogout');

    cy.visit('/', {
      onBeforeLoad(win) {
        win.Telegram = {
          WebApp: {
            initData: 'query_id=logout&user=%7B%22id%22%3A778%7D&auth_date=1700000001&hash=test',
            initDataUnsafe: { user: { id: 778, username: 'telegram_user_logout' } },
            ready() {},
            expand() {}
          }
        };
      }
    });

    cy.wait('@telegramAuthLogout');
    cy.get('#appScreen').should('be.visible');
    cy.contains('Выйти').click();
    cy.get('#authScreen').should('be.visible');
    cy.get('#appScreen').should('not.be.visible');
    cy.contains('Подтверждаем вход через Telegram');
  });
});
