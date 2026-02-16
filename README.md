# Home Calendar / Family Task Tracker

Семейный таск-трекер на Node.js + Vanilla JS.

## Что реализовано
- Auth, семья, роли
- Задачи: список, фильтры, пагинация, массовые действия
- Календарь: месяц/неделя/день
- Канбан с drag-and-drop
- Карточка задачи: описание (markdown preview), чек-лист, комментарии, теги, исполнители, история
- CI: lint + backend tests + параллельные e2e по секциям + e2e coverage

## Фаза 24 (полировка)
- Глобальный banner для offline/сетевых сбоев
- Skeleton loading для основных экранов
- Улучшенные пустые состояния с подсказками
- Ленивая загрузка данных по route (без раннего preload после логина)
- PWA мета/manifest + favicon и app icons

## Telegram Mini App
- Фронтенд поддерживает запуск внутри Telegram WebView (без открытия внешнего браузера).
- Включены: `Telegram.WebApp.ready()`, `expand()`, обработка `BackButton`, popup-confirm/alert внутри Telegram, применение `themeParams`.
- Добавлен backend endpoint `POST /api/auth/telegram` для автологина по `initData` (подпись и срок валидируются на сервере).
- Обязательная переменная окружения для backend: `TELEGRAM_BOT_TOKEN`.
- Для публикации в Telegram:
  1. Укажи production URL через `@BotFather` -> `/setdomain` (домен должен быть с HTTPS).
  2. Настрой кнопку запуска Web App (`/setmenubutton`) или inline-кнопку `web_app`.
  3. Открывай приложение только через эту кнопку бота, тогда оно запустится как Mini App внутри Telegram.

## Локальный запуск
```bash
npm install
npm run lint
npm test
npm run cypress:run
node backend/server.js
```

Открыть: `http://localhost:3000`

## Docker
```bash
docker-compose up --build
```

## Production HTTPS (Telegram Mini App)
Production deploy now uses `docker-compose.prod.yml` + Caddy (automatic Let's Encrypt TLS).

Required GitHub repository secrets for Deploy workflow:
- `APP_DOMAIN` (example: `app.example.com`)
- `LETSENCRYPT_EMAIL`
- `JWT_SECRET`
- `TELEGRAM_BOT_TOKEN`
- existing: `DEPLOY_HOST`, `DEPLOY_SSH_KEY`

Also required:
- DNS `A` record for `APP_DOMAIN` must point to your VPS public IP.
- Ports `80` and `443` must be open on VPS firewall/security group.
