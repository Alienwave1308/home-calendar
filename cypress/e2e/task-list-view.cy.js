describe('TG Mini App - Task List View E2E', () => {
  const unique = Date.now();
  const testUser = `cypressuser-tasklist-${unique}`;
  const testPass = 'cypress123';

  const createTaskViaApi = (task) => {
    cy.window().then((win) => {
      const token = win.localStorage.getItem('authToken');
      cy.request({
        method: 'POST',
        url: '/api/tasks',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          title: task.title,
          date: task.date,
          status: task.status || 'planned',
          priority: task.priority || 'medium'
        }
      }).its('status').should('eq', 201);
    });
  };

  before(() => {
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.visit('/');
    cy.login(testUser, testPass);
    cy.get('.nav-item[data-route="tasks"]').click();
    cy.location('hash').should('eq', '#/tasks');
  });

  it('should filter tasks by status', () => {
    createTaskViaApi({ title: `Filter Planned Task ${unique}`, date: '2026-03-01', status: 'planned' });
    createTaskViaApi({ title: `Filter InProgress Task ${unique}`, date: '2026-03-02', status: 'in_progress' });

    cy.get('#tasksFilterStatus').select('in_progress');
    cy.get('#tasksApplyFilters').click();

    cy.contains(`Filter InProgress Task ${unique}`).should('be.visible');
    cy.contains(`Filter Planned Task ${unique}`).should('not.exist');
  });

  it('should sort tasks by title desc', () => {
    createTaskViaApi({ title: `AAA Sort Task ${unique}`, date: '2026-03-03' });
    createTaskViaApi({ title: `ZZZ Sort Task ${unique}`, date: '2026-03-04' });

    cy.get('#tasksSortBy').select('title');
    cy.get('#tasksSortOrder').select('desc');
    cy.get('#tasksApplyFilters').click();

    cy.get('#tasksContainer .task-title').first().should('contain', `ZZZ Sort Task ${unique}`);
  });

  it('should bulk update selected tasks to done', () => {
    createTaskViaApi({ title: `Bulk Done A ${unique}`, date: '2026-03-05', status: 'planned' });
    createTaskViaApi({ title: `Bulk Done B ${unique}`, date: '2026-03-06', status: 'planned' });
    cy.get('#tasksApplyFilters').click();

    cy.contains('.task-item', `Bulk Done A ${unique}`).find('.task-select').check();
    cy.contains('.task-item', `Bulk Done B ${unique}`).find('.task-select').check();
    cy.get('#tasksSelectedCount').should('contain', '2');

    cy.get('#bulkSetDone').click();
    cy.contains('.task-item', `Bulk Done A ${unique}`).find('.task-status').should('contain', 'Готово');
    cy.contains('.task-item', `Bulk Done B ${unique}`).find('.task-status').should('contain', 'Готово');
  });

  it('should bulk delete selected tasks', () => {
    createTaskViaApi({ title: `Bulk Delete A ${unique}`, date: '2026-03-07' });
    createTaskViaApi({ title: `Bulk Delete B ${unique}`, date: '2026-03-08' });
    cy.get('#tasksApplyFilters').click();

    cy.contains('.task-item', `Bulk Delete A ${unique}`).find('.task-select').check();
    cy.contains('.task-item', `Bulk Delete B ${unique}`).find('.task-select').check();
    cy.window().then((win) => {
      cy.stub(win, 'confirm').returns(true);
    });
    cy.get('#bulkDelete').click();
    cy.contains(`Bulk Delete A ${unique}`).should('not.exist');
    cy.contains(`Bulk Delete B ${unique}`).should('not.exist');
  });

  it('should rename task title via inline edit prompt', () => {
    createTaskViaApi({ title: `Inline Edit Old ${unique}`, date: '2026-03-09' });
    cy.get('#tasksApplyFilters').click();

    cy.window().then((win) => {
      cy.stub(win, 'prompt').returns(`Inline Edit New ${unique}`);
    });
    cy.contains('.task-item', `Inline Edit Old ${unique}`)
      .find('.task-title')
      .dblclick();

    cy.contains(`Inline Edit New ${unique}`).should('be.visible');
    cy.contains(`Inline Edit Old ${unique}`).should('not.exist');
  });

  it('should paginate when there are more than 20 tasks', () => {
    const bulkTitles = Array.from({ length: 21 }, (_, i) => `Page Test ${unique} ${String(i + 1).padStart(2, '0')}`);
    bulkTitles.forEach((title, index) => {
      createTaskViaApi({ title, date: `2026-04-${String((index % 9) + 1).padStart(2, '0')}` });
    });

    cy.get('#tasksSortBy').select('title');
    cy.get('#tasksSortOrder').select('asc');
    cy.get('#tasksApplyFilters').click();

    cy.get('#tasksPageInfo').should('contain', 'Страница 1 / 2');
    cy.get('#tasksNextPage').click();
    cy.get('#tasksPageInfo').should('contain', 'Страница 2 / 2');
    cy.contains(`Page Test ${unique} 21`).should('be.visible');
  });
});
