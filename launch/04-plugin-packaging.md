# 04 — Упаковка NEXUS в платный плагин Claude Code

> Статус: черновик в работе. Основано на реальном формате установленных плагинов
> (`claude-ads` v1.5.1, `context-mode` v1.0.120) в `~/.claude/plugins/marketplaces/`.

## TL;DR
- **Структура:** ОДИН marketplace-git-репо `nexus` с `plugins[]` из **6
  департаментных плагинов** (core, engineering, marketing-ru, marketing-glo,
  product, business). Не монолит (190 агентов раздувают контекст и не тиеруются)
  и не 14 репо (неудобно ставить).
- **Можно ли залочить за подписку:** жёсткого DRM **НЕТ** — плагин клонируется в
  plaintext. Реальный контроль = **приватный git-репо + отзываемый доступ по
  подписке** (Gumroad/Stripe webhook → GitHub collaborators API) + лицензионный
  ключ для аналитики + **премиум-фичи за нашим MCP-сервером** (единственный
  неотчуждаемый актив).
- **Главный риск дистрибуции:** после установки все system-промпты лежат на диске
  у пользователя — их тривиально скопировать и перепродать. Защита возможна только
  на уровне РАЗДАЧИ (кто склонирует), а не исполнения. Митигация — держать
  ключевую ценность на сервере, а не в .md.
- **Сборка:** наш frontmatter несовместим с форматом Claude Code → обязателен
  build-скрипт (`.md` → kebab-case `name` + `tools`/`model` → `dist/`), источник
  правды в одном месте, плагин-репо генерируются.

---

## 1. Реальный формат плагина Claude Code

### 1.1. Где это живёт физически (изучено на диске)

Claude Code разворачивает marketplace-плагины так:

```
~/.claude/plugins/
├── installed_plugins.json          # что установлено у пользователя
├── known_marketplaces.json         # список подключённых marketplace
└── marketplaces/
    └── <marketplace-name>/         # это git-репозиторий целиком
        ├── .claude-plugin/
        │   ├── marketplace.json    # манифест маркетплейса (каталог плагинов)
        │   └── plugin.json         # манифест ОДНОГО плагина (если репо = 1 плагин)
        ├── skills/                 # skills (slash-команды + auto-trigger)
        │   └── <skill-name>/SKILL.md
        ├── agents/                 # субагенты (.md с frontmatter)
        │   └── <agent>.md
        ├── commands/               # (опционально) явные slash-команды
        └── README.md, LICENSE, scripts/, ...
```

Ключевой факт: **marketplace = git-репозиторий**. Пользователь делает
`/plugin marketplace add <git-url>`, затем `/plugin install <name>`. Никакого
закрытого реестра — это просто `git clone` репозитория, который ты контролируешь.

### 1.2. Реальный `marketplace.json` (образец — наш `claude-ads`)

Это РЕАЛЬНЫЙ файл с диска (`AgriciDaniel-claude-ads/.claude-plugin/marketplace.json`),
взят как эталон формата:

```json
{
  "name": "agricidaniel-claude-ads",
  "owner": { "name": "AgriciDaniel" },
  "metadata": {
    "description": "Comprehensive paid advertising audit and optimization plugins for Claude Code",
    "version": "1.5.1"
  },
  "plugins": [
    {
      "name": "claude-ads",
      "source": "./",
      "description": "Comprehensive paid advertising audit... 250+ checks...",
      "version": "1.5.1",
      "author": { "name": "AgriciDaniel" },
      "homepage": "https://agricidaniel.com/blog/claude-code-ad-agency",
      "repository": "https://github.com/AgriciDaniel/claude-ads",
      "license": "MIT",
      "category": "marketing",
      "tags": ["advertising", "audit", "google-ads", "ppc", "optimization"],
      "keywords": ["advertising-audit", "paid-advertising", "claude-code-skill"]
    }
  ]
}
```

Поле `plugins[]` — массив: один marketplace может раздавать НЕСКОЛЬКО плагинов.
`source: "./"` означает «плагин лежит в корне этого же репо». Можно указать
подпапку (`"source": "./nexus-marketing"`) — тогда один репо отдаёт несколько
плагинов из подкаталогов.

### 1.3. Реальный `plugin.json` (образец)

```json
{
  "name": "claude-ads",
  "version": "1.5.1",
  "description": "...",
  "author": { "name": "AgriciDaniel", "url": "https://github.com/AgriciDaniel" },
  "homepage": "https://agricidaniel.com/blog/claude-code-ad-agency",
  "repository": "https://github.com/AgriciDaniel/claude-ads",
  "license": "MIT",
  "keywords": ["advertising-audit", "google-ads", "claude-code-skill"],
  "skills": ["./ads/", "./skills/"]
}
```

Поле `skills` — массив путей к каталогам со skills. `agents/` подхватывается
по соглашению (каталог в корне плагина).

### 1.4. Формат SKILL.md (реальный)

```yaml
---
name: ads-audit
description: "Full multi-platform paid advertising audit... Use when user says audit, full ad check, analyze my ads, account health check, or PPC audit."
user-invokable: false   # true → доступна как /skill-name; false → только auto-trigger
---
# тело — инструкция для агента
```

### 1.5. Формат agent .md (реальный — у claude-ads)

```yaml
---
name: audit-budget
description: >
  Budget and bidding specialist. Audits budget allocation, bidding
  strategies... across LinkedIn, TikTok, and Microsoft.
model: sonnet
maxTurns: 20
tools: Read, Bash, Write, Glob, Grep
---
# тело = system prompt
```

> ⚠️ **Несовместимость формата.** Наш текущий frontmatter в `agency_agents`:
> ```yaml
> name: Backend Architect      # Title Case с пробелом
> description: ...
> color: blue
> emoji: 🏗️
> vibe: ...
> ```
> Claude Code ждёт `name` в kebab-case (`backend-architect`) и игнорирует
> `color/emoji/vibe`, при этом ему нужны `tools`/`model`. **Это значит: сырые
> .md из репо НЕЛЬЗЯ просто скопировать в плагин — их обязательно прогоняет
> сборочный скрипт** (см. §6), который переписывает frontmatter. Это главная
> причина, по которой нужен build-пайплайн, а не ручной copy-paste.

## 2. Маппинг наших .md-агентов: один плагин или набор

### 2.1. Инвентарь (фактические цифры с диска)

| Департамент | Агентов (.md) |
|---|---|
| specialized | 28 |
| marketing (EN) | 29 |
| engineering | 26 |
| design | 8 |
| sales | 8 |
| testing | 8 |
| paid-media | 7 |
| project-management | 6 |
| support | 6 |
| product | 5 |
| integrations | 1 |
| **agency_agents итого** | **~159 .md** |
| marketing-office (RU) | 31 (28 стратегов + 7 scout-агентов) |
| **ОБЩИЙ ПУЛ** | **~190 агентов** |

Плюс 5 skills уже в сессии: `nexus-micro`, `nexus-sprint`, `nexus-full`,
`nexus-status`, `deep-research`.

### 2.2. Решение: НАБОР плагинов из ОДНОГО marketplace (не монолит)

**Вывод: один marketplace-репозиторий `nexus`, внутри — 6 отдельных плагинов
по департаментам.** Не один гигантский плагин на 190 агентов и не 14 разрозненных
репозиториев.

```
nexus (один git-репо, один marketplace.json со списком plugins[])
├── nexus-core          # orchestrator + 5 nexus-* skills + Reality Checker + handoff-шаблоны
├── nexus-engineering   # 26 eng + testing 8 + integrations  (~35 агентов)
├── nexus-marketing-ru  # 31 RU-агент из marketing-office + scouts
├── nexus-marketing-glo # 29 EN marketing + paid-media 7      (~36)
├── nexus-product       # product 5 + design 8 + PM 6 + UX/research (~19)
└── nexus-business      # sales 8 + support 6 + specialized 28 (~42)
```

**Почему набор, а не монолит:**
1. **Контекст-бюджет.** 190 агентов в одном плагине = 190 описаний, которые
   Claude грузит в системный промпт при автоподборе субагента. Это раздувает
   контекст и ухудшает выбор. Департаментные плагины ставятся точечно.
2. **Монетизация по тиерам.** Можно продавать `nexus-core` дёшево/бесплатно как
   «воронку», а `nexus-engineering`/`nexus-marketing` — в платных тиерах. Один
   монолит так не сегментируешь.
3. **Релизы независимы.** RU-маркетинг (волатильный — платформы меняются)
   версионируется отдельно от engineering.
4. **UX выбора субагента.** Claude точнее выбирает агента, когда в установленном
   наборе 35 релевантных, а не 190 на все темы.

**Почему НЕ 14 отдельных репозиториев:** пользователю пришлось бы добавлять
14 marketplace-URL. Один `marketplace.json` с `plugins[]` из 6 элементов
(каждый со своим `source: "./nexus-engineering"` и т.д.) решает это — добавил
ОДИН marketplace, ставишь нужные плагины по одному.

`nexus-core` — обязательная зависимость: orchestrator-доктрина и nexus-* skills,
которые координируют субагентов из остальных плагинов.

## 3. Slash-команды и skills

### 3.1. Что экспонируем (в `nexus-core`)

Skills уже существуют как файлы в этой сессии — упаковываем их в
`nexus-core/skills/`:

| Skill | user-invokable | Триггер | Назначение |
|---|---|---|---|
| `nexus-micro` | true | `/nexus:nexus-micro [задача]` | 5–10 агентов параллельно, 1–5 дней |
| `nexus-sprint` | true | `/nexus:nexus-sprint [фича]` | 15–25 агентов, Dev↔QA loops, 2–6 нед |
| `nexus-full` | true | `/nexus:nexus-full [проект]` | все 7 фаз, 12–24 нед |
| `nexus-status` | true | `/nexus:nexus-status` | проверка активности NEXUS |

> Namespacing: после установки плагина команды видны как `/<plugin>:<skill>`
> (как в сессии: `claude-ads:ads-audit`, `context-mode:ctx-doctor`). Значит наши
> станут `/nexus-core:nexus-micro`. В описании skill стоит указывать и короткий
> алиас в тексте, чтобы Claude триггерил по фразам «запусти микро-режим».

### 3.2. UX внутри Claude Code

1. **Установка:**
   ```
   /plugin marketplace add https://github.com/<org>/nexus
   /plugin install nexus-core
   /plugin install nexus-engineering
   ```
2. **Явный запуск:** `/nexus-core:nexus-sprint добавить OAuth-логин`
   → skill читает доктрину, через `Task` параллельно поднимает субагентов
   из установленных департаментных плагинов.
3. **Авто-триггер:** subagent-агенты (`user-invokable: false` или просто agents/)
   подхватываются Claude автоматически по `description` — пользователь пишет
   «спроектируй backend», Claude сам зовёт `nexus-engineering`'s backend-architect.
4. **Открываемость:** `/plugin` показывает установленные, `/help` — команды.

### 3.3. Skills vs agents — что чем делаем

- **Skills** = оркестраторы/режимы (`nexus-micro/sprint/full`) — они
  user-invokable и сами раздают работу.
- **Agents** (наши 190 .md) = исполнители-субагенты. НЕ делаем их slash-командами
  (190 команд замусорят `/`). Они вызываются оркестратором или авто-триггером.
- Узкие повторяемые сценарии (типа `/nexus:audit-funnel`) можно позже вынести
  в отдельные user-invokable skills точечно.

## 4. Монетизация: можно ли залочить за подписку

### 4.1. Честный ответ: ТЕХНИЧЕСКИ ЖЁСТКОГО DRM НЕТ

**Можно ли криптографически залочить контент плагина за подпиской прямо внутри
механизма плагинов Claude Code? — НЕТ.** Причины (фундаментальные, не обойти):

1. Плагин = git-репозиторий, который клонируется пользователю целиком в plaintext.
   Все .md (наши system-промпты — главный актив) лежат на диске у пользователя
   после установки. Прочитать/скопировать/расшарить их тривиально.
2. У Claude Code нет встроенного слоя лицензирования, серверной валидации
   подписки или шифрования контента плагина. Marketplace — это просто `git clone`.
3. Skills/agents исполняются локально, оффлайн-способно. Никакого «звонка домой»
   платформа не навязывает.

Итог: **контроль доступа возможен только на уровне РАЗДАЧИ репозитория, а не на
уровне исполнения.** Ты контролируешь, кто может склонировать, а не кто может
запустить уже склонированное.

### 4.2. Что реально работает (по убыванию надёжности)

**A. Gating на уровне доступа к приватному git-репо (основной механизм).**
- Marketplace/плагины лежат в **приватном** GitHub-репо.
- Доступ выдаётся по подписке: покупатель получает доступ через
  GitHub-приглашение в команду/репо, или через **fine-grained PAT / deploy-key**,
  привязанный к его аккаунту. Отзыв доступа = отписка → `git pull`/reinstall
  больше не работает.
- Установка: `/plugin marketplace add https://<token>@github.com/org/nexus.git`
  либо через настроенный git-credential. Это даёт реальный отзываемый доступ.
- Платёж/подписка: Gumroad / Lemon Squeezy / Stripe + вебхук, который
  добавляет/удаляет покупателя в приватный репозиторий (GitHub API
  `repos/{org}/{repo}/collaborators`).

**B. Лицензионный ключ + сервер-валидация (soft gating, анти-casual-sharing).**
- В `nexus-core` skill при первом запуске требует `NEXUS_LICENSE_KEY` (env var).
- Skill через bash/MCP делает запрос к нашему серверу: ключ валиден? → отдаёт
  «ок» и при желании догружает свежие промпты/обновления.
- Это НЕ защищает контент (он уже на диске), но: (1) отсекает массовый
  ресейл, (2) даёт телеметрию активаций, (3) позволяет «протухание» ключа.
- Честно: продвинутый пользователь выпилит проверку из skill за 5 минут.
  Это барьер от честных людей, не от пиратов.

**C. Server-side ценность (самый надёжный «замок» — архитектурный).**
- Самые ценные возможности вынести за **наш MCP-сервер** (по образцу того, как
  `context-mode`/`toprank` ходят в свои бэкенды через MCP-tools и OAuth
  `authenticate`/`complete_authentication`).
- Тогда плагин-клиент бесплатен/открыт, а платный актив — серверная логика,
  обновляемые базы знаний, проприетарные пайплайны, доступ к которым закрыт
  OAuth/API-ключом по подписке. Скопировать .md можно, повторить сервис — нет.
- Минус: требует хостинга и поддержки сервера.

### 4.3. Рекомендация
Гибрид **A + B**, с прицелом на **C** для премиум-тиера:
- `nexus-core` — публичный/бесплатный (воронка, демонстрирует ценность).
- Департаментные плагины — приватный репо, доступ по подписке (механизм A).
- Лицензионный ключ (B) для аналитики и мягкого контроля.
- Премиум-фичи (живые базы, авто-обновления промптов, оркестрация в облаке) —
  за MCP-сервером (C). Это единственный по-настоящему неотчуждаемый актив.

## 5. Публикация и дистрибуция

### 5.1. Два канала

| Канал | Механика | Когда |
|---|---|---|
| **Публичный marketplace** | публичный git-репо, `/plugin marketplace add <url>` свободно | для `nexus-core` (воронка), demo-агентов |
| **Приватная раздача подписчикам** | приватный репо + access по подписке (см. §4.2.A) | для платных департаментных плагинов |

Можно держать ДВА marketplace.json: публичный репо `nexus` (core + тизеры) и
приватный `nexus-pro` (платные плагины). Покупатель добавляет приватный URL
с токеном.

### 5.2. Версионирование
- **SemVer** в `metadata.version` (marketplace) и `plugin.json.version` —
  как у эталонов (`claude-ads` 1.5.1, `context-mode` 1.0.120).
- Версии плагинов независимы (engineering может быть 2.x, marketing-ru 1.x).
- Git-теги на каждый релиз: `nexus-engineering-v1.2.0`.
- Changelog в каждом плагине (`CHANGELOG.md`).

### 5.3. Обновления
- Пользователь: `/plugin update <name>` → `git pull` приватного/публичного репо.
- Для платников отзыв доступа к репо мгновенно блокирует будущие `update`/reinstall
  (уже скачанное останется — см. честную оговорку §4.1).
- Auto-update свежих промптов лучше гнать через MCP-сервер (§4.2.C), не через
  git, чтобы держать ценность на сервере.

### 5.4. Что положить в репо для доверия (как у эталонов)
`README.md`, `LICENSE` (проприетарная, не MIT — у нас платный продукт!),
`SECURITY.md`, `SUPPORT.md`, `CHANGELOG.md`, `.github/` (issue templates),
`install.sh`/`uninstall.sh` (у claude-ads есть `uninstall.ps1`/`.sh`).

## 6. Сборочный пайплайн (.md → артефакт плагина)

### 6.1. Зачем нужен (нельзя copy-paste)
Наш frontmatter (`name: Backend Architect`, `color/emoji/vibe`, без `tools`/`model`)
**несовместим** с тем, что ждёт Claude Code (`name: backend-architect`, `tools:`,
`model:`). Плюс контент живёт в ДВУХ репозиториях (`agency_agents` + `marketing-office`).
Поэтому сборка обязательна: один скрипт читает source-.md и генерит готовые
плагины — без ручного дублирования.

### 6.2. Архитектура пайплайна

```
SOURCE (источник правды, редактируем тут)
  agency_agents/<dept>/*.md          ← Title-case frontmatter + body
  marketing-office/agents/*.md
  agency_agents/.claude/skills/*     ← nexus-* skills
  build/dept-map.json                ← маппинг dept → plugin + tools/model дефолты
        │
        ▼   build/build-plugins.mjs (Node, без внешних зависимостей кроме gray-matter/yaml)
        ▼
DIST (генерируется, .gitignore в source-репо, push в плагин-репо)
  dist/nexus/
    .claude-plugin/marketplace.json  ← генерится из dept-map
    nexus-core/      (plugin.json + skills/ + orchestrator agent)
    nexus-engineering/ (plugin.json + agents/*.md с переписанным frontmatter)
    nexus-marketing-ru/  ...
```

### 6.3. Что делает скрипт (псевдо-шаги)
1. Читает `dept-map.json`: какие папки → в какой плагин, дефолтные `model`/`tools`/`maxTurns`.
2. Для каждого source-.md:
   - парсит frontmatter (gray-matter);
   - `name` → kebab-case (`"Backend Architect"` → `backend-architect`);
   - переносит `description` как есть; маппит `color/emoji/vibe` в комментарий
     или выкидывает; добавляет `tools`/`model`/`maxTurns` из dept-map (с
     возможностью override в самом .md);
   - тело system-prompt — без изменений;
   - пишет в `dist/<plugin>/agents/<name>.md`.
3. Копирует skills из `.claude/skills` в `nexus-core/skills/`, валидирует frontmatter.
4. Генерит `plugin.json` на плагин и общий `marketplace.json` (версии берёт из
   `dept-map.json` / git-тегов).
5. Валидация: каждый `name` уникален в пределах плагина, kebab-case, есть
   `description`; JSON-манифесты проходят schema-check.
6. (CI) GitHub Action на push в `main`: прогон build → если зелено, push `dist/`
   в плагин-репозитории (публичный `nexus` и приватный `nexus-pro`) через
   deploy-key, бамп версий, git-тег.

### 6.4. dept-map.json (образец)
```json
{
  "version": "1.0.0",
  "defaults": { "model": "sonnet", "maxTurns": 20, "tools": "Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task" },
  "plugins": {
    "nexus-engineering": {
      "version": "1.0.0",
      "sources": ["agency_agents/engineering", "agency_agents/testing", "agency_agents/integrations"],
      "category": "development"
    },
    "nexus-marketing-ru": {
      "version": "1.0.0",
      "sources": ["marketing-office/agents"],
      "category": "marketing"
    }
  }
}
```

### 6.5. Принцип «no manual dup»
- Source редактируется ТОЛЬКО в `agency_agents`/`marketing-office`.
- `dist/` и плагин-репозитории — **производные**, руками не трогаем.
- Один git-тег источника → детерминированная сборка всех плагинов.
- Скрипт идемпотентен: повторный прогон даёт тот же результат (для чистых diff'ов).

> Реализация скрипта (`build/build-plugins.mjs`) — отдельная инженерная задача
> для `nexus-engineering`; здесь зафиксирован контракт.

---

## Приложение. Чек-лист запуска
1. [ ] Написать `build/build-plugins.mjs` + `dept-map.json`.
2. [ ] Прогнать сборку, проверить kebab-case `name` и `tools` во всех агентах.
3. [ ] Создать публичный репо `nexus` (core + marketplace.json) и приватный `nexus-pro`.
4. [ ] Настроить Gumroad/Lemon Squeezy → вебхук → GitHub collaborators API.
5. [ ] Решить по MCP-серверу для премиум-фич (тиер C).
6. [ ] CI: build на push, авто-публикация в плагин-репо.
7. [ ] Прогнать через Reality Checker перед публичным релизом.
