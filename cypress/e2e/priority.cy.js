describe('Home Calendar - Priority E2E', () => {
  const testUser = 'cypressuser';
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
    cy.get('.nav-item[data-route="tasks"]').click();
    cy.location('hash').should('eq', '#/tasks');
  });

  it('should add a task with priority', () => {
    cy.get('#taskTitle').type('Срочная задача');
    cy.get('#taskDate').type('2026-02-20');
    cy.get('#taskPriority').select('urgent');
    cy.get('#taskForm').submit();

    cy.contains('Срочная задача')
      .parents('.task-item')
      .should('have.attr', 'data-priority', 'urgent');
  });

  it('should show priority and status selects in task form', () => {
    cy.get('#taskPriority').should('be.visible');
    cy.get('#taskStatus').should('be.visible');
    cy.get('#taskPriority option').should('have.length', 4);
    cy.get('#taskStatus option').should('have.length', 3);
  });
});
