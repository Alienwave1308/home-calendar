describe('TG Mini App - Kanban E2E', () => {
  const unique = Date.now();
  const testUser = `cypressuser-kanban-${unique}`;
  const testPass = 'cypress123';

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
    cy.get('.nav-item[data-route="kanban"]').click();
    cy.location('hash').should('eq', '#/kanban');
    cy.get('#screen-kanban').should('be.visible');
  });

  it('should create a task inside planned column', () => {
    const title = `Kanban Planned ${unique}`;

    cy.get('#kanbanInput-planned').type(title);
    cy.get('.kanban-column[data-status="planned"] .kanban-create-form').submit();

    cy.contains('.kanban-column[data-status="planned"] .kanban-card-title', title).should('be.visible');
  });

  it('should drag task from backlog to done', () => {
    const title = `Kanban Drag ${unique}`;

    cy.get('#kanbanInput-backlog').type(title);
    cy.get('.kanban-column[data-status="backlog"] .kanban-create-form').submit();
    cy.contains('.kanban-column[data-status="backlog"] .kanban-card-title', title).should('be.visible');

    cy.window().then((win) => {
      const dataTransfer = new win.DataTransfer();

      cy.contains('.kanban-column[data-status="backlog"] .kanban-card', title)
        .trigger('dragstart', { dataTransfer });

      cy.get('.kanban-column-dropzone[data-status="done"]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer });
    });

    cy.contains('.kanban-column[data-status="done"] .kanban-card-title', title)
      .scrollIntoView()
      .should('exist');
    cy.contains('.kanban-column[data-status="backlog"] .kanban-card-title', title).should('not.exist');
  });
});
