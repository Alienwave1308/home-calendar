(function (globalScope) {
  const ROUTES = ['dashboard', 'calendar', 'tasks', 'kanban', 'family', 'activity'];

  function normalizeRoute(route) {
    return ROUTES.includes(route) ? route : 'dashboard';
  }

  function getRouteFromHash(hash) {
    const raw = (hash || '').replace('#/', '');
    return normalizeRoute(raw);
  }

  function buildHash(route) {
    return `#/${normalizeRoute(route)}`;
  }

  const api = {
    ROUTES,
    normalizeRoute,
    getRouteFromHash,
    buildHash
  };

  globalScope.RouterUtils = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
