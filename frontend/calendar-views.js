(function (globalScope) {
  function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
  }

  function getWeekDates(date) {
    const start = getWeekStart(date);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  const api = {
    toIsoDate,
    addDays,
    getWeekStart,
    getWeekDates
  };

  globalScope.CalendarViews = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
