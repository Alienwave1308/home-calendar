describe('Home Calendar - Dashboard E2E', () => {
  const testUser = 'cypressuser';
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
    cy.get('.nav-item[data-route="dashboard"]').click();
    cy.location('hash').should('eq', '#/dashboard');
  });

  it('should show dashboard summary cards', () => {
    cy.contains('Сводка');
    cy.get('#dashTodayCount').should('be.visible');
    cy.get('#dashOverdueCount').should('be.visible');
    cy.get('#dashUpcomingCount').should('be.visible');
    cy.get('#dashDoneWeek').should('be.visible');
  });

  it('should create task from dashboard quick form and open it from summary', () => {
    const title = `Quick task ${Date.now()}`;

    cy.get('#dashboardQuickTitle').type(title);
    cy.get('#dashboardQuickForm').submit();

    cy.get('#dashTodayList').contains(title).click();

    cy.location('hash').should('eq', '#/tasks');
    cy.get('#tasksContainer').contains(title);
  });
});
