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
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('authToken', 'tg-token');
        win.localStorage.setItem('token', 'tg-token');
        win.localStorage.setItem('currentUser', JSON.stringify({ id: 101, username: 'tg_client' }));
      }
    });

    cy.get('#appScreen').should('be.visible');
    cy.location('hash').should('eq', '#/dashboard');
    cy.contains('tg_client');
  });

  it('logs out back to telegram-only auth screen', () => {
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('authToken', 'tg-token');
        win.localStorage.setItem('token', 'tg-token');
        win.localStorage.setItem('currentUser', JSON.stringify({ id: 102, username: 'tg_client_logout' }));
      }
    });

    cy.get('#appScreen').should('be.visible');
    cy.contains('Выйти').click();
    cy.get('#authScreen').should('be.visible');
    cy.get('#appScreen').should('not.be.visible');
    cy.contains('Подтверждаем вход через Telegram');
  });
});
