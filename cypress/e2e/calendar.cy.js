describe('Home Calendar - E2E Tests', () => {
  const testUser = 'cypressuser';
  const testPass = 'cypress123';

  before(() => {
    // Регистрируем тестового пользователя один раз (через API)
    cy.register(testUser, testPass);
  });

  beforeEach(() => {
    // Чистим localStorage чтобы начать с экрана логина
    cy.clearLocalStorage();
    cy.visit('/');
  });

  // Тест 1: Загрузка страницы авторизации
  it('should load the auth screen', () => {
    cy.contains('Домашний Календарь');
    cy.contains('Войдите или зарегистрируйтесь');
    cy.get('#loginForm').should('be.visible');
  });

  // Тест 2: Переключение между вкладками вход/регистрация
  it('should switch between login and register tabs', () => {
    cy.get('#loginForm').should('be.visible');
    cy.get('#registerForm').should('not.be.visible');

    cy.contains('Регистрация').click();
    cy.get('#registerForm').should('be.visible');
    cy.get('#loginForm').should('not.be.visible');

    cy.contains('Вход').click();
    cy.get('#loginForm').should('be.visible');
  });

  // Тест 3: Успешный вход
  it('should login successfully', () => {
    cy.login(testUser, testPass);
    cy.get('#appScreen').should('be.visible');
    cy.contains(testUser);
  });

  // Тест 4: Добавление новой задачи
  it('should add a new task', () => {
    cy.login(testUser, testPass);

    cy.get('#taskTitle').type('Купить молоко');
    cy.get('#taskDate').type('2026-02-15');
    cy.get('#taskForm').submit();

    cy.contains('Купить молоко');
    cy.contains('15 февраля 2026');
  });

  // Тест 5: Переключение статуса задачи
  it('should cycle task status', () => {
    cy.login(testUser, testPass);

    // Добавляем задачу
    cy.get('#taskTitle').type('Тестовая задача');
    cy.get('#taskDate').type('2026-02-16');
    cy.get('#taskForm').submit();

    // Ждём задачу и кликаем кнопку смены статуса (Запланировано -> В работе)
    cy.contains('Тестовая задача')
      .parents('.task-item')
      .find('.btn-status')
      .click();

    // Проверяем что статус изменился
    cy.contains('Тестовая задача')
      .parents('.task-item')
      .contains('В работе');
  });

  // Тест 6: Удаление задачи
  it('should delete a task', () => {
    cy.login(testUser, testPass);

    cy.get('#taskTitle').type('Задача для удаления');
    cy.get('#taskDate').type('2026-02-17');
    cy.get('#taskForm').submit();

    cy.contains('Задача для удаления');

    // Подтверждаем confirm-диалог автоматически
    cy.on('window:confirm', () => true);

    cy.contains('Задача для удаления')
      .parents('.task-item')
      .find('.btn-delete')
      .click();

    cy.contains('Задача для удаления').should('not.exist');
  });

  // Тест 7: Выход из аккаунта
  it('should logout', () => {
    cy.login(testUser, testPass);
    cy.contains('Выйти').click();
    cy.get('#authScreen').should('be.visible');
    cy.get('#appScreen').should('not.be.visible');
  });

  // Тест 8: Секция семьи видна после логина
  it('should show family section after login', () => {
    cy.login(testUser, testPass);
    cy.get('#familySection').should('be.visible');
    cy.contains('Семья');
    cy.contains('Создайте семью или присоединитесь');
  });

  // Тест 9: Календарь отображается после логина
  it('should display calendar with month navigation', () => {
    cy.login(testUser, testPass);
    cy.get('.calendar-section').should('be.visible');
    cy.get('#calendarTitle').should('not.be.empty');
    cy.get('.calendar-grid .calendar-day').should('have.length.greaterThan', 27);
  });

  // Тест 10: Навигация по месяцам
  it('should navigate between months', () => {
    cy.login(testUser, testPass);
    // Ждём пока календарь отрендерится
    cy.get('#calendarTitle').should('not.have.text', '').invoke('text').then(initialTitle => {
      // Клик вперёд
      cy.get('.calendar-header .btn-nav').last().click();
      cy.get('#calendarTitle').should('not.have.text', initialTitle);
      // Клик назад
      cy.get('.calendar-header .btn-nav').first().click();
      cy.get('#calendarTitle').should('have.text', initialTitle);
    });
  });

  // Тест 11: Открытие модального окна дня
  it('should open day modal on click', () => {
    cy.login(testUser, testPass);
    // Кликаем на любой день текущего месяца (не other-month)
    cy.get('.calendar-day:not(.other-month)').first().click();
    cy.get('#dayModal').should('be.visible');
    cy.get('#modalDate').should('not.be.empty');
    // Закрываем
    cy.get('.modal-header .btn-nav').click();
    cy.get('#dayModal').should('not.be.visible');
  });

  // Тест 12: Добавление задачи через модал
  it('should add task from day modal', () => {
    cy.login(testUser, testPass);
    cy.get('.calendar-day:not(.other-month)').first().click();
    cy.get('#modalTaskTitle').type('Задача из модала');
    cy.get('.modal-add .btn-primary').click();
    cy.get('.modal-task').should('contain', 'Задача из модала');
  });

  // Тест 13: Добавление задачи с приоритетом
  it('should add a task with priority', () => {
    cy.login(testUser, testPass);

    cy.get('#taskTitle').type('Срочная задача');
    cy.get('#taskDate').type('2026-02-20');
    cy.get('#taskPriority').select('urgent');
    cy.get('#taskForm').submit();

    cy.contains('Срочная задача')
      .parents('.task-item')
      .should('have.attr', 'data-priority', 'urgent');
  });

  // Тест 14: Селект приоритета и статуса видны в форме
  it('should show priority and status selects in task form', () => {
    cy.login(testUser, testPass);
    cy.get('#taskPriority').should('be.visible');
    cy.get('#taskStatus').should('be.visible');
    cy.get('#taskPriority option').should('have.length', 4);
    cy.get('#taskStatus option').should('have.length', 3);
  });
});
