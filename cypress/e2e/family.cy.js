describe('Home Calendar - Family E2E', () => {
  const testUser = 'cypressuser';
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
    cy.get('.nav-item[data-route="family"]').click();
    cy.location('hash').should('eq', '#/family');
  });

  it('should show family section after login', () => {
    cy.get('#familySection').should('be.visible');
    cy.contains('Семья');
    cy.contains('Создайте семью или присоединитесь');
  });
});
