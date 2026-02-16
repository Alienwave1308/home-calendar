# Claude Bootstrap Context

Этот файл — короткий bootstrap для Claude Code.
Полный и актуальный контекст хранится в:

1. `docs/PROJECT_REFERENCE.md`
2. `docs/AI_COLLABORATION.md`
3. `docs/PROD_TG_RELEASE.md`

## Проект

- Название: RoVa Epil Telegram Mini App
- Роли: `master` и `client`
- Основные экраны:
  - `/book/:slug` — запись клиента
  - `/master` — панель мастера

## Ключевые правила

- Только Telegram auth (`/api/auth/telegram`) в проде.
- Таймзона бизнес-логики: `Asia/Novosibirsk`.
- Окна записи задаются мастером по датам (`availability_windows`).
- Шаг клиентских слотов: 10 минут.
- Напоминания: 2 настраиваемых значения (по умолчанию 24/2 часа).
- Скидка первого визита: настраиваемая (по умолчанию 15%).

## Процесс работы

- Работать через `dev` -> после зелёного CI переводить в `main`.
- После зелёного CI в `main` деплой происходит автоматически.
- Перед handoff использовать `docs/HANDOFF_TEMPLATE.md`.
