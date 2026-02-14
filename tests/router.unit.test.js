const {
  ROUTES,
  normalizeRoute,
  getRouteFromHash,
  buildHash
} = require('../frontend/router');

describe('Router utils', () => {
  it('should include phase 9 routes', () => {
    expect(ROUTES).toEqual(expect.arrayContaining([
      'dashboard',
      'calendar',
      'tasks',
      'kanban',
      'family',
      'activity'
    ]));
  });

  it('should normalize unknown route to dashboard', () => {
    expect(normalizeRoute('unknown')).toBe('dashboard');
  });

  it('should parse hash route', () => {
    expect(getRouteFromHash('#/tasks')).toBe('tasks');
    expect(getRouteFromHash('#/kanban')).toBe('kanban');
  });

  it('should fallback to dashboard for invalid hash', () => {
    expect(getRouteFromHash('#/not-real')).toBe('dashboard');
    expect(getRouteFromHash('')).toBe('dashboard');
  });

  it('should build valid hash for route', () => {
    expect(buildHash('calendar')).toBe('#/calendar');
    expect(buildHash('bad-route')).toBe('#/dashboard');
  });
});
