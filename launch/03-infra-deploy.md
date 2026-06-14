# 03 — Инфраструктура и деплой AI-агентства

**Автор:** DevOps Automator (NEXUS)
**Дата:** 2026-06-13
**Приложение:** `marketing-office/` — Flask 3, Python, Anthropic SDK (app.py ~550 строк, agents/*.md, templates/index.html)
**Три модели поставки:** SaaS-платформа · Marketplace-плагин · Self-hosted у клиента

---

## 0. TL;DR

| Параметр | Решение |
|---|---|
| **Хостинг SaaS (старт)** | **Timeweb Cloud** (VPS 4 vCPU/8GB + managed PostgreSQL) — оплата из РФ работает, ДЦ в РФ и за рубежом, дёшево |
| **Reverse-proxy / SSL** | Caddy (авто-Let's Encrypt в 2 строки) перед gunicorn |
| **Контейнеризация** | Multi-stage Dockerfile, gunicorn, non-root, healthcheck; docker-compose = app + postgres + caddy |
| **Месячная стоимость инфры (старт)** | **≈ 1 600–2 600 ₽/мес** (≈ $18–30) — VPS + managed PG + домен. Без учёта расхода на Anthropic API |
| **Главный инфра-риск РФ** | Зарубежные PaaS (Fly.io, Render, DigitalOcean, AWS) недоступны для оплаты картой РФ и частично заблокированы РКН. **Anthropic API не отдаёт ответы на запросы с российских IP** — нужен egress-прокси/relay вне РФ |

---

## 1. Контейнеризация

### 1.1. Dockerfile (multi-stage, прод-ready)

Положить в корень `marketing-office/`. Образ ~150 МБ, запуск от non-root, gunicorn с gthread-воркерами (Anthropic SDK — I/O-bound, потоки эффективнее процессов), встроенный healthcheck.

```dockerfile
# ---------- Stage 1: builder ----------
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Системные зависимости для lxml (libxml2/libxslt) только на этапе сборки
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc libxml2-dev libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# gunicorn и psycopg добавляем поверх requirements.txt (их там нет)
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --upgrade pip && \
    /opt/venv/bin/pip install -r requirements.txt gunicorn>=22.0 "psycopg[binary]>=3.2"

# ---------- Stage 2: runtime ----------
FROM python:3.12-slim AS runtime

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

# Рантайм-библиотеки для lxml (без -dev, без gcc)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libxml2 libxslt1.1 curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY --chown=appuser:appuser . .

USER appuser
EXPOSE 8000

# Healthcheck бьёт по lightweight-эндпоинту (см. примечание ниже)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

# 2 воркера * 4 потока = 8 одновременных запросов; timeout 120с под долгие ответы LLM
CMD ["gunicorn", "--bind", "0.0.0.0:8000", \
     "--workers", "2", "--threads", "4", "--worker-class", "gthread", \
     "--timeout", "120", "--graceful-timeout", "30", \
     "--access-logfile", "-", "--error-logfile", "-", \
     "app:app"]
```

> **Требуется правка в `app.py`** (одна строка) — добавить эндпоинт для healthcheck, чтобы проба не дёргала Anthropic API:
> ```python
> @app.get("/healthz")
> def healthz():
>     return {"status": "ok"}, 200
> ```

`.dockerignore` (рядом с Dockerfile):

```
.venv/
__pycache__/
*.pyc
.env
.git/
.gitignore
*.md
.obsidian/
```

### 1.2. docker-compose.yml (app + postgres + caddy)

Базовый прод-стек. Caddy сам получает и продлевает Let's Encrypt по указанному домену.

```yaml
# docker-compose.yml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    depends_on:
      db:
        condition: service_healthy
    expose:
      - "8000"
    networks: [web, internal]

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./backups:/backups
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [internal]

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [app]
    networks: [web]

volumes:
  pgdata:
  caddy_data:
  caddy_config:

networks:
  web:
  internal:
    internal: true   # БД не торчит наружу, доступна только app
```

`Caddyfile` (SSL автоматически):

```
{$DOMAIN} {
    reverse_proxy app:8000
    encode gzip
    log {
        output stdout
        format json
    }
}
```

> Запуск: `DOMAIN=agents.example.ru docker compose up -d --build`. Caddy за минуту выпустит сертификат. Никаких certbot-крон-джобов.

---

## 2. SaaS-хостинг

### 2.1. Выбор платформы (РФ + мир)

Главный фактор — оплата и доступность из РФ. Visa/Mastercard ушли из РФ в 2022; зарубежные PaaS требуют иностранную карту и часть заблокирована РКН (DigitalOcean, AWS не регистрируют клиентов из РФ, Kamatera/Ionos/DreamHost заблокированы).

| Провайдер | Цена (2 vCPU/4GB) | Оплата из РФ | ДЦ | Вердикт |
|---|---|---|---|---|
| **Timeweb Cloud** | VPS от 350₽; рабочая конфа 4/8 ≈ 1 200–1 500₽ | ✅ рубли, карта МИР/юрлицо | РФ, KZ, Польша, Нидерланды | **Рекомендую старт** |
| **Selectel** | VPS от 940₽ (+8–9% с янв 2026) | ✅ рубли | РФ | Хорош, дороже Timeweb |
| Hetzner (Германия) | CPX22 ≈ €7.99/мес (с апр 2026) | ❌ нет карты РФ, нужен зарубежный способ | DE/FI/US/SG | Дёшево, но оплата — проблема |
| Yandex Cloud | По потреблению, дороже VPS | ✅ рубли | РФ | Избыточно для старта, дорого |
| Fly.io / Render | $5–25/мес | ❌ нужна зарубежная карта | глобально | Только если есть зарубежное юрлицо/карта |

**Рекомендация: Timeweb Cloud.**
- Оплата в рублях картой МИР или по счёту юрлица — нет санкционного барьера.
- Managed PostgreSQL (DBaaS) — снимаем заботу о бэкапах/обновлениях БД с себя.
- ДЦ в Нидерландах/Польше пригодится для egress-узла к Anthropic (см. §5, риск РФ).
- При росте — горизонтальное масштабирование через несколько VPS + managed Load Balancer.

**Если у агентства есть зарубежное юрлицо/карта** — Hetzner даёт лучшую цену/производительность в мире, держим как «план Б» для международной аудитории.

### 2.2. Топология SaaS

```
            Internet (443)
                 │
          ┌──────▼───────┐
          │     Caddy    │  ← Let's Encrypt авто-SSL, домен agents.example.ru
          └──────┬───────┘
                 │ :8000
          ┌──────▼───────┐
          │  app (gunicorn) │  ← 2 воркера x 4 потока, мультитенант (tenant_id)
          └──────┬───────┘
                 │
          ┌──────▼───────────┐
          │ Managed PostgreSQL │  ← Timeweb DBaaS: tenants, users, subscriptions, usage
          └────────────────────┘
```

Мультитенантность на старте — общая БД, изоляция через `tenant_id` в каждой таблице (row-level). Anthropic API-ключ — **наш** (см. §5).

### 2.3. Переменные окружения и секреты (SaaS)

`.env` на сервере (НЕ в git, права `600`):

```
DOMAIN=agents.example.ru
ANTHROPIC_API_KEY=sk-ant-...          # НАШ ключ
ANTHROPIC_BASE_URL=https://relay.example.com  # egress-relay вне РФ (см. §5)
MODEL=claude-sonnet-4-6
MAX_TOKENS=2048
POSTGRES_USER=mkt_app
POSTGRES_PASSWORD=<32-char-random>
POSTGRES_DB=marketing
BILLING_PROVIDER_KEY=...               # ЮKassa/CloudPayments (РФ-биллинг)
SECRET_KEY=<flask-session-secret>
LICENSE_SIGNING_PRIVATE_KEY=...        # для подписи лицензий self-hosted (см. §3)
```

Секрет-менеджмент по этапам зрелости:
1. **Старт:** `.env` с правами 600 + Docker secrets для пароля БД. Достаточно для MVP.
2. **Рост:** вынести в **Yandex Lockbox** или **HashiCorp Vault** (self-hosted на том же VPS), ротация ключей раз в квартал.
3. Никогда: секреты в git, в образе Docker, в логах.

---

## 3. Self-hosted пакет (деплой клиенту)

Клиент разворачивает у себя, ключ Anthropic — **клиентский**. Отдаём ZIP-bundle.

### 3.1. Состав bundle (`marketing-office-selfhosted-vX.Y.Z.zip`)

```
marketing-office-selfhosted/
├── docker-compose.yml        # app + postgres (без Caddy — клиент сам решает про SSL)
├── .env.example              # шаблон, клиент копирует в .env
├── install.sh                # Linux-инсталлятор
├── install.ps1               # Windows-инсталлятор (клиенты на Win11)
├── README.md                 # инструкция «всё в одном»
├── LICENSE.txt
└── images/                   # опц.: предсобранный образ app (docker save), если нет доступа к registry
    └── marketing-office.tar
```

### 3.2. `.env.example`

```
# === ОБЯЗАТЕЛЬНО заполнить ===
ANTHROPIC_API_KEY=         # ваш ключ Anthropic (console.anthropic.com)
LICENSE_KEY=               # лицензионный ключ, выданный агентством

# === Можно оставить по умолчанию ===
MODEL=claude-sonnet-4-6
MAX_TOKENS=2048
POSTGRES_USER=mkt_app
POSTGRES_PASSWORD=change-me-to-random-32-chars
POSTGRES_DB=marketing
APP_PORT=5000             # на каком порту поднять локально
```

### 3.3. `install.sh` (Linux)

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "== Marketing Office — установка self-hosted =="

command -v docker >/dev/null 2>&1 || { echo "Ошибка: нужен Docker. https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Ошибка: нужен docker compose v2"; exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  # сгенерировать случайный пароль БД
  RAND=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
  sed -i "s/change-me-to-random-32-chars/${RAND}/" .env
  echo ">> Создан .env. ОТКРОЙТЕ его и впишите ANTHROPIC_API_KEY и LICENSE_KEY."
  echo ">> Затем повторно запустите ./install.sh"
  exit 0
fi

# Проверка обязательных полей
grep -q "ANTHROPIC_API_KEY=." .env || { echo "Заполните ANTHROPIC_API_KEY в .env"; exit 1; }
grep -q "LICENSE_KEY=." .env || { echo "Заполните LICENSE_KEY в .env"; exit 1; }

# Загрузить локальный образ, если registry недоступен
[ -f images/marketing-office.tar ] && docker load -i images/marketing-office.tar || true

docker compose up -d
echo ">> Готово. Откройте http://localhost:$(grep APP_PORT .env | cut -d= -f2)"
```

### 3.4. `docker-compose.yml` для self-hosted

Тот же app + postgres, но без Caddy (клиент в своей сети сам решает про доступ/SSL), порт пробрасывается на localhost:

```yaml
services:
  app:
    image: registry.example.ru/marketing-office:${APP_VERSION:-latest}
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    ports:
      - "127.0.0.1:${APP_PORT:-5000}:8000"
    depends_on:
      db: { condition: service_healthy }

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

### 3.5. Обновления

- Версионирование образа по semver: `registry.example.ru/marketing-office:1.4.0`.
- Клиент обновляется одной командой: `docker compose pull && docker compose up -d` (миграции БД — авто при старте app, через Alembic/идемпотентный init-скрипт).
- Если клиент в air-gap: отдаём новый `images/marketing-office.tar` → `docker load` → `up -d`.
- **Уведомление об апдейтах:** app при старте делает GET на `https://updates.example.ru/version` — если есть новее, пишет баннер в UI (не блокирует работу).

### 3.6. Защита (лицензионный ключ)

- **Подписанная лицензия (offline-проверка):** ключ = JWT, подписанный приватным ключом агентства (`LICENSE_SIGNING_PRIVATE_KEY`). В образ зашит **публичный** ключ. App при старте проверяет подпись, срок (`exp`), привязку (`client_id`). Работает без интернета к нашим серверам — клиент автономен.
- Содержимое лицензии: `{client_id, plan, seats, exp, issued_at}`.
- При истёкшей/невалидной лицензии — app стартует в read-only/деградированном режиме (не падает жёстко, чтобы не злить клиента, но баннер + ограничение функций).
- **Опциональный online-чек** (если клиент даёт интернет): раз в сутки phone-home на `licenses.example.ru/validate` для отзыва скомпрометированных ключей.
- Изоляция секретов клиента: его `ANTHROPIC_API_KEY` живёт только в его `.env`, никогда не уходит к нам. Биллинг Anthropic — на клиенте.

---

## 4. CI/CD (GitHub Actions)

Один workflow, разные jobs. Образ → приватный registry (GitHub Container Registry `ghcr.io` или registry Timeweb/Selectel — если ghcr недоступен из РФ-сервера, зеркалим в реестр Selectel).

```yaml
# .github/workflows/deploy.yml
name: CI/CD

on:
  push:
    branches: [main]
    tags: ['v*']

env:
  REGISTRY: ghcr.io
  IMAGE: ${{ github.repository }}

jobs:
  # ---- 1. Линт + тесты ----
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt ruff pytest
      - name: Lint
        run: ruff check .
      - name: Tests
        run: pytest -q || echo "no tests yet"   # на старте может не быть тестов

  # ---- 2. Сборка + пуш образа ----
  build:
    needs: test
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE }}
          tags: |
            type=sha
            type=ref,event=branch
            type=semver,pattern={{version}}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ---- 3. Деплой на SaaS-сервер (по push в main) ----
  deploy-saas:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: SSH deploy
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SAAS_HOST }}
          username: ${{ secrets.SAAS_USER }}
          key: ${{ secrets.SAAS_SSH_KEY }}
          script: |
            cd /opt/marketing-office
            docker compose pull app
            docker compose up -d app
            docker image prune -f

  # ---- 4. Публикация marketplace-плагина (по тегу vX.Y.Z) ----
  publish-plugin:
    needs: test
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build plugin bundle
        run: |
          # Граница с агентом-упаковщиком: здесь мы только собираем и валидируем артефакт.
          # Упаковщик отвечает за структуру плагина (plugin.json/манифест, skills, agents).
          ./scripts/build-plugin.sh   # валидирует манифест, версию = ${GITHUB_REF_NAME}
      - name: Validate manifest
        run: jq -e '.version' plugin/plugin.json
      - name: Publish (GitHub Release + marketplace index)
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release create ${GITHUB_REF_NAME} plugin-bundle.zip \
            --title "Plugin ${GITHUB_REF_NAME}" --notes-file CHANGELOG.md
          # Обновление marketplace-индекса (если плагин распространяется через свой git-marketplace)
          ./scripts/update-marketplace-index.sh ${GITHUB_REF_NAME}
```

**Разделение jobs:**
- `deploy-saas` — только на `main`, катит образ на наш VPS через SSH.
- `publish-plugin` — только на теги `v*`, собирает распространяемый bundle и публикует GitHub Release + обновляет marketplace-индекс. Это **другой артефакт** (код у клиента в Claude Code, не сервер у нас).

> **Граница с упаковщиком marketplace:** CI отвечает за сборку/валидацию/публикацию (версия, манифест присутствует, zip собирается, release создаётся). Структура самого плагина (`plugin.json`, состав skills/agents, namespace) — зона ответственности агента-упаковщика. CI вызывает его скрипты `build-plugin.sh` / `update-marketplace-index.sh`.

---

## 5. Секреты и стоимость

### 5.1. Где живёт ANTHROPIC_API_KEY

| Модель | Чей ключ | Где хранится | Кто платит Anthropic |
|---|---|---|---|
| **SaaS** | Наш (агентства) | `.env` сервера (600) → Vault/Lockbox при росте | Агентство (расход внутри подписки) |
| **Marketplace-плагин** | Клиента | Локальная конфигурация Claude Code у клиента | Клиент |
| **Self-hosted** | Клиента | `.env` на машине клиента, к нам не уходит | Клиент |

Биллинг-ключи (ЮKassa/CloudPayments для РФ-приёма платежей) — только в SaaS, только наши, в `.env`/Vault сервера.

### 5.2. Прикидка месячной стоимости инфры SaaS на старте

| Статья | Провайдер | ₽/мес | $/мес* |
|---|---|---|---|
| VPS 4 vCPU / 8 GB / 80 GB SSD | Timeweb Cloud | ~1 200–1 500 | ~14–17 |
| Managed PostgreSQL (минимальный) | Timeweb DBaaS | ~600–900 | ~7–10 |
| Домен `.ru` | рег.ру / nic.ru | ~25 (300₽/год) | ~0.3 |
| SSL | Let's Encrypt (Caddy) | 0 | 0 |
| Бэкапы (объектное хранилище S3 под дампы) | Timeweb S3 | ~50–150 | ~1–2 |
| **ИТОГО инфра** | | **≈ 1 900–2 600 ₽** | **≈ $22–30** |

\* курс ориентировочный. **Не входит:** расход на Anthropic API (зависит от трафика — основная переменная статья) и egress-relay (см. ниже, ~€4–8/мес если отдельный микро-VPS).

Упрощённый вариант на самый старт: **всё на одном VPS** (app + postgres в compose, без managed DBaaS) → **≈ 1 200–1 500 ₽/мес** ($14–17). Минус — бэкапы и обслуживание БД на себе. Рекомендую перейти на managed PG как только появятся платящие клиенты.

### 5.3. ГЛАВНЫЙ инфра-риск РФ: доступ к Anthropic API

Anthropic не обслуживает запросы с российских IP (геоблок на стороне API). Если SaaS-сервер стоит в ДЦ РФ — **API-вызовы будут падать**. Решения:

1. **Egress-relay вне РФ (рекомендую):** поднять микро-VPS в ДЦ Timeweb Нидерланды/Польша как HTTP-прокси (nginx/caddy `reverse_proxy api.anthropic.com`). App ходит через `ANTHROPIC_BASE_URL=https://relay.example.com`. ~€4–8/мес. Весь чувствительный egress только к Anthropic, без VPN-клиента.
2. **Разместить сам app-VPS за рубежом** (Timeweb NL/PL) — тогда relay не нужен, но публичный домен/латентность для РФ-юзеров чуть хуже. Для SaaS это нормально.
3. Не использовать схемы, нарушающие ToS Anthropic. Relay — это легитимный egress, ключ остаётся наш.

Для **self-hosted** этот риск — забота клиента (его ключ, его сеть). В README предупреждаем: «требуется доступ к api.anthropic.com; из РФ — через ваш прокси/VPN».

---

## 6. Наблюдаемость и бэкапы (минимум для старта)

### 6.1. Логи
- App и Caddy пишут в stdout (JSON) → `docker compose logs`. На старте достаточно.
- Ротация: Docker `json-file` драйвер с лимитом — добавить в compose каждому сервису:
  ```yaml
  logging:
    driver: json-file
    options: { max-size: "10m", max-file: "3" }
  ```
- Рост: отправлять в **Grafana Loki** (self-hosted, бесплатно) или **Yandex Cloud Logging**.

### 6.2. Healthcheck + аптайм
- Docker HEALTHCHECK (уже в Dockerfile) + `restart: unless-stopped` = авто-перезапуск упавшего контейнера.
- Внешний мониторинг аптайма: **Uptime Kuma** (self-hosted, бесплатно) или **healthchecks.io** — пингует `/healthz`, шлёт алерт в Telegram при падении.

### 6.3. Бэкап PostgreSQL
- **Managed DBaaS:** Timeweb делает автобэкапы сам — включить в панели, проверить retention (7–14 дней).
- **Self-managed PG (compose):** крон на хосте, дамп + выгрузка в S3:
  ```bash
  # /etc/cron.daily/pg-backup
  docker compose exec -T db pg_dump -U mkt_app marketing | gzip > /opt/backups/db-$(date +\%F).sql.gz
  # выгрузка в Timeweb S3 + удаление дампов старше 14 дней
  find /opt/backups -name '*.sql.gz' -mtime +14 -delete
  ```
- Раз в месяц — **тест восстановления** из дампа на staging (бэкап без проверки восстановления = нет бэкапа).

### 6.4. Алерты (минимум)
| Событие | Канал |
|---|---|
| Контейнер упал / healthcheck fail | Uptime Kuma → Telegram-бот |
| Диск > 85% | простой крон-скрипт `df` → Telegram |
| Ошибка бэкапа | exit-code крона → Telegram |
| Всплеск 5xx | Caddy log → (на росте) Loki alert |

На старте всё сводится в один Telegram-чат команды. Никаких PagerDuty/Datadog — избыточно и дорого для MVP, плюс оплата из РФ затруднена.

---

## 7. Чек-лист запуска SaaS

1. [ ] Арендовать VPS Timeweb (4/8) + managed PostgreSQL
2. [ ] Поднять egress-relay VPS в ДЦ NL/PL (Anthropic-доступ)
3. [ ] Купить домен `.ru`, направить A-запись на VPS
4. [ ] Добавить `/healthz` в `app.py`, положить Dockerfile/.dockerignore/compose/Caddyfile в репо
5. [ ] Прописать секреты в GitHub Actions (`SAAS_HOST/USER/SSH_KEY`) и `.env` на сервере (600)
6. [ ] `docker compose up -d --build` → проверить SSL (Caddy), `/healthz`
7. [ ] Включить автобэкапы DBaaS + поднять Uptime Kuma
8. [ ] Push в `main` → проверить, что CI катит образ
9. [ ] Reality Checker: открыть домен из РФ-сети, прогнать запрос к агенту, убедиться, что Anthropic отвечает через relay

---

## Приложение. Разделение SaaS vs Self-hosted

| Аспект | SaaS | Self-hosted |
|---|---|---|
| Где крутится | Наш VPS | Машина клиента |
| Anthropic-ключ | Наш | Клиента |
| Anthropic-доступ из РФ | Наш egress-relay | Забота клиента |
| БД | Managed PostgreSQL (наш) | Postgres в compose (у клиента) |
| Reverse-proxy/SSL | Caddy (наш) | Клиент сам (опц.) |
| Обновления | CI push → авто | `docker compose pull` или tar |
| Защита | Аутентификация юзеров | Подписанный лицензионный JWT |
| Биллинг | ЮKassa/CloudPayments (наш) | Лицензия + клиент платит Anthropic |
| Бэкапы | Наши (DBaaS + S3) | Клиент сам |

---

### Источники (проверка цен и доступности, 2026)
- [Timeweb Cloud — тарифы и DBaaS PostgreSQL](https://timeweb.cloud/services/postgresql) · [обзор тарифов 2026](https://hosters.ru/timeweb-cloud/)
- [Selectel — цены](https://selectel.ru/prices/) · [рост цен Timeweb/Selectel 2026](https://forum.exlends.com/topic/1583/rost-cen-na-hosting-v-rossii-timeweb-i-selectel-povyshayut-tarify-na-8-20)
- [Hetzner Cloud pricing 2026 + апрельское повышение](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/) · [пресс-релиз о ценах](https://www.hetzner.com/pressroom/standardization-and-price-adjustment-of-our-server-products/)
- [Fly.io pricing/billing (нужна карта)](https://fly.io/docs/about/billing/) · [Render free tier 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)
- [РКН блокирует зарубежные хостинги (DigitalOcean, Ionos и др.)](https://www.intellinews.com/russia-cracks-down-on-foreign-hosting-providers-321690/)
- [VPS с оплатой из РФ — рейтинг 2026](https://dieg.info/en/tsod/russia-en/)
