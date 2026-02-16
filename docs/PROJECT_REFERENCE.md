# Project Reference (Source of Truth)

Последнее обновление: 2026-02-16

## 1. Что это за проект

Telegram Mini App для записи к мастеру (депиляция), с двумя ролями:

- `master` — единственный мастер-аккаунт (Telegram).
- `client` — все остальные пользователи (Telegram).

Приложение работает в проде через:

- `https://rova-epil.ru`
- клиентский поток записи: `/book/:slug`
- панель мастера: `/master`

## 2. Ключевые правила домена

- Только Telegram Mini App auth (`/api/auth/telegram`), web/password auth отключен в проде.
- Таймзона бизнес-логики: `Asia/Novosibirsk` (по умолчанию и для клиентского booking-flow).
- Свободные окна задаются мастером по **дате** (`availability_windows`), не по дню недели.
- Клиентский шаг бронирования: **10 минут**.
- Минимальный lead-time до записи: по умолчанию `60` минут (настраивается).
- Для первой записи клиента применяется скидка (по умолчанию `15%`, настраивается).
- Напоминания клиенту: 2 точки (по умолчанию `24` и `2` часа, настраиваются).

## 3. Технологии

- Backend: `Node.js`, `Express`, `pg`, `JWT`, `helmet`, `cors`.
- Frontend: `Vanilla JS`, HTML/CSS.
- DB: PostgreSQL.
- Unit/integration: `Jest` + `supertest`.
- E2E: `Cypress`.
- CI/CD: GitHub Actions (`ci.yml`, `deploy.yml`).
- Prod runtime: Docker Compose + Caddy (`docker-compose.prod.yml`).

## 4. Основные директории

- `backend/` — API, бизнес-логика, миграции.
- `frontend/` — клиентский UI (`booking.*`, `master.*`, `app.*` legacy).
- `cypress/e2e/` — E2E-спеки по секциям.
- `tests/` — unit-тесты утилит.
- `docs/` — эксплуатационная и командная документация.

## 5. Важные таблицы БД

- `users` — пользователи (Telegram users в формате `tg_<id>`).
- `masters` — профиль мастера и `booking_slug`.
- `services` — услуги/комплексы, длительность и цена.
- `bookings` — записи клиентов.
- `availability_windows` — рабочие окна мастера по датам.
- `availability_exclusions` — исключения/выходные.
- `master_blocks` — ручные блоки времени.
- `master_settings`:
  - `reminder_hours` (2 значения),
  - `min_booking_notice_minutes`,
  - `first_visit_discount_percent`,
  - Apple Calendar fields.
- `booking_reminders` — очередь клиентских напоминаний.

## 6. Основные backend-эндпоинты

### Auth

- `POST /api/auth/telegram`

### Master

- `GET/PUT /api/master/profile`
- `GET/POST/PUT/DELETE /api/master/services*`
- `POST /api/master/services/bootstrap-default`
- `GET/POST/DELETE /api/master/availability/windows*`
- `GET/POST/DELETE /api/master/availability/exclusions*`
- `GET/POST/PUT/PATCH /api/master/bookings*`
- `GET/POST/PUT/DELETE /api/master/blocks*`
- `GET/PUT /api/master/settings`
- Apple feed controls:
  - `POST /api/master/settings/apple-calendar/enable`
  - `POST /api/master/settings/apple-calendar/rotate`
  - `POST /api/master/settings/apple-calendar/disable`

### Public booking / Client

- `GET /api/public/master/:slug`
- `GET /api/public/master/:slug/slots`
- `POST /api/public/master/:slug/book`
- `GET /api/public/export/booking.ics`
- `GET /api/public/master/:slug/calendar.ics`
- `GET /api/client/bookings`
- `PATCH /api/client/bookings/:id/cancel`
- `PATCH /api/client/bookings/:id/reschedule`

## 7. Уведомления

- Уведомления мастеру в Telegram при создании/обновлении записи:
  - модуль `backend/lib/telegram-notify.js`
- Напоминания клиенту в Telegram:
  - планирование: `backend/lib/reminders.js`
  - воркер: `backend/lib/reminders-worker.js`
  - запуск poll в `backend/server.js` (интервал `REMINDER_POLL_MS`, default 60000).

## 8. Команды разработки

```bash
npm install
npm run lint
npm test -- --no-coverage
npx cypress run
node backend/server.js
```

## 9. CI/CD pipeline

Порядок в CI:

1. `01 - Lint`
2. Параллельно после lint:
   - `02 - Backend Tests`
   - `03 - Frontend E2E (*)` (matrix)
   - `04 - E2E Coverage`
3. `05 - CI Summary`

Deploy:

- `deploy.yml` запускается автоматически после успешного CI в ветке `main`.
- На сервере выполняется `git pull origin main`, rebuild и `docker compose up -d`.

## 10. Обязательные env (prod)

- `NODE_ENV=production`
- `DATABASE_URL=...`
- `JWT_SECRET=...`
- `TELEGRAM_BOT_TOKEN=...`
- `ALLOW_PASSWORD_AUTH=false`
- `MASTER_TIMEZONE=Asia/Novosibirsk`
- `MASTER_TELEGRAM_USER_ID` (рекомендуется явно задать)
- `APP_DOMAIN`, `LETSENCRYPT_EMAIL`

## 11. Частые проблемы и диагностика

- Неверные слоты/сдвиг времени:
  - проверить `MASTER_TIMEZONE`, `master_settings`, свежесть статики Telegram WebView.
- В проде “не изменилось”:
  - проверить run `Deploy` в GitHub Actions,
  - проверить, что сервер реально на `HEAD main`.
- Telegram-уведомления не приходят:
  - проверить `TELEGRAM_BOT_TOKEN`,
  - что users имеют формат `tg_<telegram_id>`,
  - логи `sendMessage` в backend.

## 12. Legacy note

В проекте остается legacy UI/код “family/task tracker” (`frontend/app.js` и связанные роуты).
Для коммерческого Mini App приоритетны `booking.*`, `master.*`, `public-booking`, `master` роуты.
