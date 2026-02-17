# RoVa Epil Telegram Mini App

Telegram Mini App для записи к мастеру (Node.js + Vanilla JS + PostgreSQL).

## Актуальная документация

- `docs/PROJECT_REFERENCE.md` — основной source of truth по архитектуре и правилам.
- `docs/AI_COLLABORATION.md` — процесс работы и релиза (Codex + Claude Code).
- `docs/HANDOFF_TEMPLATE.md` — шаблон передачи контекста между сессиями.
- `docs/PROD_TG_RELEASE.md` — prod checklist/env/reset.

## Что реализовано
- Telegram-only auth
- Роли: мастер/клиент
- Клиентский booking flow (`/book/:slug`)
- Панель мастера (`/master`)
- Услуги, записи, рабочие окна, блоки, напоминания, экспорт календарей
- CI: lint -> параллельные backend/e2e -> summary

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

## Cypress в контейнере (обход проблем локального бинарника)
```bash
# Обязательный gate перед любым деплоем
npm run predeploy:check:docker

# Один целевой spec (экспорт в календарь)
npm run cypress:booking-export:docker

# Все e2e-спеки
npm run cypress:run:docker

# Полная pre-deploy проверка: lint + jest + dockerized e2e
npm run predeploy:check

# Очистить контейнеры/volume после прогона
npm run cypress:docker:down
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
