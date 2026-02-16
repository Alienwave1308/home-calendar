describe('TG Mini App - Calendar Views E2E', () => {
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

  it('should switch between month, week and day views', () => {
    cy.get('.calendar-view-btn[data-view="month"]').should('have.class', 'active');
    cy.get('#calendarGrid').should('be.visible');

    cy.get('.calendar-view-btn[data-view="week"]').click();
    cy.get('.calendar-view-btn[data-view="week"]').should('have.class', 'active');
    cy.get('#calendarWeekView').should('be.visible');
    cy.get('.week-day-column').should('have.length', 7);

    cy.get('.calendar-view-btn[data-view="day"]').click();
    cy.get('.calendar-view-btn[data-view="day"]').should('have.class', 'active');
    cy.get('#calendarDayView').should('be.visible');
  });

  it('should navigate periods in week and day views', () => {
    cy.get('.calendar-view-btn[data-view="week"]').click();
    cy.get('#calendarTitle').invoke('text').then((initialTitle) => {
      cy.get('.calendar-header .btn-nav').last().click();
      cy.get('#calendarTitle').should('not.have.text', initialTitle);
    });

    cy.get('.calendar-view-btn[data-view="day"]').click();
    cy.get('#calendarTitle').invoke('text').then((initialDayTitle) => {
      cy.get('.calendar-header .btn-nav').last().click();
      cy.get('#calendarTitle').should('not.have.text', initialDayTitle);
    });
  });

  it('should persist selected view in localStorage after reload', () => {
    cy.get('.calendar-view-btn[data-view="week"]').click();
    cy.reload();
    cy.get('.calendar-view-btn[data-view="week"]').should('have.class', 'active');
    cy.get('#calendarWeekView').should('be.visible');
  });
});
