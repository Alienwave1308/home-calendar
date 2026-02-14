(function (globalScope) {
  const KANBAN_STATUSES = ['backlog', 'planned', 'in_progress', 'done'];
  const KANBAN_COLUMN_TITLES = {
    backlog: 'Backlog',
    planned: 'Planned',
    in_progress: 'In Progress',
    done: 'Done'
  };

  function isKanbanStatus(status) {
    return KANBAN_STATUSES.includes(status);
  }

  function filterKanbanTasks(tasks) {
    if (!Array.isArray(tasks)) return [];
    return tasks.filter((task) => isKanbanStatus(task.status));
  }

  function groupTasksByStatus(tasks) {
    const groups = {
      backlog: [],
      planned: [],
      in_progress: [],
      done: []
    };

    filterKanbanTasks(tasks).forEach((task) => {
      groups[task.status].push(task);
    });

    return groups;
  }

  const api = {
    KANBAN_STATUSES,
    KANBAN_COLUMN_TITLES,
    isKanbanStatus,
    filterKanbanTasks,
    groupTasksByStatus
  };

  globalScope.KanbanUtils = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
