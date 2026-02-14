describe('Home Calendar - Calendar E2E', () => {
  const testUser = 'cypressuser';
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
    cy.get('.nav-item[data-route="calendar"]').click();
    cy.location('hash').should('eq', '#/calendar');
  });

  it('should display calendar with month navigation', () => {
    cy.get('.calendar-section').should('be.visible');
    cy.get('#calendarTitle').should('not.be.empty');
    cy.get('.calendar-grid .calendar-day').should('have.length.greaterThan', 27);
  });

  it('should navigate between months', () => {
    cy.get('#calendarTitle')
      .should('not.have.text', '')
      .invoke('text')
      .then((initialTitle) => {
        cy.get('.calendar-header .btn-nav').last().click();
        cy.get('#calendarTitle').should('not.have.text', initialTitle);
        cy.get('.calendar-header .btn-nav').first().click();
        cy.get('#calendarTitle').should('have.text', initialTitle);
      });
  });

  it('should open day modal on click', () => {
    cy.get('.calendar-day:not(.other-month)').first().click();
    cy.get('#dayModal').should('be.visible');
    cy.get('#modalDate').should('not.be.empty');
    cy.get('.modal-header .btn-nav').click();
    cy.get('#dayModal').should('not.be.visible');
  });

  it('should add task from day modal', () => {
    cy.get('.calendar-day:not(.other-month)').first().click();
    cy.get('#modalTaskTitle').type('Задача из модала');
    cy.get('.modal-add .btn-primary').click();
    cy.get('.modal-task').should('contain', 'Задача из модала');
  });
});
