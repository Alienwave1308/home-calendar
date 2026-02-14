describe('Home Calendar - Auth E2E', () => {
  const testUser = 'cypressuser';
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
  });

  it('should load the auth screen', () => {
    cy.contains('Family Task Tracker');
    cy.contains('Войдите или зарегистрируйтесь');
    cy.get('#loginForm').should('be.visible');
  });

  it('should switch between login and register tabs', () => {
    cy.get('#loginForm').should('be.visible');
    cy.get('#registerForm').should('not.be.visible');

    cy.contains('Регистрация').click();
    cy.get('#registerForm').should('be.visible');
    cy.get('#loginForm').should('not.be.visible');

    cy.contains('Вход').click();
    cy.get('#loginForm').should('be.visible');
  });

  it('should login successfully', () => {
    cy.login(testUser, testPass);
    cy.get('#appScreen').should('be.visible');
    cy.location('hash').should('eq', '#/dashboard');
    cy.contains(testUser);
  });

  it('should logout', () => {
    cy.login(testUser, testPass);
    cy.contains('Выйти').click();
    cy.get('#authScreen').should('be.visible');
    cy.get('#appScreen').should('not.be.visible');
  });
});
