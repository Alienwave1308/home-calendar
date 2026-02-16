// Кастомная команда: регистрация нового пользователя через API
Cypress.Commands.add('register', (username, password) => {
  cy.request({
    method: 'POST',
    url: '/api/auth/register',
    body: { username, password },
    failOnStatusCode: false
  });
});

function loginWithUi(username, password) {
  cy.get('#loginUsername').clear().type(username);
  cy.get('#loginPassword').clear().type(password);
  cy.get('#loginForm').submit();
  cy.get('#appScreen').should('be.visible');
}

function loginWithApi(username, password) {
  cy.request({
    method: 'POST',
    url: '/api/auth/login',
    body: { username, password }
  }).then((response) => {
    expect(response.status).to.eq(200);
    expect(response.body).to.have.property('token');
    expect(response.body).to.have.property('user');

    cy.window().then((win) => {
      win.localStorage.setItem('authToken', response.body.token);
      win.localStorage.setItem('token', response.body.token);
      win.localStorage.setItem('currentUser', JSON.stringify(response.body.user));
      win.localStorage.removeItem('currentRole');
      win.localStorage.removeItem('currentBookingSlug');
    });
  });
}

// Кастомная команда: логин (по умолчанию через API bootstrap)
Cypress.Commands.add('login', (username, password, options = {}) => {
  const mode = options.mode || Cypress.env('AUTH_MODE') || 'api';
  if (mode === 'ui') {
    loginWithUi(username, password);
    return;
  }

  loginWithApi(username, password);
  cy.reload();
  cy.get('#appScreen').should('be.visible');
});
