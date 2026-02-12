describe('Home Calendar - E2E Tests', () => {
  
  // Этот код выполняется перед каждым тестом
  beforeEach(() => {
    cy.visit('http://localhost:3000')
  })

  // Тест 1: Загрузка главной страницы
  it('should load the homepage', () => {
    cy.contains('Домашний Календарь')
    cy.contains('Управляй своими задачами')
  })

  // Тест 2: Добавление новой задачи
  it('should add a new task', () => {
    // Заполняем форму
    cy.get('#taskTitle').type('Купить молоко')
    cy.get('#taskDate').type('2026-02-15')
    
    // Отправляем форму
    cy.get('#taskForm').submit()
    
    // Проверяем, что задача появилась в списке
    cy.contains('Купить молоко')
    cy.contains('15 февраля 2026')
  })

  // Тест 3: Отметка задачи как выполненной
  it('should mark task as completed', () => {
    // Сначала добавляем задачу
    cy.get('#taskTitle').type('Помыть посуду')
    cy.get('#taskDate').type('2026-02-16')
    cy.get('#taskForm').submit()
    
    // Ждём появления задачи и кликаем "Выполнено"
    cy.contains('Помыть посуду').parent().parent()
      .find('.btn-complete').click()
    
    // Проверяем, что задача отмечена как выполненная
    cy.contains('Помыть посуду').parent().parent()
      .should('have.class', 'completed')
    
    // Проверяем, что кнопка изменилась на "Вернуть"
    cy.contains('↩️ Вернуть')
  })

  // Тест 4: Удаление задачи
  it('should delete a task', () => {
    // Добавляем задачу
    cy.get('#taskTitle').type('Задача для удаления')
    cy.get('#taskDate').type('2026-02-17')
    cy.get('#taskForm').submit()
    
    // Проверяем, что задача появилась
    cy.contains('Задача для удаления')
    
    // Автоматически подтверждаем удаление (без клика на OK)
    cy.on('window:confirm', () => true)
    
    // Кликаем кнопку удаления
    cy.contains('Задача для удаления').parent().parent()
      .find('.btn-delete').click()
    
    // Проверяем, что задачи больше нет
    cy.contains('Задача для удаления').should('not.exist')
  })
})

