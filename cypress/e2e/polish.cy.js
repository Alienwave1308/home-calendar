describe('Home Calendar - Polish E2E', () => {
  const unique = Date.now();
  const testUser = `cypressuser-polish-${unique}`;
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
  });

  it('should show skeleton while tasks are loading', () => {
    cy.intercept('GET', '/api/tasks*', {
      statusCode: 200,
      delay: 700,
      body: { tasks: [], total: 0, page: 1, pages: 1 }
    }).as('tasksSlow');

    cy.get('.nav-item[data-route="tasks"]').click();
    cy.get('#tasksContainer .skeleton-line').should('exist');
    cy.wait('@tasksSlow');
    cy.contains('#tasksContainer .no-tasks', 'Пока нет задач').should('be.visible');
  });

  it('should show global network banner on request failure', () => {
    cy.intercept('GET', '/api/dashboard', { forceNetworkError: true }).as('dashboardFail');

    cy.get('.nav-item[data-route="tasks"]').click();
    cy.get('.nav-item[data-route="dashboard"]').click();
    cy.wait('@dashboardFail');

    cy.get('#networkBanner').should('be.visible');
    cy.get('#networkBannerText').should('contain', 'Ошибка сети');
  });
});
