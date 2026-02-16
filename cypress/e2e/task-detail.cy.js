describe('TG Mini App - Task Detail E2E', () => {
  const unique = Date.now();
  const testUser = `cypressuser-detail-${unique}`;
  const testPass = 'cypress123';
  const taskTitle = `Detail Task ${unique}`;

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
    cy.get('.nav-item[data-route="tasks"]').click();
    cy.location('hash').should('eq', '#/tasks');

    cy.get('#taskTitle').clear().type(taskTitle);
    cy.get('#taskDate').clear().type('2026-06-20');
    cy.get('#taskForm').submit();
    cy.contains('.task-item', taskTitle).should('be.visible');
  });

  it('should open task detail and update description with markdown preview', () => {
    cy.contains('.task-item', taskTitle).find('.task-actions button').contains('Подробнее').click();
    cy.get('#taskDetailModal').should('be.visible');

    cy.get('#taskDetailDescription').clear().type('**важно** и `код`');
    cy.contains('button', 'Сохранить описание').click();

    cy.get('#taskDetailDescriptionPreview strong').should('contain', 'важно');
    cy.get('#taskDetailDescriptionPreview code').should('contain', 'код');
  });

  it('should add checklist item and comment in task detail', () => {
    cy.contains('.task-item', taskTitle).find('.task-actions button').contains('Подробнее').click();
    cy.get('#taskDetailModal').should('be.visible');

    cy.get('#taskDetailChecklistInput').type('Проверить чеклист');
    cy.get('#taskDetailChecklistInput').parent().contains('button', 'Добавить').click();
    cy.contains('#taskDetailChecklist .detail-check-item', 'Проверить чеклист').should('be.visible');

    cy.get('#taskDetailCommentInput').type('Первый комментарий');
    cy.contains('button', 'Отправить').click();
    cy.contains('#taskDetailComments .detail-comment', 'Первый комментарий').should('be.visible');
  });
});
