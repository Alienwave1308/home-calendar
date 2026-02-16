describe('Home Calendar - SPA Navigation E2E', () => {
  const testUser = 'cypressuser';
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
  });

  it('should navigate between screens via hash router', () => {
    cy.login(testUser, testPass);

    cy.get('.nav-item[data-route="calendar"]').click();
    cy.location('hash').should('eq', '#/calendar');
    cy.get('#screen-calendar').should('be.visible');

    cy.get('.nav-item[data-route="tasks"]').click();
    cy.location('hash').should('eq', '#/tasks');
    cy.get('#screen-tasks').should('be.visible');

    cy.get('.nav-item[data-route="kanban"]').click();
    cy.location('hash').should('eq', '#/kanban');
    cy.get('#screen-kanban').should('be.visible');

    cy.get('.nav-item[data-route="clients"]').click();
    cy.location('hash').should('eq', '#/clients');
    cy.get('#screen-clients').should('be.visible');
  });

  it('should preserve route after successful login', () => {
    cy.visit('/#/tasks');
    cy.login(testUser, testPass);

    cy.location('hash').should('eq', '#/tasks');
    cy.get('#screen-tasks').should('be.visible');
  });
});
