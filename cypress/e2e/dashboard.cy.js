describe('TG Mini App - Dashboard E2E', () => {
  const testUser = 'cypressuser';
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
  });

  it('should show dashboard summary cards', () => {
    cy.intercept('GET', '/api/dashboard', {
      statusCode: 200,
      body: {
        stats: { today_count: 1, overdue_count: 2, upcoming_count: 3, done_week: 4 },
        today: [],
        overdue: [],
        upcoming: []
      }
    }).as('getDashboard');

    cy.get('.nav-item[data-route="dashboard"]').click();
    cy.location('hash').should('eq', '#/dashboard');
    cy.wait('@getDashboard');

    cy.contains('Сводка');
    cy.get('#dashTodayCount').should('be.visible');
    cy.get('#dashOverdueCount').should('be.visible');
    cy.get('#dashUpcomingCount').should('be.visible');
    cy.get('#dashDoneWeek').should('be.visible');
  });

  it('should create task from dashboard quick form and open it from summary', () => {
    const title = `Quick task ${Date.now()}`;

    cy.get('.nav-item[data-route="dashboard"]').click();
    cy.location('hash').should('eq', '#/dashboard');

    cy.get('#dashboardQuickTitle').type(title);
    cy.get('#dashboardQuickForm').submit();

    cy.get('#dashTodayList').contains(title).click();

    cy.location('hash').should('eq', '#/tasks');
    cy.get('#tasksContainer').contains(title);
  });

  it('should show API error text when dashboard endpoint returns 500', () => {
    cy.intercept('GET', '/api/dashboard', {
      statusCode: 500,
      body: { error: 'Сводка недоступна' }
    }).as('getDashboardFail');

    cy.get('.nav-item[data-route="dashboard"]').click();
    cy.wait('@getDashboardFail');

    cy.get('#dashboardError').should('contain', 'Сводка недоступна');
  });

  it('should handle network error while loading dashboard', () => {
    cy.intercept('GET', '/api/dashboard', { forceNetworkError: true }).as('getDashboardNetworkFail');

    cy.get('.nav-item[data-route="dashboard"]').click();
    cy.wait('@getDashboardNetworkFail');

    cy.get('#dashboardError').should('contain', 'Ошибка соединения с сервером');
  });

  it('should logout when dashboard endpoint returns 401', () => {
    cy.intercept('GET', '/api/dashboard', {
      statusCode: 401,
      body: { error: 'Unauthorized' }
    }).as('getDashboard401');

    cy.get('.nav-item[data-route="dashboard"]').click();
    cy.wait('@getDashboard401');

    cy.get('#authScreen').should('be.visible');
    cy.get('#appScreen').should('not.be.visible');
  });

  it('should show quick form error when task creation fails', () => {
    cy.intercept('POST', '/api/tasks', {
      statusCode: 500,
      body: { error: 'Cannot create task' }
    }).as('createTaskFail');

    cy.get('.nav-item[data-route="dashboard"]').click();
    cy.location('hash').should('eq', '#/dashboard');
    cy.get('#dashboardQuickTitle').type('Fail quick task');
    cy.get('#dashboardQuickForm').submit();
    cy.wait('@createTaskFail');

    cy.get('#dashboardError').should('contain', 'Не удалось добавить задачу');
  });
});
