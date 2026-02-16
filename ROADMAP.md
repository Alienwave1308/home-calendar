# Roadmap: TG Mini App для мастера

## Актуальный трек (Pivot от семейного трекера)
Ниже новый план по требованиям TG Mini App и салонного сценария. Исторические фазы 1-14 оставлены ниже как архив.

### Фаза A1. TG-only вход и автоправа (выполнено)
- Вход только через Telegram Mini App (`initData`), web-вход отключён.
- Роль определяется автоматически по `telegram_user_id`.
- Первый Telegram вход при пустой конфигурации закрепляет мастер-аккаунт.
- Поддержаны env:
  - `MASTER_TELEGRAM_USER_ID`
  - `MASTER_DISPLAY_NAME`
  - `MASTER_TIMEZONE`

### Фаза A2. Публичная запись клиента (выполнено)
- Публичные endpoint’ы:
  - `GET /api/public/master/:slug`
  - `GET /api/public/master/:slug/slots`
  - `POST /api/public/master/:slug/book`
- Клиент пишет комментарий к записи.
- Добавлены клиентские endpoint’ы просмотра собственных записей.

### Фаза A3. Мастерская CRM-клиентов (выполнено)
- Раздел «Клиенты» вместо «Семья».
- Список клиентов из фактических записей (`/api/master/clients`).
- История по клиенту (`/api/master/clients/:client_id/bookings`).
- Удаление UI-хвостов семейной концепции.

### Фаза A4. Редизайн Mini App (в работе)
- Полная мобильная адаптация под Telegram safe-area (верх/низ).
- Русский UI без английских названий.
- Единая зелёно-мятная система компонентов.
- Устранение горизонтальных переполнений на задачах/канбане/формах.

### Фаза A5. Клиентский booking flow + экспорт календаря (pending)
- После создания записи: действия экспорта:
  - Google Calendar (pre-filled link).
  - Apple Calendar (`.ics`).
- Событие: название, время, комментарий, часовой пояс мастера.

### Фаза A6. Мастер-календарь и статусы записей (pending)
- Полный CRUD записей мастером.
- Статусы: запланировано / отменено / выполнено.
- Поля записи: клиент, дата/время, длительность, комментарий, статус.

### Фаза A7. Финальная очистка legacy + релиз (pending)
- Удаление терминов и сценариев «семья/домашний календарь».
- Проверка iOS/Android/Desktop в Telegram.
- Финальный прогон unit + e2e.
- Перед первым прод-релизом: очистка БД, чтобы первый вход жены стал мастер-аккаунтом.

---

## Архив: Текущее состояние (v1)
- 4 таблицы: users, tasks, families, family_members
- 2 роли: owner, member
- 3 статуса: planned, in_progress, done
- Простая модель задачи: title, date, status
- Vanilla JS, одна страница, нет роутинга
- 35 Jest + 12 Cypress тестов

---

## Фаза 1: Расширение модели задачи
**Ветка:** `feature/task-model-v2`

**Миграция БД:**
- Добавить поля: `description TEXT`, `priority VARCHAR(10) DEFAULT 'medium'`, `due_at TIMESTAMP`, `all_day BOOLEAN DEFAULT true`, `completed_at TIMESTAMP`, `deleted_at TIMESTAMP` (soft delete)
- Новые статусы: backlog, planned, in_progress, done, canceled, archived
- Миграция существующих данных (planned→planned, in_progress→in_progress, done→done)

**Backend:**
- Обновить CRUD для новых полей
- Soft delete вместо физического удаления
- Валидация приоритетов: low, medium, high, urgent

**Тесты:**
- Обновить Jest-тесты для новых полей и статусов
- Тесты на soft delete

---

## Фаза 2: Расширенные роли и права
**Ветка:** `feature/roles-v2`

**Миграция БД:**
- Расширить `family_members.role`: добавить admin, child, guest

**Backend:**
- Middleware `checkRole(roles[])` — проверка роли в семье
- Owner: всё
- Admin: управление участниками (кроме owner), задачи
- Member: свои задачи, комментарии
- Child: только назначенные задачи, комментарии
- Guest: только просмотр
- API для смены ролей: `PUT /api/families/members/:id/role`

**Тесты:**
- Jest-тесты на каждую роль

---

## Фаза 3: Система тегов
**Ветка:** `feature/tags`

**Миграция БД:**
- `tags (id, family_id, name, color, created_at)`
- `task_tags (task_id, tag_id)` — связь многие-ко-многим

**Backend:**
- CRUD для тегов: `GET/POST/PUT/DELETE /api/tags`
- Привязка тегов к задачам: `POST/DELETE /api/tasks/:id/tags`
- Фильтрация задач по тегам: `GET /api/tasks?tag=tagId`

**Тесты:**
- Jest-тесты для тегов CRUD и фильтрации

---

## Фаза 4: Назначение исполнителей
**Ветка:** `feature/assignees`

**Миграция БД:**
- `task_assignments (id, task_id, user_id, role DEFAULT 'assignee', assigned_at)`
- role: assignee | watcher

**Backend:**
- `POST /api/tasks/:id/assign` — назначить исполнителя
- `DELETE /api/tasks/:id/assign/:userId` — снять
- `GET /api/tasks?assignee=userId` — фильтр по исполнителю
- Задачи возвращают массив `assignees[]`

**Тесты:**
- Jest-тесты назначений

---

## Фаза 5: Чек-листы (подзадачи)
**Ветка:** `feature/checklists`

**Миграция БД:**
- `checklist_items (id, task_id, title, is_done BOOLEAN DEFAULT false, position INTEGER, created_at)`

**Backend:**
- CRUD: `GET/POST/PUT/DELETE /api/tasks/:id/checklist`
- Прогресс: `completed / total` в ответе задачи
- Переупорядочивание: `PUT /api/tasks/:id/checklist/reorder`

**Тесты:**
- Jest-тесты для чек-листов

---

## Фаза 6: Комментарии
**Ветка:** `feature/comments`

**Миграция БД:**
- `comments (id, task_id, user_id, text, created_at, updated_at)`

**Backend:**
- `GET /api/tasks/:id/comments` — список (с пагинацией)
- `POST /api/tasks/:id/comments` — добавить
- `PUT /api/comments/:id` — редактировать свой
- `DELETE /api/comments/:id` — удалить свой (или owner/admin)

**Тесты:**
- Jest-тесты для комментариев

---

## Фаза 7: Списки / Проекты
**Ветка:** `feature/task-lists`

**Миграция БД:**
- `task_lists (id, family_id, name, description, color, created_by, created_at)`
- Добавить `list_id` в tasks (nullable FK)

**Backend:**
- CRUD для списков: `GET/POST/PUT/DELETE /api/lists`
- Фильтрация задач по списку: `GET /api/tasks?list=listId`
- Перемещение задачи в список: `PUT /api/tasks/:id` с `list_id`

**Тесты:**
- Jest-тесты для списков

---

## Фаза 8: Журнал событий (Audit Log)
**Ветка:** `feature/audit-log`

**Миграция БД:**
- `audit_events (id, family_id, user_id, action, entity_type, entity_id, details JSONB, created_at)`

**Backend:**
- Автоматическая запись при: создание/изменение/удаление задач, смена статуса, назначение, комментарии
- `GET /api/audit?limit=50&offset=0` — лента (с пагинацией)
- `GET /api/tasks/:id/history` — история конкретной задачи

**Тесты:**
- Jest-тесты для аудита

---

## Фаза 9: SPA-роутер и навигация
**Ветка:** `feature/spa-router`

**Frontend:**
- Простой hash-роутер (`#/dashboard`, `#/calendar`, `#/tasks`, `#/kanban`, etc.)
- Нижняя навигация (mobile) / боковое меню (desktop)
- Экраны-заглушки для всех разделов
- Переход auth → app сохраняет маршрут

**CSS:**
- Навигация: иконки + подписи
- Активный пункт подсвечен
- Мобильная адаптация навигации

**Тесты:**
- Cypress: навигация между экранами

---

## Фаза 10: Главный экран (Сводка / Dashboard)
**Ветка:** `feature/dashboard`

**Backend:**
- `GET /api/dashboard` — агрегированные данные:
  - задачи на сегодня
  - просроченные
  - ближайшие события (3 дня)
  - статистика (сколько done за неделю)

**Frontend:**
- Карточки: "Сегодня", "Просроченные", "Ближайшие"
- Быстрое создание задачи (поле + кнопка)
- Клик по задаче → переход к задаче

**Тесты:**
- Jest: endpoint dashboard
- Cypress: отображение сводки

---

## Фаза 11: Улучшенный календарь (неделя + день)
**Ветка:** `feature/calendar-views`

**Frontend:**
- Переключатель: Месяц / Неделя / День
- Вид "Неделя": 7 колонок с задачами
- Вид "День": полный список задач дня с деталями
- Сохранение выбранного вида в localStorage

**CSS:**
- Стили для недельного и дневного видов
- Адаптация для мобильных

**Тесты:**
- Cypress: переключение видов, навигация

---

## Фаза 12: Экран списка задач
**Ветка:** `feature/task-list-view`

**Backend:**
- `GET /api/tasks` расширить: `?sort=due_at&order=asc&status=planned&assignee=1&tag=2&list=3&page=1&limit=20`
- Пагинация: `{ tasks: [...], total: 150, page: 1, pages: 8 }`

**Frontend:**
- Таблица/список задач с фильтрами
- Панель фильтров: статус, исполнитель, тег, список, период
- Сортировка по колонкам
- Массовые действия: выделить → сменить статус / удалить
- Быстрое редактирование inline (клик по полю)

**Тесты:**
- Jest: пагинация и фильтры
- Cypress: фильтрация и сортировка

---

## Фаза 13: Канбан-доска
**Ветка:** `feature/kanban`

**Frontend:**
- Колонки по статусам: Backlog → Planned → In Progress → Done
- Drag-and-drop между колонками (vanilla JS или библиотека)
- Создание задачи внутри колонки
- Карточки с: название, приоритет, исполнитель, теги

**CSS:**
- Горизонтальный скролл колонок на мобильном
- Карточки с тенями и цветовой кодировкой

**Тесты:**
- Cypress: перетаскивание, создание в колонке

---

## Фаза 14: Карточка задачи (детальный экран)
**Ветка:** `feature/task-detail`

**Frontend:**
- Полноэкранный/модальный вид задачи
- Секции: описание, исполнители, сроки, чек-лист, комментарии, теги, история
- Редактирование inline
- Markdown для описания (простой)
- Добавление/удаление тегов
- Управление чек-листом
- Лента комментариев

**Тесты:**
- Cypress: редактирование задачи, чек-лист, комментарии

---

## Фаза 15: Повторяющиеся задачи
**Ветка:** `feature/recurrence`

**Миграция БД:**
- `recurrence_rules (id, task_id, frequency, interval, days_of_week, end_date, created_at)`
- Добавить `recurrence_id` в tasks (nullable, ссылка на "родительскую" задачу)

**Backend:**
- При создании задачи с recurrence — сохранить правило
- Cron-задача или lazy generation: создавать экземпляры при запросе
- Пропуск/перенос одного повторения
- Разрыв серии

**Тесты:**
- Jest: генерация повторений, исключения

---

## Фаза 16: Список покупок
**Ветка:** `feature/shopping-list`

**Миграция БД:**
- `shopping_items (id, family_id, title, is_bought BOOLEAN, added_by, bought_by, created_at, bought_at)`

**Backend:**
- CRUD: `GET/POST/PUT/DELETE /api/shopping`
- Отметка купленного: `PUT /api/shopping/:id/toggle`
- Преобразование в задачу: `POST /api/shopping/:id/to-task`

**Frontend:**
- Экран покупок: быстрое добавление, чекбоксы
- История (кто когда добавил/купил)

**Тесты:**
- Jest + Cypress

---

## Фаза 17: Уведомления (in-app)
**Ветка:** `feature/notifications`

**Миграция БД:**
- `notifications (id, user_id, type, title, message, entity_type, entity_id, is_read BOOLEAN, created_at)`
- `notification_settings (user_id, type, enabled BOOLEAN)`

**Backend:**
- Генерация уведомлений при событиях (назначение, комментарий, срок, и т.д.)
- `GET /api/notifications?unread=true`
- `PUT /api/notifications/:id/read`
- `PUT /api/notifications/read-all`
- `GET /api/notifications/settings`
- `PUT /api/notifications/settings`

**Frontend:**
- Колокольчик в навигации с счётчиком
- Экран уведомлений: лента, клик → переход к сущности
- Настройки уведомлений

**Тесты:**
- Jest + Cypress

---

## Фаза 18: Профиль пользователя
**Ветка:** `feature/user-profile`

**Миграция БД:**
- Расширить users: `display_name`, `avatar_url`, `timezone`, `quiet_hours_start`, `quiet_hours_end`

**Backend:**
- `GET /api/users/me` — профиль
- `PUT /api/users/me` — обновить
- Загрузка аватара (файл → диск/S3)

**Frontend:**
- Экран профиля: аватар, имя, часовой пояс
- Настройки уведомлений (тихие часы)

**Тесты:**
- Jest + Cypress

---

## Фаза 19: Управление семьёй + Настройки
**Ветка:** `feature/family-settings`

**Frontend:**
- Экран управления семьёй:
  - Список участников с ролями
  - Приглашение новых
  - Смена ролей (owner/admin)
  - Удаление участников
  - Передача владения
- Экран настроек семьи:
  - Управление тегами
  - Управление списками
  - Настройки приватности

**Тесты:**
- Cypress: управление участниками и настройками

---

## Фаза 20: Лента активности семьи
**Ветка:** `feature/activity-feed`

**Frontend:**
- Экран "Активность": лента событий из audit_events
- Фильтры: по участнику, по типу действия, по периоду
- Аватары и имена участников
- Ссылки на задачи

**Тесты:**
- Cypress: отображение и фильтрация

---

## Фаза 21: Восстановление пароля + приглашения
**Ветка:** `feature/password-reset`

**Миграция БД:**
- `password_reset_tokens (id, user_id, token, expires_at, used BOOLEAN)`

**Backend:**
- `POST /api/auth/forgot-password` — генерация токена
- `POST /api/auth/reset-password` — сброс по токену
- Приглашение по ссылке (invite_code в URL)

**Frontend:**
- Форма "Забыли пароль?"
- Форма сброса пароля
- Автоматическое принятие приглашения при регистрации

**Тесты:**
- Jest + Cypress

---

## Фаза 22: Вложения (файлы)
**Ветка:** `feature/attachments`

**Миграция БД:**
- `attachments (id, task_id, user_id, filename, filepath, mimetype, size, created_at)`

**Backend:**
- `POST /api/tasks/:id/attachments` — загрузка файла (multer)
- `GET /api/attachments/:id` — скачивание
- `DELETE /api/attachments/:id` — удаление
- Лимит: 5MB на файл, 10 файлов на задачу

**Frontend:**
- Drag-and-drop зона в карточке задачи
- Превью изображений
- Список файлов с иконками

**Тесты:**
- Jest: загрузка/скачивание/удаление

---

## Фаза 23: Rate Limiting + Безопасность
**Ветка:** `feature/security`

**Backend:**
- Rate limiter (express-rate-limit): 100 req/min на IP
- Stricter rate limit на auth: 10 req/min
- Helmet.js для HTTP заголовков
- CORS настройка
- Input sanitization (XSS protection)
- SQL injection — уже ок (параметризованные запросы)

**Тесты:**
- Jest: rate limiting работает

---

## Фаза 24: Финальная полировка
**Ветка:** `feature/polish`

- Пустые состояния с подсказками на каждом экране
- Анимации переходов между экранами
- Loading-скелетоны
- Обработка ошибок сети
- Offline-заглушка
- Performance: ленивая загрузка экранов
- Мета-теги для PWA
- Favicon и иконки
- Обновление CLAUDE.md и README

---

## Порядок фаз (зависимости)

```
Фаза 1 (задачи v2) ──→ Фаза 2 (роли) ──→ Фаза 3 (теги) ──→ Фаза 7 (списки)
                    ──→ Фаза 4 (исполнители)
                    ──→ Фаза 5 (чек-листы)
                    ──→ Фаза 6 (комментарии)
                    ──→ Фаза 8 (аудит) ──→ Фаза 20 (лента)

Фаза 9 (SPA-роутер) ──→ Фаза 10 (dashboard)
                     ──→ Фаза 11 (календарь)
                     ──→ Фаза 12 (список задач)
                     ──→ Фаза 13 (канбан)
                     ──→ Фаза 14 (карточка задачи)
                     ──→ Фаза 16 (покупки)
                     ──→ Фаза 17 (уведомления)
                     ──→ Фаза 18 (профиль)
                     ──→ Фаза 19 (настройки семьи)

Фаза 15 (повторения) зависит от Фаза 1

Фаза 21 (пароль) — независимая
Фаза 22 (вложения) зависит от Фаза 14
Фаза 23 (безопасность) — независимая
Фаза 24 (полировка) — последняя
```

## Workflow для каждой фазы

1. `git checkout dev && git pull`
2. `git checkout -b feature/xxx`
3. Написать миграцию (если есть)
4. Написать backend API + Jest-тесты
5. Написать frontend + Cypress-тесты
6. `npm run lint && npm test && npm run cypress:run`
7. `git push -u origin feature/xxx`
8. `gh pr create --base dev`
9. CI проходит → merge в dev
10. Периодически: PR из dev → main → deploy
