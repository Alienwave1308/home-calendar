describe('Telegram mini app utils', () => {
  afterEach(() => {
    jest.resetModules();
    delete global.Telegram;
    delete global.confirm;
    delete global.alert;
  });

  it('should fallback to browser confirm/alert when Telegram SDK is unavailable', async () => {
    global.confirm = jest.fn(() => true);
    global.alert = jest.fn();

    const api = require('../frontend/telegram-miniapp');
    const ok = await api.confirm('Удалить?');
    await api.alert('Ошибка');

    expect(ok).toBe(true);
    expect(global.confirm).toHaveBeenCalledWith('Удалить?');
    expect(global.alert).toHaveBeenCalledWith('Ошибка');
  });

  it('should use Telegram WebApp APIs when available', async () => {
    const showConfirm = jest.fn((message, cb) => cb(message === 'Удалить?'));
    const showAlert = jest.fn((_, cb) => cb && cb());
    const onEvent = jest.fn();
    const backShow = jest.fn();
    const backHide = jest.fn();

    global.Telegram = {
      WebApp: {
        showConfirm,
        showAlert,
        onEvent,
        BackButton: { show: backShow, hide: backHide },
        ready: jest.fn(),
        expand: jest.fn(),
        setHeaderColor: jest.fn(),
        initData: 'query_id=abc&user=%7B%22id%22%3A1%7D',
        themeParams: {}
      }
    };

    const api = require('../frontend/telegram-miniapp');
    expect(api.init()).toBe(true);

    const confirmed = await api.confirm('Удалить?');
    expect(confirmed).toBe(true);
    expect(showConfirm).toHaveBeenCalled();

    await api.alert('ok');
    expect(showAlert).toHaveBeenCalled();
    expect(api.getInitData()).toBe('query_id=abc&user=%7B%22id%22%3A1%7D');

    api.setBackButtonVisible(true);
    api.setBackButtonVisible(false);
    expect(backShow).toHaveBeenCalledTimes(1);
    expect(backHide).toHaveBeenCalledTimes(1);

    api.onBackButton(() => {});
    expect(onEvent).toHaveBeenCalledWith('backButtonClicked', expect.any(Function));
  });
});
