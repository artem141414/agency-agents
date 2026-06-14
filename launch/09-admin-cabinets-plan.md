# NEXUS — Админ-кабинеты (супер-админ + админы, RBAC)

> Синтез Product Manager (состав+роли) и Backend Architect (RBAC+реализация), сверено с `nexus-auth-server/server.py` и `marketing-office/app.py`. Дата: 2026-06-14.
> Часть общего роадмапа — `08-platform-evolution-plan.md` §15. Управляет всеми подсистемами планов 06/07/08.

---

## 0. Два главных вывода (читать первыми)

### Вывод 1 — админка живёт на auth-сервере, не в клиенте
NEXUS — гибрид: desktop-клиент (`app.py`, данные юзера локально, к нам не уходят) + единственный online-компонент (`server.py` — подписки). Админ управляет **платформой** (юзеры, подписки, тарифы, GPU, провайдеры, отделы-как-продукт), а это физически только в `nexus_auth.db`. Клиент стоит на машине юзера — давать ему власть над всеми юзерами нельзя. → **Админка = Blueprint `admin_bp` на auth-сервере**, изолированный от публичного auth-контура.

### Вывод 2 — честная граница видимости (главный design-constraint)
Админ видит **только то, что в нашем контуре или прислано клиентом**. Приватные диалоги/ключи/проекты юзера на его машине (`~/.nexus/`) админу **недоступны — никогда** (это и есть privacy-обещание продукта).

| Подсистема | Видит ли админка |
|---|---|
| Юзеры, подписки, тарифы, выручка | ✅ Полностью (БД сервера) |
| Token-metering / расход (`usage_events`, сервер) | ✅ Источник аналитики и квот |
| GPU-инфра, vLLM throughput, GPU-часы | ✅ Наша инфра (vLLM `/metrics`) |
| LLM-провайдеры платформы, ключи, relay | ✅ Наш конфиг/vault |
| Skill-маркетплейс (каталог) | ✅ Каталог; сами скиллы на машине юзера — нет |
| Диалоги/API-ключ/локальные проекты юзера | ❌ **Никогда** (privacy by design) |
| Контент-модерация | ⚠️ Только трафик через наш inference/relay (`self`/`anthropic_ours`); по `user_key` — не видим |

Контент-модерация и skill-телеметрия возможны **только** через opt-in репорт-канал клиент→сервер (§6). Это архитектурный предел self-hosted-модели, не недоработка — и его нельзя ломать.

---

## 1. Ролевая модель (RBAC)

**Принцип:** роли + права (permissions), не два хардкод-флага. Схема БД сразу под N ролей; в проде MVP — 2 роли, остальные включаются по росту команды.

| Роль | Кто | Суть |
|---|---|---|
| `superadmin` | Владелец (ты) | Всё. **Единственный** трогает GPU, провайдеров, relay, безопасность, других админов, цены тарифов, legal-отделы (OSINT/Кибербез). Не банится, не удаляется. Флаг `is_superadmin` = байпас проверки прав. |
| `admin` | Доверенный оператор | Операционка: юзеры, подписки, ручная Pro, базовая аналитика, модерация. **Без** критичных настроек. |
| `billing` *(Ф2)* | Биллинг | Подписки, рефанды, выручка, продления. |
| `moderator` *(Ф2)* | Модератор | Жалобы, бан за контент, отзыв скиллов. |
| `support` *(Ф2)* | Саппорт L1 | Чтение карточки, продление trial ≤14д, сброс пароля. |
| `analyst` *(Ф3)* | Аналитик | Только чтение дашбордов (`*.view`). |

**Матрица «роль × право»** (легенда: ✅ полный · 👁 чтение · ⚠️ ограниченно · ❌ нет):

| Право / Роль | superadmin | admin | billing | moderator | support | analyst |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Юзеры: просмотр | ✅ | ✅ | 👁 | 👁 | 👁 | 👁 |
| Юзеры: бан | ✅ | ✅ | ❌ | ⚠️ контент | ❌ | ❌ |
| Юзеры: сброс пароля | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Юзеры: удаление (152-ФЗ) | ✅ | ⚠️ подтв. | ❌ | ❌ | ❌ | ❌ |
| Биллинг: ручная Pro/Team | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Биллинг: продление | ✅ | ✅ | ✅ | ❌ | ⚠️ trial | ❌ |
| Биллинг: рефанд | ✅ | ⚠️ лимит | ✅ | ❌ | ❌ | ❌ |
| Биллинг: цены тарифов | ✅ | ❌ | ⚠️ предлож. | ❌ | ❌ | ❌ |
| Провайдеры/ключи платформы | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| GPU: дашборд | ✅ | 👁 | ❌ | ❌ | ❌ | 👁 |
| GPU: скейл/настройки | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Агенты/отделы: gating | ✅ | ⚠️ предлож. | ❌ | ❌ | ❌ | ❌ |
| OSINT/Кибербез (legal) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Skill: trust/подпись | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Skill: kill-switch | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Модерация | ✅ | ✅ | ❌ | ✅ | 👁 | ❌ |
| Аналитика | ✅ | 👁 | 👁 деньги | ❌ | ❌ | ✅ |
| Админы: создать/права | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Аудит-лог | ✅ | 👁 свои | ❌ | ❌ | ❌ | 👁 |
| Система: фича-флаги/relay | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Инвариант супер-админа** (зашит в код): только `superadmin` управляет админами, GPU/провайдерами/relay/безопасностью, ценами тарифов, legal-отделами. Попытка `admin` → `403` + запись в аудит (`result='denied'`).

---

## 2. Состав кабинета СУПЕР-АДМИНА

Контур `admin.nexus-agency.ru` (или `/admin/api` на сервере) — отдельный вход, отдельный JWT `scope:"admin"`.

- **2.0 Дашборд** — светофор за 10 сек: MRR · активных подписок · DAU/MAU · GPU util · break-even-статус (платящих vs порог 16–37) · открытые жалобы · алерты (GPU-простой, relay down, провайдер down).
- **2.1 Пользователи и подписки** — таблица+поиск+фильтры; карточка (email, created_at, last_login, план, статус, expires, license, расход прогонов/токенов); действия: **ручная Pro/Team**, продление, смена тарифа, бан, сброс пароля, удаление (152-ФЗ).
- **2.2 Тарифы и биллинг** — редактор планов (цена, лимит прогонов Free 3/Pro 40/Team 200, throttle 80%); MRR/ARPU; лог webhook ЮKassa, рефанды; break-even-виджет.
- **2.3 LLM-провайдеры** *(superadmin-only)* — режимы `self`/Anthropic/GigaChat/YaGPT/OpenRouter; дефолты по тарифам; ключи платформы (token-vault); health провайдеров/relay.
- **2.4 GPU-инфра** — throughput vLLM/SGLang, batch-utilization; **виджет GPU-простоя** (% холостого = потери ₽); GPU-часы, себестоимость прогона факт vs план; алерты util<X / >90%.
- **2.5 Агенты и отделы** — вкл/выкл, gating Free/Pro (`FREE_DEPARTMENTS`); правка агентов (плоский frontmatter); OSINT/Кибербез отдельной секцией (только superadmin, статус authorization-gate); популярность из usage_events.
- **2.6 Skill Engine** — маркетплейс-модерация, trust-уровни (official ed25519/community/untrusted), kill-switch (глобальный отзыв опасного скилла).
- **2.7 Контент-модерация** — очередь жалоб **только по трафику через наш inference/relay**; дисклеймер «по user_key-трафику контент не виден».
- **2.8 Аналитика** — DAU/MAU, конверсия Free→Pro, churn, расход токенов (usage_events), топ агентов, retention-когорты.
- **2.9 Управление админами** *(superadmin-only)* — создание/отзыв/роли; **аудит-лог** (append-only).
- **2.10 Системные настройки** *(superadmin-only)* — фича-флаги, maintenance, relay NL/PL, рассылки по сегментам, глобальный «отключить все скрипты скиллов».

## 3. Кабинет обычного АДМИНА (урезанный)
Тот же вход, JWT `role:"admin"`. UI скрывает разделы без прав, **бэкенд их `403`-ит** (security не на фронте). Видит: Пользователи+подписки (полностью), Биллинг (рефанд≤лимита, без цен тарифов), Агенты (предлагает→ревью), Модерация, Аналитика (чтение), Skill kill-switch. **Не видит вообще:** провайдеры/ключи, GPU-управление (только RO-дашборд), управление админами, системные настройки, legal-отделы.

## 4. Разграничение от юзерского профиля (фича 07)
| | Юзерский профиль | Админка |
|---|---|---|
| Где | desktop `app.py`, модалка по аватару | `admin.nexus-agency.ru` |
| JWT | юзерский (`JWT_SECRET`, TTL 48ч) | админский (`ADMIN_JWT_SECRET`, TTL 30мин, 2FA, jti) |
| Видит | только себя | всех юзеров, но не их локальные данные |
**Жёсткое правило:** разные `scope`/секреты JWT — юзерский токен физически невалиден на `/admin/api/*`. Признак админа — таблица `admins`, не поле в `users`.

---

## 5. Техническая реализация

### 5.1. Форма — Blueprint в server.py
```python
from admin import admin_bp
app.register_blueprint(admin_bp, url_prefix="/admin/api")
```
Переиспользует `get_db()` (`server.py:54`), `utcnow/iso/parse_iso` (`:74-84`), werkzeug-хэш (`:18`). Вынос в микросервис — при >10k юзеров; `admin.py` к нему готов.

### 5.2. Изоляция (5 уровней)
1. Отдельный домен `admin.*` через nginx + IP-allowlist на `/admin/*`.
2. **Отдельный `ADMIN_JWT_SECRET`** ≠ `JWT_SECRET` (`:25`) — юзерский токен невалиден.
3. TTL 30мин (vs 48ч), скользящее продление.
4. Отдельный вход `/admin/api/auth/login` с обязательным TOTP.
5. Раздельный rate-limit.

### 5.3. RBAC-схема (DDL в `ADMIN_SCHEMA`, init в `:68-71`)
Таблицы: `roles`, `permissions` (`<domain>.<action>`), `role_permissions`, `admins` (`user_id→users(id)` UNIQUE, `role_id`, `is_superadmin`, `totp_secret` шифр., `status`, `created_by`, `failed_logins`, `locked_until`), `admin_audit_log` (append-only: admin_id, action, target_type/id, before_json, after_json, ip, result, ts), `admin_sessions` (jti, expires_at, revoked — мгновенный отзыв). Сидинг системных ролей+прав идемпотентно (INSERT OR IGNORE).
**Почему `admins→users`, не флаг в `users`:** админ — другой контур безопасности (2FA/lockout/аудит); переиспользуем email+password_hash (`:42`), но admin-специфику изолируем.

### 5.4. Безопасность админов
- **Двухфазный вход:** `/login` (email+pass → `need_totp:true, challenge`) → `/totp` (challenge+code → admin-JWT + admin_sessions). pyotp, valid_window=1.
- **2FA TOTP обязательна для superadmin** (без `totp_enabled` логин невозможен); секрет шифруется (Fernet, ключ в env/keyring). Бэкап-коды опц.
- **make_admin_jwt** (образец `make_jwt` `:97`, но `ADMIN_JWT_SECRET`, TTL 30мин, `jti`); валидация сверяет jti с admin_sessions (revoked=0) → мгновенный logout-all/отзыв (как `/validate :196-201`).
- **Lockout:** failed_logins≥5 → locked_until +15мин. **Rate-limit** flask-limiter 5/15мин на auth. **IP-allowlist** (CIDR, before_request + nginx). TLS-only+HSTS.
- **Bootstrap первого superadmin — CLI, не UI:** `python admin.py bootstrap-superadmin --email …` (getpass, TOTP-QR один раз, created_by=NULL, одноразово если нет ни одного superadmin + env `ALLOW_BOOTSTRAP`).

### 5.5. Декораторы (образец `require_auth` app.py:149-160)
`require_admin` (валидный admin-JWT + jti-сессия) → `require_permission("billing.refund")` (superadmin байпас; иначе SQL по role_permissions; отказ → аудит `denied` + 403) → `audit("billing.refund", target_type="user")` (пишет before/after в admin_audit_log ВСЕГДА).

### 5.6. API (префикс `/admin/api`, каждый под `@require_permission`+`@audit`)
auth (login/totp/logout/refresh) · users (GET список/карточка, PATCH, suspend, delete) · billing (subscriptions, extend/refund/cancel — логика как webhook `:210-238`, events) · providers (view/edit) · gpu (health/throughput проксирует vLLM `/metrics`, restart) · agents/departments (gating) · skills (reports, revoke) · moderation (queue, action) · analytics (overview, usage из usage_events) · admins (CRUD, sessions, revoke-all — superadmin) · audit · settings.

---

## 6. Откуда данные (и честный предел)
**Доступно напрямую (наш контур):** users/subscriptions/billing (БД), usage/analytics (`usage_events`, клиент флашит идемпотентно через `request_id UNIQUE`), GPU-health (vLLM Prometheus `/metrics`), providers_config.
**НЕ доступно напрямую — только через opt-in телеметрию:** скиллы/контент/посты живут на машинах юзеров. Новые серверные приёмники: `skill_reports`, `moderation_queue`, `client_telemetry` + клиентский `POST /api/telemetry/report` (под юзерским `@require_auth`). Ограничения: (1) модерация приватных проектов без согласия невозможна — только пошаренное или по жалобе; (2) skill-blocklist — превентивный сигнал клиенту, не контроль постфактум; (3) телеметрия opt-in по 152-ФЗ, «нет данных» вместо «0».

---

## 7. План реализации (привязка к server.py)

| Этап | Работа | Оценка |
|---|---|---|
| 1. Каркас (admin.py Blueprint, env, register) | `:25-29,:31` | 0.5 дн |
| 2. RBAC-схема (DDL+сидинг+миграция) | `:38,:68-71` | 1 дн |
| 3. Bootstrap CLI (superadmin+TOTP) | `:18,:74` | 0.5 дн |
| 4. Auth-флоу (login+TOTP, make_admin_jwt, sessions, lockout) | образец `:97-107,:157-181` | 2 дн |
| 5. Декораторы (require_admin/permission/audit) | образец app.py`:149-160` | 1 дн |
| 6. Rate-limit + IP-allowlist + nginx | новый | 0.5 дн |
| 7. Users + Billing API (CRUD, ручная Pro, extend/refund) | `users :39-49`, webhook `:210-238` | 2 дн |
| 8. Analytics + GPU (vLLM /metrics, usage_events) | usage_events | 1.5 дн |
| 9. Admins-management (CRUD, revoke-all) | admins/sessions | 1 дн |
| 10. Телеметрия-приёмники + `/api/telemetry/report` | новый | 1.5 дн |
| 11. Providers/Agents/Settings | новый | 1 дн |
| 12. Audit-viewer + Reality Check (вход с TOTP, отказ-в-логе, revoke, traversal) | audit_log | 1.5 дн |
| **Ядро (1-9,12)** | | **~11 дн** |
| **Полностью (+10-11)** | | **~13.5 дн** |
Фронт админки (отдельный SPA) — отдельная оценка Frontend-агента, не входит. Перед прод — обязательный Reality Checker.

---

## 8. MVP-приоритизация (синхронно с фазами платформы)
- **MVP (~5–7 дн):** контур+RBAC+двухфазный auth+аудит, Пользователи+подписки+**ручная активация Pro** (единственный способ выдать доступ, пока ЮKassa — заглушка), аналитика-lite (счётчики из `users`), дашборд, 2 роли. + поле `users.is_banned`.
- **Фаза 2:** биллинг полный (после ЮKassa), аналитика на `usage_events` (после Ф0 платформы), агенты/модерация, саб-роли.
- **Фаза 3:** провайдеры (§2.3), GPU (§2.4), skill-модерация (§2.6) — **строго следом** за соответствующими фазами роадмапа 08 (раньше данных физически нет — фантомный UI).

---

## 9. Открытые решения (нужен выбор)
1. **Хостинг:** `/admin/api` на сервере (быстро, MVP) vs поддомен `admin.nexus-agency.ru` (изолированнее). Рекомендация: поддомен через nginx сразу, дешевле чем переезжать.
2. **2FA:** обязательна для superadmin сразу (да).
3. **Удаление юзера:** soft-delete (`deleted_at`) вместо физического — сохраняет аудит/биллинг.
4. **Саб-роли:** схема под N ролей сразу, в проде MVP — только superadmin+admin.
5. **GPU-метрики:** прямой проксипас vLLM `/metrics` на старте, Prometheus+Grafana при росте.

---

## Файлы
- `nexus-auth-server/server.py` — register_blueprint, env, init_db.
- `nexus-auth-server/admin.py` — **создать**: Blueprint, ADMIN_SCHEMA, декораторы, RBAC, auth-флоу, API, bootstrap-CLI.
- `nexus-auth-server/templates/admin.html` (или отдельный SPA) — фронт админки, отдельно от юзерского `marketing-office/templates/index.html`.
- `marketing-office/app.py` — `/api/telemetry/report` (клиентский источник телеметрии под `@require_auth`).
