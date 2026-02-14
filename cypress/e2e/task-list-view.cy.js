describe('Home Calendar - Task List View E2E', () => {
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

  it('should filter tasks by status', () => {
    cy.get('#taskTitle').type('Filter Planned Task');
    cy.get('#taskDate').type('2026-03-01');
    cy.get('#taskStatus').select('planned');
    cy.get('#taskForm').submit();

    cy.get('#taskTitle').type('Filter InProgress Task');
    cy.get('#taskDate').type('2026-03-02');
    cy.get('#taskStatus').select('in_progress');
    cy.get('#taskForm').submit();

    cy.get('#tasksFilterStatus').select('in_progress');
    cy.get('#tasksApplyFilters').click();

    cy.contains('Filter InProgress Task');
    cy.contains('Filter Planned Task').should('not.exist');
  });

  it('should sort tasks by title desc', () => {
    cy.get('#taskTitle').type('AAA Sort Task');
    cy.get('#taskDate').type('2026-03-03');
    cy.get('#taskForm').submit();

    cy.get('#taskTitle').type('ZZZ Sort Task');
    cy.get('#taskDate').type('2026-03-04');
    cy.get('#taskForm').submit();

    cy.get('#tasksSortBy').select('title');
    cy.get('#tasksSortOrder').select('desc');
    cy.get('#tasksApplyFilters').click();

    cy.get('#tasksContainer .task-title').first().should('contain', 'ZZZ Sort Task');
  });
});
