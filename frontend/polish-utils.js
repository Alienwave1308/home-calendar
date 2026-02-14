(function (globalScope) {
  function getNetworkMessage(isOnline) {
    return isOnline ? '' : 'Вы офлайн. Данные могут быть неактуальны.';
  }

  function makeSkeleton(count = 3) {
    const safeCount = Math.max(1, Math.min(Number(count) || 3, 12));
    const lines = Array.from({ length: safeCount }, () => '<div class="skeleton-line"></div>').join('');
    return `<div class="skeleton-list">${lines}</div>`;
  }

  const api = {
    getNetworkMessage,
    makeSkeleton
  };

  globalScope.PolishUtils = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
