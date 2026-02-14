describe('Home Calendar - Tasks E2E', () => {
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

  it('should add a new task', () => {
    cy.get('#taskTitle').type('Купить молоко');
    cy.get('#taskDate').type('2026-02-15');
    cy.get('#taskForm').submit();

    cy.contains('Купить молоко');
    cy.contains('15 февраля 2026');
  });

  it('should cycle task status', () => {
    cy.get('#taskTitle').type('Тестовая задача');
    cy.get('#taskDate').type('2026-02-16');
    cy.get('#taskForm').submit();

    cy.contains('Тестовая задача')
      .parents('.task-item')
      .find('.btn-status')
      .click();

    cy.contains('Тестовая задача')
      .parents('.task-item')
      .contains('В работе');
  });

  it('should delete a task', () => {
    cy.get('#taskTitle').type('Задача для удаления');
    cy.get('#taskDate').type('2026-02-17');
    cy.get('#taskForm').submit();

    cy.contains('Задача для удаления');

    cy.on('window:confirm', () => true);

    cy.contains('Задача для удаления')
      .parents('.task-item')
      .find('.btn-delete')
      .click();

    cy.contains('Задача для удаления').should('not.exist');
  });
});
