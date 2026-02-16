describe('Home Calendar - Mobile Layout E2E', () => {
  const testUser = 'cypressmobile';
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.viewport('iphone-x');
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
  });

  it('should keep mobile navigation accessible and switch screens', () => {
    cy.get('#bottomNav').should('be.visible');

    cy.get('.nav-item[data-route="calendar"]').click();
    cy.get('#screen-calendar').should('be.visible');

    cy.get('.nav-item[data-route="tasks"]').click();
    cy.get('#screen-tasks').should('be.visible');

    cy.get('.nav-item[data-route="clients"]').click();
    cy.get('#screen-clients').should('be.visible');
  });

  it('should stack task filters into one column on mobile', () => {
    cy.get('.nav-item[data-route="tasks"]').click();

    cy.get('.tasks-filters').should(($filters) => {
      const columns = getComputedStyle($filters[0]).gridTemplateColumns.split(' ');
      expect(columns).to.have.length(1);
    });
    cy.get('#tasksApplyFilters').should('be.visible');
  });

  it('should show modal in fullscreen mode on mobile', () => {
    cy.get('.nav-item[data-route="calendar"]').click();
    cy.get('.calendar-day').first().click();

    cy.get('#dayModal .modal').should('have.css', 'border-radius', '0px');
    cy.get('#dayModal .modal').should('be.visible');
    cy.get('#modalTaskTitle').should('be.visible');
    cy.get('#dayModal .btn-nav').contains('×').should('be.visible');
  });
});
