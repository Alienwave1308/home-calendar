# AI Collaboration Guide (Codex + Claude Code)

Цель: единый процесс работы для обоих агентов без потери контекста.

## 1. Канон документации

При конфликте источников приоритет:

1. `docs/PROJECT_REFERENCE.md`
2. `docs/PROD_TG_RELEASE.md`
3. `README.md`
4. `ROADMAP*.md` (как история/план, не как runtime source of truth)

## 2. Ветки и релизный процесс

- Рабочая ветка: `dev`.
- Прод-ветка: `main`.
- Стандарт:
  1. changes -> `dev`
  2. green CI on `dev`
  3. merge/sync -> `main`
  4. green CI on `main`
  5. auto Deploy workflow

Запрещено:

- force-push в `main`
- пропускать CI перед релизом (кроме явно согласованного hotfix)

## 3. Обязательные проверки перед пушем/деплоем

Обязательный quality gate для любых правок перед деплоем:

```bash
npm run predeploy:check:docker
```

Деплой без успешного `predeploy:check:docker` не допускается.

## 4. Правила изменений

- Не ломать Telegram-only auth.
- Не возвращать старую “семейную” терминологию в новые экраны Mini App.
- Все user-facing тексты на русском.
- Для времени учитывать Novosibirsk rules.
- Новая бизнес-логика => unit/integration test + (по возможности) e2e.

## 5. Прод-операции

Перед критичными прод-изменениями:

- проверить `Deploy` run status
- проверить `/health`
- проверить ключевые сценарии:
  - login через Telegram
  - booking flow
  - master settings
  - reminders/notifications

Если нужен сброс бизнес-данных перед запуском:

```bash
psql "$DATABASE_URL" -f scripts/sql/reset_prod_for_first_master.sql
```

## 6. Шаблон handoff

Использовать `docs/HANDOFF_TEMPLATE.md` при передаче задачи между агентами.
