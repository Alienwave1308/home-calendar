(function (globalScope) {
  let backHandler = null;

  function getWebApp() {
    return globalScope.Telegram && globalScope.Telegram.WebApp
      ? globalScope.Telegram.WebApp
      : null;
  }

  function isRealMiniApp(webApp) {
    if (!webApp) return false;
    if (typeof webApp.initData === 'string' && webApp.initData.length > 0) return true;
    return Boolean(webApp.initDataUnsafe && webApp.initDataUnsafe.user);
  }

  function applyTheme(themeParams = {}) {
    if (!globalScope.document || !globalScope.document.documentElement) return;
    const root = globalScope.document.documentElement;
    const map = {
      bg_color: '--tg-bg-color',
      text_color: '--tg-text-color',
      secondary_bg_color: '--tg-secondary-bg-color',
      hint_color: '--tg-hint-color',
      link_color: '--tg-link-color',
      button_color: '--tg-button-color',
      button_text_color: '--tg-button-text-color'
    };

    Object.entries(map).forEach(([sourceKey, cssVar]) => {
      const value = themeParams[sourceKey];
      if (value) root.style.setProperty(cssVar, value);
    });
  }

  function init() {
    const webApp = getWebApp();
    if (!isRealMiniApp(webApp)) return false;

    try {
      if (typeof webApp.ready === 'function') webApp.ready();
      if (typeof webApp.expand === 'function') webApp.expand();
      if (typeof webApp.disableVerticalSwipes === 'function') webApp.disableVerticalSwipes();
      if (typeof webApp.setHeaderColor === 'function') webApp.setHeaderColor('#2f9f68');
      applyTheme(webApp.themeParams || {});
      if (globalScope.document && globalScope.document.documentElement) {
        globalScope.document.documentElement.classList.add('is-telegram-mini-app');
      }
      return true;
    } catch {
      return false;
    }
  }

  function onBackButton(handler) {
    const webApp = getWebApp();
    if (!isRealMiniApp(webApp) || !webApp.BackButton || typeof webApp.onEvent !== 'function') return;

    if (backHandler && typeof webApp.offEvent === 'function') {
      webApp.offEvent('backButtonClicked', backHandler);
    }

    backHandler = handler;
    webApp.onEvent('backButtonClicked', backHandler);
  }

  function setBackButtonVisible(visible) {
    const webApp = getWebApp();
    if (!isRealMiniApp(webApp) || !webApp.BackButton) return;
    if (visible) webApp.BackButton.show();
    else webApp.BackButton.hide();
  }

  function confirm(message) {
    const webApp = getWebApp();
    if (isRealMiniApp(webApp) && typeof webApp.showConfirm === 'function') {
      return new Promise((resolve) => {
        webApp.showConfirm(message, (ok) => resolve(Boolean(ok)));
      });
    }
    return Promise.resolve(globalScope.confirm(message));
  }

  function alert(message) {
    const webApp = getWebApp();
    if (isRealMiniApp(webApp) && typeof webApp.showAlert === 'function') {
      return new Promise((resolve) => {
        webApp.showAlert(message, resolve);
      });
    }
    globalScope.alert(message);
    return Promise.resolve();
  }

  const api = {
    init,
    onBackButton,
    setBackButtonVisible,
    confirm,
    alert,
    isMiniApp: () => isRealMiniApp(getWebApp()),
    getInitData: () => (isRealMiniApp(getWebApp()) ? getWebApp().initData : ''),
    getStartParam: () => getWebApp()?.initDataUnsafe?.start_param || null
  };

  globalScope.TelegramMiniApp = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
