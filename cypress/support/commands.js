// Кастомная команда: регистрация нового пользователя через API
Cypress.Commands.add('register', (username, password) => {
  cy.request({
    method: 'POST',
    url: '/api/auth/register',
    body: { username, password },
    failOnStatusCode: false
  });
});

// Кастомная команда: логин через UI
Cypress.Commands.add('login', (username, password) => {
  cy.get('#loginUsername').type(username);
  cy.get('#loginPassword').type(password);
  cy.get('#loginForm').submit();
  cy.get('#appScreen').should('be.visible');
});
