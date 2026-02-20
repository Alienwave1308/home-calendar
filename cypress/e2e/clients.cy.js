describe('TG Mini App - Clients E2E', () => {
  const testUser = 'cypressuser';
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
    cy.get('.nav-item[data-route="clients"]').click();
    cy.location('hash').should('eq', '#/clients');
  });

  it('should show clients section after login', () => {
    cy.get('#clientsSection').should('be.visible');
    cy.contains('Клиенты');
    cy.contains('Пользователи Telegram, которые когда-либо записывались к мастеру');
  });
});
