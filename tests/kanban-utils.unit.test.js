const {
  KANBAN_STATUSES,
  KANBAN_COLUMN_TITLES,
  isKanbanStatus,
  filterKanbanTasks,
  groupTasksByStatus
} = require('../frontend/kanban-utils');

describe('Kanban utils', () => {
  it('should expose roadmap statuses and titles', () => {
    expect(KANBAN_STATUSES).toEqual(['backlog', 'planned', 'in_progress', 'done']);
    expect(KANBAN_COLUMN_TITLES).toEqual({
      backlog: 'Бэклог',
      planned: 'Запланировано',
      in_progress: 'В работе',
      done: 'Выполнено'
    });
  });

  it('should validate only kanban statuses', () => {
    expect(isKanbanStatus('planned')).toBe(true);
    expect(isKanbanStatus('canceled')).toBe(false);
  });

  it('should filter tasks to kanban statuses only', () => {
    const tasks = [
      { id: 1, status: 'backlog' },
      { id: 2, status: 'planned' },
      { id: 3, status: 'archived' }
    ];

    expect(filterKanbanTasks(tasks).map((task) => task.id)).toEqual([1, 2]);
  });

  it('should group tasks by status', () => {
    const tasks = [
      { id: 1, status: 'backlog' },
      { id: 2, status: 'done' },
      { id: 3, status: 'planned' },
      { id: 4, status: 'done' },
      { id: 5, status: 'canceled' }
    ];

    const grouped = groupTasksByStatus(tasks);
    expect(grouped.backlog.map((task) => task.id)).toEqual([1]);
    expect(grouped.planned.map((task) => task.id)).toEqual([3]);
    expect(grouped.in_progress).toHaveLength(0);
    expect(grouped.done.map((task) => task.id)).toEqual([2, 4]);
  });
});
