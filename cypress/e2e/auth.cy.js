describe('TG Mini App - Auth E2E', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    cy.intercept('GET', '/api/dashboard', {
      statusCode: 200,
      body: {
        stats: { today_count: 0, overdue_count: 0, upcoming_count: 0, done_week: 0 },
        today: [],
        overdue: [],
        upcoming: []
      }
    }).as('dashboard');
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
    cy.visit('/', {
      onBeforeLoad(win) {
        win.Telegram = {
          WebApp: {
            initData: 'query_id=autologin&user=%7B%22id%22%3A101%7D&auth_date=1700000000&hash=test',
            initDataUnsafe: { user: { id: 101, username: 'tg_client' } },
            ready() {},
            expand() {}
          }
        };
        win.localStorage.setItem('authToken', 'tg-token');
        win.localStorage.setItem('token', 'tg-token');
        win.localStorage.setItem('currentUser', JSON.stringify({ id: 101, username: 'tg_client' }));
      }
    });

    cy.get('#appScreen').should('be.visible');
    cy.wait('@dashboard');
    cy.location('hash').should('eq', '#/dashboard');
    cy.contains('tg_client');
  });

  it('logs out back to telegram-only auth screen', () => {
    cy.visit('/', {
      onBeforeLoad(win) {
        win.Telegram = {
          WebApp: {
            initData: 'query_id=logout&user=%7B%22id%22%3A102%7D&auth_date=1700000001&hash=test',
            initDataUnsafe: { user: { id: 102, username: 'tg_client_logout' } },
            ready() {},
            expand() {}
          }
        };
        win.localStorage.setItem('authToken', 'tg-token');
        win.localStorage.setItem('token', 'tg-token');
        win.localStorage.setItem('currentUser', JSON.stringify({ id: 102, username: 'tg_client_logout' }));
      }
    });

    cy.get('#appScreen').should('be.visible');
    cy.wait('@dashboard');
    cy.contains('Выйти').click();
    cy.get('#authScreen').should('be.visible');
    cy.get('#appScreen').should('not.be.visible');
    cy.contains('Подтверждаем вход через Telegram');
  });
});
