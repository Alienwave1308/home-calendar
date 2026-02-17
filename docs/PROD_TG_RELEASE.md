# Прод-релиз TG Mini App

## 1. Обязательные env на сервере

- `NODE_ENV=production`
- `TELEGRAM_BOT_TOKEN=<token>`
- `JWT_SECRET=<strong-secret>`
- `ALLOW_PASSWORD_AUTH=false`
- `MASTER_TIMEZONE=Asia/Novosibirsk`

Опционально:

- `MASTER_TELEGRAM_USER_ID=<telegram_user_id_жены>`
- `MASTER_DISPLAY_NAME=<отображаемое_имя_мастера>`

Если `MASTER_TELEGRAM_USER_ID` не задан, мастером станет первый Telegram пользователь, который войдет в Mini App.

## 2. Очистка БД перед первым прод-запуском

Запустить SQL-скрипт:

```bash
psql "$DATABASE_URL" -f scripts/sql/reset_prod_for_first_master.sql
```

Скрипт полностью очищает бизнес-данные и сбрасывает sequence.

## 3. Деплой main и smoke-check

1. Перед деплоем обязательно выполнить:
   ```bash
   npm run predeploy:check:docker
   ```
2. Обновить код до `main`.
3. Установить зависимости и перезапустить процесс приложения.
4. Проверить:
   - `GET https://<domain>/` открывается.
   - вход в Mini App работает только через Telegram.
   - первый вход жены получает роль мастера.
   - у мастера открывается `/master`, у остальных `/book/:slug`.

## 4. Проверка календарей

1. В мастер-панели проверить подключение Google Calendar.
2. Проверить ссылку Apple Calendar (`.ics`) в настройках мастера.
3. Создать тестовую запись и убедиться, что экспорт работает:
   - Google: открывается pre-filled событие.
   - Apple: скачивается/открывается `.ics`.
