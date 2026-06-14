# NEXUS — мастер-роадмап эволюции платформы

> Синтез 5 параллельных проработок (Своя модель · Кибербезопасность · Генерация контента · Интеграции соцсетей · Skill Engine), сверенных с реальным кодом `marketing-office/app.py`.
> Дата: 2026-06-14. Дополняет `07-three-features-plan.md` (Скачивание · Профиль · OSINT). Пересматривает экономику `00-MASTER-PLAN.md`.

---

## 0. Главный стратегический вывод

**Своя модель на сервере — это не маржа, это выживание на домашнем рынке.** Anthropic блокирует РФ-IP и карты; текущая схема «юзер платит своим ключом» в РФ нежизнеспособна. Своя open-weight LLM решает три проблемы разом: (1) работает из РФ, (2) убирает барьер входа (не нужен ключ Anthropic), (3) делает расход **измеримым** → возвращает блок «Расход токенов» в профиль. Маржа 50–68% — бонус сверху.

Из этого следует порядок: **сначала фундамент (свой инференс + провайдер-слой + учёт), потом продукты на нём.**

---

## 1. Карта направлений и критический путь

```
                  ┌─────────────────────────────────────────┐
ФАЗА 0 (фундамент)│ Провайдер-слой + Своя модель + Metering   │
                  └───────────────┬─────────────────────────-┘
                                  │ разблокирует ВСЁ
        ┌─────────────────────────┼──────────────────────────┐
        ▼                         ▼                           ▼
ФАЗА 1 (quick wins)        ФАЗА 2 (расширяемость)      сквозные компоненты
┌──────────────────┐      ┌────────────────────┐      ┌───────────────────┐
│ Профиль (+расход) │      │  Skill Engine      │      │ egress-relay NL/PL │
│ Скачивание (zip)  │      │  (provider-agnostic)│     │ persist-jobs       │
└──────────────────┘      └─────────┬──────────┘      │ workspace-медиа    │
                                    │ разблокирует     │ token-vault        │
                          ┌─────────▼──────────┐       └───────────────────┘
                          │ ФАЗА 3: Кибербез   │
                          │ (на скиллах репо)  │
                          └────────────────────┘
        ┌──────────────────────────────────────────────┐
        ▼                                                ▼
ФАЗА 4: Генерация контента ───manifest.json───> ФАЗА 5: Интеграции/постинг
(текст/изобр/видео/аудио/UGC)                   (TG/VK/YouTube + IG/TikTok)
```

**Критический инсайт о переиспользовании:** `provider_adapter.py` (нужен Skill Engine для запуска скиллов на не-Claude модели) и `llm_providers.py` (нужен «своей модели») — **один и тот же слой** Anthropic↔OpenAI. Строим **один раз в Фазе 0**, оба направления его используют.

**Зависимости (жёсткие):**
- Всё → Фаза 0 (провайдер-слой).
- Кибербез (Ф3) → Skill Engine (Ф2): кибербез использует репо Anthropic-Cybersecurity-Skills как скиллы.
- Постинг (Ф5) → Генерация (Ф4): контракт `manifest.json`.
- Профиль-расход (Ф1) → Metering (Ф0): без учёта нечего показывать.

---

## 2. ФАЗА 0 — Фундамент: своя модель + провайдер-слой + учёт токенов

### 2.1. Раннер инференса — vLLM (база), A/B с SGLang
Ollama/llama.cpp **дисквалифицированы**: оркестратор гоняет до 8 агентов × tool-loop до 8 итераций → постоянно 8–60 одновременных генераций. На A100 (Llama-3 8B): при 8 параллельных запросах vLLM 187 tok/s против Ollama 82 tok/s (**2.3×**), при 50 — ~920 против ~155 (**~6×**). SGLang добавляет RadixAttention (общий KV-cache по общему system+GUARD+схемам tools) — до 6.4× на общем контексте. Старт на vLLM (зрелее парсеры tool-call для Qwen), при упоре — A/B SGLang.

### 2.2. Модель — Qwen3-32B AWQ-Int4 (Apache 2.0)
| Модель | Русский | Tool-calling | VRAM Int4 | Лицензия |
|---|---|---|---|---|
| Qwen3-14B AWQ (эконом) | Хороший | Надёжный | ~9–10 GB | **Apache 2.0** ✅ |
| **Qwen3-32B AWQ** ⭐ | Очень хороший | Отличный | ~19–20 GB | **Apache 2.0** ✅ |
| DeepSeek-V3 | Отличный | Хороший | ~350 GB | DeepSeek License (КНР) ⚠️ |
| Llama-3.3-70B | Русский слабее | Да | ~40 GB | Llama Community ⚠️ |
| GigaChat/YaGPT | Эталон RU | Да | только API | проприетарные |

**Критично — лицензия:** Qwen3 = Apache 2.0 → можно продавать доступ. Гибрид: 14B для лёгких агентов (рерайт/посты) + 32B для оркестратора и reasoning. GigaChat/YaGPT — только опц. «российский премиум-API», не основа (иначе снова перепродажа чужого API).

### 2.3. Железо и себестоимость
- **Старт: 1×RTX 4090 24GB** (~80–100 ₽/ч) под Qwen3-14B, ИЛИ **L40S/A6000 48GB** (~170 ₽/ч) под 32B с батчем (Int4 ~20 GB + KV-cache на батч 8 → 24 GB мало, нужна 48 GB).
- Прогон оркестратора: **7–39 ₽** (spot / РФ-A100) против **155 ₽** на Sonnet.
- **Главный риск — холостой простой GPU**: почасовая аренда без нагрузки взвинчивает себестоимость → continuous batching (vLLM) + auto-scale на spot для пиков. Расти по железу **за спросом, не впереди**.

### 2.4. Провайдер-абстракция — мульти-провайдер (наша модель ИЛИ ключ от любой LLM)
**Принцип выбора юзера** (сохраняется и расширяется): пользователь либо **работает на нашей модели** (по подписке, без ключа), либо **вставляет свой API-ключ от любой LLM** — Anthropic, OpenAI, Google Gemini, DeepSeek, Mistral, xAI, OpenRouter, локальный сервер. Никакого жёсткого привязывания к Anthropic.

vLLM отдаёт OpenAI `/v1/chat/completions`, Anthropic SDK шлёт `/v1/messages` — несовместимо. LiteLLM-прокси = лишняя точка отказа на egress-пути из РФ. → Новый модуль **`marketing-office/llm_providers.py`**: `BaseProvider` + реализации + нормализованный `NormResponse` (text, tool_calls, raw_content, stop_reason, usage). Tool-loop работает с `NormResponse`, не зная бэкенда.

**Ключевой упрощающий факт:** почти все LLM-API сегодня либо **OpenAI-совместимы**, либо **Anthropic-совместимы** → **два базовых адаптера покрывают ~весь рынок**. OpenRouter — OpenAI-совместимый шлюз к сотням моделей (один ключ → Claude/GPT/Gemini/DeepSeek/Llama), закрывает экзотику без отдельных адаптеров.

| Режим (`LLM_PROVIDER`) | Адаптер | Endpoint | Ключ |
|---|---|---|---|
| `self` (наша модель) | OpenAICompatProvider | vLLM (наш сервер) | — (по подписке) |
| `anthropic_ours` | AnthropicProvider | api.anthropic.com через relay | наш |
| `user_anthropic` | AnthropicProvider | api.anthropic.com | ключ юзера |
| `user_openai` | OpenAICompatProvider | api.openai.com | ключ юзера |
| `user_gemini` | GeminiProvider* | generativelanguage / OpenAI-compat endpoint | ключ юзера |
| `user_deepseek` / `user_mistral` / `user_xai` | OpenAICompatProvider | их OpenAI-совместимый base_url | ключ юзера |
| `user_openrouter` | OpenAICompatProvider | openrouter.ai/api/v1 | ключ юзера (→ любая модель) |
| `user_custom` | OpenAICompatProvider | произвольный base_url (локальный/корп.) | опц. |

\* Gemini имеет и нативный, и OpenAI-совместимый endpoint — берём OpenAI-совместимый, отдельный адаптер не нужен; нативный GeminiProvider — только если понадобится specifics.

Конфиг через env/`config.json`: `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `MODEL`. Реестр пресетов `PROVIDERS = {openai: {base_url, default_model, format:"openai"}, deepseek: {...}, openrouter: {...}, ...}` — юзер выбирает провайдера из списка, система подставляет base_url и формат, остаётся вставить ключ и (опц.) выбрать модель.

**Нюанс tool-calling:** адаптер нормализует Anthropic-стиль (`tool_use`/`tool_result`, все результаты в одном user-сообщении) и OpenAI-стиль (`tool_calls`/`role=tool`, N сообщений). Предупреждение в UI: слабые/мелкие модели хуже держат tool-use и многошаговый оркестратор — рекомендуем флагманы (Claude/GPT/DeepSeek/Qwen3-32B) для оркестратора, мелкие — для лёгких агентов.

**Правки app.py:** env+пресеты провайдеров (`:36-42`); `get_client()`→`get_provider()` с кэшем по сигнатуре (провайдер+ключ+модель), тонкий alias чтобы не править 5+ мест `get_client() is None` (`:135-146`); tool-loop на `provider.create()`/`NormResponse` (`:686-720`). Ключи юзера — в token-vault (Fernet+keyring, см. §7.2), не в base64.

### 2.4.1. Российские LLM — GigaChat (Sber) и YandexGPT (полноценная поддержка)
Юзер вставляет ключ GigaChat или YaGPT — работают так же качественно (tool-calling, многошаговый оркестратор). Плюс РФ: доступны напрямую, оплата рублями, без relay.

| | GigaChat | YandexGPT (Yandex AI Studio) |
|---|---|---|
| OpenAI-совместимость | Частичная: tool-calling в **старом стиле** `functions`/`function_call` | **Полная**: `/v1/chat/completions` с `tools` в OpenAI-формате |
| Адаптер | **отдельный `GigaChatProvider`** | **`YandexProvider(OpenAICompatProvider)`** — переопределяет только model-prefix+auth |
| Авторизация | OAuth2: Authorization Key → access_token, **TTL 30 мин** (refresh = повторный POST) | статичный **Api-Key** (без refresh) ИЛИ IAM-токен (TTL 12ч) |
| Спец-блокер | **сертификат Минцифры** (Russian Trusted Root CA) обязателен на обоих хостах — иначе TLS падает | нет |
| Обязательное поле | scope (GIGACHAT_API_PERS/CORP) | **folder_id** (внутри `model`: `gpt://<folder>/yandexgpt/latest`) |
| Модели для оркестратора | GigaChat-2-Pro / **Max** (Lite слабо держит tools) | YandexGPT 5.1 **Pro** (Lite слабее) |

**Три критичных нюанса (заложены в адаптеры):**
1. **GigaChat `arguments` приходит готовым dict** (не строкой) — не делать `json.loads`; `finish_reason=="function_call"`; возврат результата `role:"function"`; синтетический tool-call id (своего нет).
2. **`expires_at` GigaChat — в миллисекундах** (не секундах) — ошибка ×1000 = «вечный» или «всегда протухший» токен.
3. **Серверный `web_search` Anthropic (`web_search_20250305`, `:487-495`) у РФ-провайдеров отсутствует** — обязательно переключить на **клиентский** web_search (своя функция, `search_news` `:564` уже есть), иначе агенты «слепнут». Выбор набора инструментов в `build_tools_for_agent` (`:591`) по флагу `provider.server_web_search`.

**AuthManager с авто-refresh:** долгоживущие секреты (Authorization Key / Api-Key / folder_id / scope) — в token-vault (Fernet+keyring); короткоживущие access_token/IAM — только в памяти, refresh за 60с (Giga) / 10мин (Yandex IAM) до истечения. Деградация для слабых моделей: tool-capability gate (не в `models_tool_capable` → поднять до Pro/Max или предупредить), снижение `max_iters` оркестратора. Пресеты `gigachat`/`yandex` в реестре `PROVIDERS` (token_url, base_url, auth_type, needs_cert/needs_folder/needs_scope, tool_format, default_model). Доп. ~7 дней к Фазе 0 (Yandex ~1 день на готовом OpenAICompatProvider, GigaChat ~3 дня из-за OAuth+cert+functions-маппинг).

### 2.5. Token-metering — три реальные дыры
Суммирование по итерациям tool-loop в коде уже есть (`:692-695`), но теряется:
1. **`cache_creation_input_tokens`** (учтён только `cache_read`) — отдельная цена ×1.25. Фикс: `acc.cache_creation += resp.usage.cache_creation_tokens`.
2. **`plan_task` (`:801-816`)** — отдельный `messages.create`, usage не считается.
3. **`_synthesize` (`:851-858`)** — ещё вызов, usage теряется.
Полный прогон (1 план + 8 агентов + 2 синтеза + финал ≈ 12 вызовов) недосчитывает ≥4 из 12.

Новый модуль **`marketing-office/usage.py`**: `UsageAccumulator` (один на запрос юзера, прокидывается через `run_agent`/`plan_task`/`_synthesize`), 4 показателя (input/output/cache_read/cache_creation), cost по PRICING (для `self` = 0, своя GPU). Хранение: локально `~/.nexus/usage.json` (totals + offline-буфер `pending` + `synced_through_ts`); сервер `usage_events` (DDL в `server.py` SCHEMA после `:50`, поле `request_id UNIQUE` — идемпотентный flush). Quota-gate ДО вызова в `api_chat`/`api_orch_run` → `429 quota_exceeded` (для `user_key` не применяется). Счётчик — SQLite/JSON локально, **не Redis** (desktop, один юзер; Redis — только при multi-tenant SaaS).

### 2.6. Оценка Фазы 0: ~17.5 дней
Провайдер-слой 4.5 · фикс tool-loop+cache 1.5 · usage.py+проброс 2.5 · quota-gate 0.5 · сервер usage_events+роуты 1 · поднять vLLM+Qwen3-32B 2 · egress-relay 1.5 · **Reality Check (реальный throughput под tool-loop 8×8, надёжность tool-call парсера на русских схемах, пересчёт break-even на факте) 1** · профиль-расход (бэк+фронт) 3.5.

---

## 3. ФАЗА 1 — Quick wins на текущей базе: Профиль + Скачивание

Полностью описаны в **`07-three-features-plan.md`** (§2 Скачивание, §3 Профиль). Одно изменение по итогам Фазы 0:

### Блок «Расход токенов» в профиле — ВОЗВРАЩЁН (было «убрать из MVP»)
Решение пересмотрено: со своей моделью расход измерим. Блок рендерит **два режима** по источнику модели:
- **Режим «Своя модель» (точный учёт):** hero = прогресс-бар «использовано / лимит тарифа», % и остаток, дата сброса; input/output/cache свёрнуто под «Подробнее»; кэш показываем как **экономию** («Кэш сэкономил ≈ 320K токенов»); история по дням + **Топ агентов** (самый actionable срез); предупреждения 80%→95%→100% (текущие задачи доводятся до конца). **$ не показываем** (юзер платит подпиской).
- **Режим «Ключ юзера» (оценка):** hero = «≈ 2.4M токенов за июнь», знак `≈` везде, без лимита; $ за тоглом «Показать примерную стоимость»; **дисклеймер** «Приблизительно по данным API. Точные цифры — в консоли Anthropic». Не использовать слова «Счёт/Списано».
- Состояния: пусто / ошибка сервера → падаем на локальный кэш с пометкой, **никогда не показываем ноль как факт**. Индикатор режима вверху (зелёная точка «точный учёт» / серая «оценка»).

---

## 4. ФАЗА 2 — Skill Engine (provider-agnostic слой скиллов)

**Цель пользователя:** подключать любые скилы в формате Claude Code (SKILL.md), но чтобы **любой ИИ** (включая свою модель) их исполнял. Переносимость между провайдерами.

### 4.1. Ключевое наблюдение
Тело SKILL.md = **текст-инструкция на естественном языке**, работает на любой модели как есть (инъекция в system-промпт). Claude-специфичны только: (1) авто-триггер по description, (2) исполнение скриптов, (3) формат tool-calling. Все три воспроизводятся силами NEXUS. **80% скилла переносится 1:1, 20% — адаптерами.**

### 4.2. Модуль `skills_engine.py`
- **Парсер SKILL.md**: полноценный YAML-frontmatter (богаче плоского агентского — нужен `yaml.safe_load`, не построчный регэксп `:225-229`): `name, description, version, allowed-tools, license, metadata` + тело-инструкция + скан `scripts/`/`references/`/`assets/` (путь+sha256+размер).
- **Инъекция**: `assemble_system(agent, messages)` дополняет `system_blocks` (`:678-682`) телами активных скиллов + `resolve_skill_tools` добавляет их инструменты к `build_tools_for_agent` (`:677`). Progressive disclosure: сначала name+description, полное тело при срабатывании триггера.
- **Триггеринг**: L0 явный (поле `skills:` в frontmatter агента / `/skill-name`) → L1 keyword (стеммированное пересечение description × запрос, RU через pymorphy3) → L2 семантика (эмбеддинги multilingual-e5, cosine>0.35). На старте L0+L1, L2 при >30 скиллов.

### 4.3. Адаптеры совместимости
- **Скрипты** → серверный sandbox-раннер (встроенный tool `run_skill_script(skill_id, script, args)`, регистрируется в `TOOL_DEFS` `:496-517`; гейт: sha256 скрипта совпадает с манифестом).
- **MCP-tools скилла** → `resolve_skill_tools` + `TOOL_ALIASES` (Read/Glob/Grep→file_read/glob/grep над sandbox-ФС; WebFetch/WebSearch→fetch_url/web_search **уже есть** `:486-517`; Bash→run_skill_script; `mcp__*`→MCP_BRIDGE). Отсутствующий инструмент → `unsatisfied`, скилл деградирует, **не падает**.
- **Tool-calling Anthropic→OpenAI** — это `provider_adapter.py`, **тот же слой что `llm_providers.py` из Фазы 0** (объединить!). `input_schema`≡`parameters`; `tool_use`{id,name,input}↔`tool_calls`{id,function:{name,arguments-JSON}}; `stop_reason=="tool_use"`↔`finish_reason=="tool_calls"`.

### 4.4. Реестр и подключение
`~/.nexus/skills/<id>/` + `_registry.json` + `_plugins/` (наборы claude-ads/claude-seo/кибербез). Подключение: папка / git-clone (репо-наборы целиком) / маркетплейс-плагин. Валидация манифеста, semver, дедуп по имени (как агенты `:257-259`).

### 4.5. Безопасность (КРИТИЧНО — desktop, произвольный код)
**deny-by-default + явное согласие + изоляция.**
- **Trust-уровни:** `official` (подпись ed25519) / `community` (верифиц. git) / `untrusted` (скрипты заблокированы, только текст-инструкция). Изменение файлов → откат в untrusted.
- **Манифест `nexus.json`**: permissions (tools/network=false-по-умолч/fs_read/fs_write/timeout/max_mem), юзер ревьюит и одобряет.
- **Sandbox:** базовый (кроссплатф.) — subprocess с урезанным env (без секретов юзера!), cwd=temp, timeout, отсечение stdout, sha256-гейт. Усиленный (Linux) — контейнер `--network=none` + read-only rootfs. Windows — Job Object + WSL-контейнер для сети.
- **Согласие** перед первым запуском скрипта (модалка: имя/источник/разрешения/sha256), пер-скилл, аннулируется при изменении файла. Глобальный аварийный тумблер «отключить все скрипты».

### 4.6. Доступ агентам
Frontmatter агента +поле `skills:` (плоский парсер `:225-229` читает как CSV, аналог `tools:`). Опц. департаментный манифест `agents/<dept>/department.json` (общие скиллы отдела, мёрдж в `load_agents` `:245-261`). Сквозной пример (кибербез-агент × `vulnerability-scan`) — см. проработку.

### 4.7. Оценка Фазы 2: MVP ~16 дней (+7 hardening)
Парсер 1.5 · реестр 2 · триггер L0+L1 2 · инъекция+resolve_tools 2 · безопасность-ядро 3 · run_skill_script+file-tools 1.5 · **provider-адаптер 3 (общий с Ф0!)** · UI+API 3. Hardening: контейнер-sandbox 3 · подпись · L2-эмбеддинги 2 · E2E на Claude И своей модели 2.

---

## 5. ФАЗА 3 — Отдел «Кибербезопасность» (легальный пентест)

### 5.1. База — репо Anthropic-Cybersecurity-Skills
**754 скилла, 26 доменов**, маппинг на MITRE ATT&CK / NIST CSF / OWASP (Apache-2.0). Авторизационная рамка **уже встроена** в скиллы (`## Prerequisites: Authorization: Written penetration testing agreement / Rules of Engagement`). Категории: SAST/secure-code, DAST/web-pentest, API-security, threat-modeling, network/cloud, vuln-management/CVE, IR/forensics, malware-analysis, detection-engineering, hardening/zero-trust.

### 5.2. Состав — 7 агентов
🛡️ Координатор+authorization-gate (`redteam-lead`) · 🔬 SAST/secure-code (`appsec`) · 🐛 DAST/web-pentest OWASP (`appsec`) · 📐 Threat-modeling (`appsec`) · 🌐 Network/Infra/Cloud (`infra`) · 🚨 IR/Forensics (`blueteam`) · 📊 Vuln-mgmt/CVE+malware-triage (`blueteam`). Пометки [WEB] (реально через fetch_url: headers/TLS/CORS/exposed-эндпоинты/public-buckets/leaked-secrets/CVE-базы) vs [МЕТОД] (Burp/sqlmap/ZAP/nmap/Volatility/Ghidra — генерит команды + интерпретирует вывод клиента).

### 5.3. Два режима
- **A «Консультация»** (по умолчанию): методика, эталонный безопасный код. Авторизация не нужна.
- **B «Глубокий аудит с находками»** (после authorization-gate + клиент принёс артефакт): структурированные находки — Title · Severity+**CVSS 3.1 вектор** · CWE/CVE+EPSS+флаг CISA KEV · Location · PoC/репро · Impact+blast radius · Fix-diff · Refs (NIST/MITRE из тегов скилла). Грань: агент НЕ атакует цель сам — анализирует принесённый артефакт ИЛИ реально проверяет доступное по HTTP через fetch_url ИЛИ генерит команды и интерпретирует вывод.

### 5.4. Легальность (встроена жёстко)
В каждом агенте authorization-gate (право клиента на цель: владение / письменное разрешение / Rules of Engagement / bug-bounty scope) + отказ по **ст. 272/273/274 УК РФ** + 187-ФЗ для КИИ. Двойной гейт: агент + skill engine (offensive-скиллы `exploiting-*` исполняются только при `authorized:true` в скоупе). Defensive-by-default.

### 5.5. departments.json + стыковка
id `cybersecurity`, icon `shield-alert`, 4 subdepartment, **Pro автоматически** (вне FREE_DEPARTMENTS `:168`). НЕ дублирует `engineering/security` (там продуктовый security-engineer; тут — внешняя пентест-фирма как услуга). Skill engine импортирует `index.json` репо в реестр, агенты ссылаются на скиллы по имени, координатор пробрасывает `authorized`-флаг + scope, маппинги обогащают поле Refs автоматически. Атрибуция Apache-2.0 в Appendix отчёта.

### 5.6. Оценка Фазы 3: ~7 дней (с готовым skill engine)
departments.json+папка 1 · 7 агентов 3 · стыковка со skill engine 1 · **legal-ревью (Юрконтролёр + Reality Checker, ст.272/273/274, КИИ) 1** · E2E «проверь веб-приложение» на demo-app с заведёнными уязвимостями + критичный тест-gate «отказ от несанкционированного» 1.

---

## 6. ФАЗА 4 — Отдел «Генерация контента» (текст/изобр/видео/аудио/UGC)

### 6.1. Абстракция `MediaProvider`
Единый контракт по модальностям (submit→provider_job_id, poll→status/asset_url, estimate_cost, `rf_access: direct|relay|yandex_ruble`). Регистр `MEDIA_PROVIDERS[modality][name]`, дефолт в `config.json` (ключ юзера, к нам не уходит — как Anthropic).

### 6.2. Провайдеры (главное — РФ-оплата)
**Российские карты не принимает никто из зарубежных, кроме Yandex (рубли напрямую).** Решение: видео/изобр через **fal.ai relay** (один ключ, pay-as-you-go в обход карт), озвучка — **Yandex SpeechKit**.
- **Видео:** Kling 3.0 ($0.075/с) + Hailuo/MiniMax через fal.ai — база; Google Veo 3.1 (со звуком) — премиум; Runway — точный контроль. (Sora 2 API закрыт.)
- **Аудио:** Yandex SpeechKit (RU TTS, рубли, Brand Voice) — основа; ElevenLabs (эмоции/клон); Suno (музыка, подписка/релей).
- **UGC-аватары:** HeyGen ($3/мин, REST, RU-липсинк) — основной; D-ID (дешёвые talking-photo); Arcads (актёрский UGC).

### 6.3. Async-очередь рендера (поверх `run_orchestration`)
`MEDIA_JOBS` (расширение `ORCH_JOBS` `:797`) поверх паттерна `threading.Thread(daemon=True)` `:982` + поллинг `:987-993`. **Критично:** видео идёт минуты → `ORCH_JOBS` in-memory недопустим, **дублируем на диск `~/.nexus/jobs/<id>.json`** + восстановление при старте. Поток: submit→poll(5–15с)/webhook→скачать→workspace→превью. Семафор параллелизма (видео дорогое), per-modality timeout (видео 15мин), ретраи ≤3. Эндпоинты `/api/media/render`, `/api/media/status`, `/api/media/stream/<id>` (Range/206), `/api/media/callback` (fal/Runway).

### 6.4. Хранение медиа (видео ≠ текстовый workspace)
Расширить workspace `~/.nexus/projects/<id>/` подпапками `text/ images/ audio/ video/ previews/` + `manifest.json`. Новый whitelist по категориям: текст 2МБ, изобр 10МБ, аудио 50МБ, **видео 500МБ**; лимит проекта **2 ГБ**, глобально мягкий 10 ГБ + LRU-очистка. Выдача: текст+изобр+аудио в zip; **видео — стриминг Range, не zip** (в zip только манифест-ссылка). S3 (Yandex Object Storage, рубли) — опц. для SaaS-шеринга.

### 6.5. Состав отдела
Контент-стратег/планировщик · Сценарист/копирайтер · Режиссёр-видео · Звукорежиссёр/аудио · UGC-креатор(аватары) · Моушн/визуал. Выходы — не текст, а media-job'ы в очередь. **Контракт с отделом постинга — `manifest.json` как handoff** (ассеты + метаданные: формат, длительность, соотношение сторон под платформу).

### 6.6. Оценка Фазы 4: MVP ~1 неделя, полный ~5 недель
Ф4.1 (текст+изобр, banana уже есть) 4–6 дн · Ф4.2 (async видео/аудио: MEDIA_JOBS+persist, fal-relay, Yandex SpeechKit, стриминг, whitelist-медиа) 8–12 дн · Ф4.3 (UGC HeyGen+D-ID, опц. S3) 5–7 дн. Reality Checker перед прод (реальный рендер видео + проверка оплаты-релея).

---

## 7. ФАЗА 5 — Интеграции соцсетей + планировщик постинга

### 7.1. Что реально автопостить через API (2026)
✅ **Telegram** (Bot API, легко, сразу) · ✅ **VK/VK Video** (community-токен — надёжнее OAuth) · ✅ **YouTube** (квота `videos.insert` подешевела с ~1600 до ~100 units 04.12.2025 → ~100 загр/день) — **основа, низкий риск**. 🟡 **Instagram** (Graph API + Business-аккаунт + App Review + **egress-relay вне РФ**) · 🟡 **TikTok** (практически только Draft без долгого аудита Content Posting API) · 🔴 **Дзен** (нет API → ручной экспорт / Playwright-костыль позже).

### 7.2. Token Vault (НЕ base64!)
`config.json`/base64 (`:118-121`) — обфускация, для токенов соцсетей не годится (утечка = угон аккаунта). **`vault.py`: Fernet (AES-128-CBC+HMAC, authenticated) шифрует `~/.nexus/vault.bin`; мастер-ключ в ОС-keyring** (Windows Credential Manager / macOS Keychain / Secret Service), fallback — мастер-пароль через scrypt. Модель аккаунта: platform/account_name/account_ref/auth_type/access_token(шифр)/refresh/expires/scopes/extra(relay). Авто-refresh перед публикацией.

### 7.3. Планировщик (персистентный, НЕ in-memory)
**SQLite `~/.nexus/scheduler.db`** (отложенный пост ждёт дни → переживание рестарта обязательно) + daemon-воркер (паттерн `:982`). Таблица posts (status: draft→scheduled→publishing→published|error|canceled, scheduled_at, cron, attempts, next_retry_at, result_url). Воркер каждые 15с берёт due-задания (атомарный UPDATE против двойного захвата), backoff-ретраи 1м→5м→30м→2ч (max 4), уважает rate-limit (`retry_after`), TokenExpired→без ретрая→эскалация в UI. Cron-регулярные через croniter.

### 7.4. Publisher-адаптеры
Единый `Publisher` (MAX_CAPTION, MEDIA_TYPES, MAX_MEDIA, `publish()→URL`, `validate()` — обрезка caption, проверка форматов/размеров/числа медиа, соотношение сторон). Адаптеры: Telegram/VK/YouTube (основа), Instagram(через relay)/TikTok(draft), Дзен(заглушка). Фасад `publish(platform, account_id, media_paths, caption, options, schedule)`.

### 7.5. РФ-2026 легальность (критично!)
С **12.02.2026** полный блок WhatsApp/Facebook/Instagram, Meta — экстремистская. **Покупка рекламы Meta из РФ = уголовка** → NEXUS **не трогает рекламные API Meta**. Органический постинг своего контента — серая зона, **дисклеймер обязателен**, ответственность на клиенте. Instagram-постинг — только через egress-relay вне РФ (relay не хранит токены, только туннелирует HTTPS). VK/Telegram/YouTube/RuTube/Дзен — без таких рисков. Митигация банов: уважать rate-limit, человекоподобные интервалы, не дублировать массово.

### 7.6. UI
Планировщик-календарь внутри отдела «Генерация контента» (сетка, статус-цвета, «Опубликовать сейчас»/«Запланировать»/«В черновик», мультивыбор аккаунтов). Профиль→«Интеграции» (список аккаунтов, OAuth-подключение/ввод токена, «Переподключить» на протухших). Роуты под `@require_auth`+`plan_is_pro`.

### 7.7. Оценка Фазы 5: ядро ~20 дней, полный ~30
Vault 3 · SQLite-планировщик 4 · Telegram+VK 4 · YouTube 2 · API+UI Интеграции 3 · UI-календарь 4 (= ядро TG+VK+YouTube, достаточно для РФ без юррисков). +Instagram+relay 4 · TikTok-draft 2 · Дзен-заглушка 1 · Reality Check 3.

---

## 8. OSINT-отдел (из плана 07)
7 агентов легальной разведки по открытым источникам, Pro, ~5.5 дней. Также использует skill engine (Ф2) для расширения. Детали — `07-three-features-plan.md` §4. Логично ставить после/параллельно Кибербезу (смежная экспертиза, общий legal-контур).

---

## 8.5. Админ-кабинеты (супер-админ + админы) — управляющая надстройка
Полный план — **`09-admin-cabinets-plan.md`**. Кратко:
- **Где:** Blueprint `admin_bp` на **auth-сервере** (наш контур), НЕ в desktop-клиенте — админ управляет всеми юзерами/подписками/инфрой, а это только в `nexus_auth.db`. Изоляция: отдельный домен `admin.nexus-agency.ru`, отдельный `ADMIN_JWT_SECRET`, TTL 30мин, 2FA.
- **RBAC:** `roles/permissions/role_permissions/admins/admin_audit_log/admin_sessions`. `superadmin` (байпас, единственный трогает GPU/провайдеров/relay/цены/legal-отделы/других админов) + `admin` (операционка) + опц. саб-роли (billing/moderator/support/analyst).
- **Честная граница:** видит users/billing/usage/GPU полностью; приватные данные юзера (`~/.nexus/`: диалоги/ключи/проекты) — **никогда** (privacy by design); skills/контент-модерация — только через opt-in телеметрию клиент→сервер.
- **Безопасность:** двухфазный вход (пароль+TOTP), обязательная 2FA для superadmin, jti-сессии (мгновенный отзыв), lockout, IP-allowlist, rate-limit, bootstrap первого superadmin через CLI (не UI), полный аудит (включая отказы).
- **MVP ~5–7 дн:** контур+RBAC+auth+аудит + Пользователи/подписки + **ручная активация Pro** (единственный способ выдать доступ пока ЮKassa — заглушка). Тяжёлые разделы (GPU/провайдеры/skill) — строго следом за фазами платформы (раньше данных нет).
- **Оценка ядра ~11 дн, полностью ~13.5 дн** (без фронт-SPA).

## 9. Сквозные компоненты (строим один раз, используют многие)
| Компонент | Кто использует | Где |
|---|---|---|
| **Провайдер-слой** (Anthropic↔OpenAI) | Своя модель (Ф0) + Skill Engine (Ф2) | `llm_providers.py`/`provider_adapter.py` — **объединить** |
| **egress-relay NL/PL** | `anthropic_ours` (Ф0) + Instagram-постинг (Ф5) + видео fal (Ф4) | микро-VPS вне РФ |
| **persist-jobs на диск** | Видео-рендер (Ф4) + отложенный постинг (Ф5) | `~/.nexus/jobs/`, замена in-memory `ORCH_JOBS` |
| **workspace расширенный** | Скачивание (Ф1) + Генерация медиа (Ф4) | `~/.nexus/projects/` подпапки+лимиты |
| **Token-vault** | Интеграции соцсетей (Ф5), потенц. ключи провайдеров | `vault.py` Fernet+keyring |
| **Quota/usage** | Metering (Ф0) + Профиль (Ф1) | `usage.py` + `usage_events` |

---

## 10. Экономика (пересмотр под свою модель)
Лимиты в **«прогонах оркестратора»** (понятнее токенов). Себестоимость: чат-сообщение 0.67–3.6 ₽, прогон 7–39 ₽ (spot/РФ-A100) против 155 ₽ на Sonnet.

| Тариф | Цена/мес | Прогонов | Себест.@util40% | Маржа |
|---|---|---|---|---|
| Free | 0 | 3 | ~36 ₽ | −36 ₽ (acquisition) |
| **Pro** | **1 490 ₽** | 40 | ~480 ₽ | **+68%** |
| **Team** (5 мест) | **5 900 ₽** | 200 | ~2 880 ₽ | **+51%** |

🚨 На **дорогой РФ-аренде A100** щедрые лимиты делают Pro убыточным даже при 40% выборке → основной трафик на **spot ($0.55/1M)**, РФ-аренда как резерв + throttle на 80%. **Break-even 16–37 платящих** на 1×4090 (тянет ~100 активных). Расти по железу за спросом. Гибрид 3 уровня: Free/Trial→только своя модель (жёсткий лимит, двигатель воронки); Pro→своя по умолчанию + опция «свой Anthropic-ключ»; Team/Enterprise→выделенный инстанс + SLA.

---

## 11. Сводный график и критический путь

| Фаза | Что | Оценка | Зависит от |
|---|---|---|---|
| **0** | Своя модель + провайдер-слой + metering | ~17.5 дн | — (фундамент) |
| **1** | Профиль(+расход) + Скачивание | ~3 дн | Ф0 (для расхода) |
| **2** | Skill Engine (provider-agnostic) | ~16 дн (+7) | Ф0 (общий провайдер-слой) |
| **3** | Кибербез-отдел | ~7 дн | Ф2 (скиллы) |
| **4** | Генерация контента | ~5 нед поэтапно | Ф0 (текст), сквозные |
| **5** | Интеграции/постинг | ~20–30 дн | Ф4 (manifest) |
| OSINT | Отдел разведки | ~5.5 дн | Ф2 (опц.) |
| **Админ** | Кабинеты супер-админа/админов (RBAC) | ядро ~11 дн | server.py; разделы — следом за фазами |

**Критический путь:** Ф0 → Ф2 → Ф3 (фундамент → движок → кибербез). Ф1 быстро после Ф0. Ф4 и Ф5 — самый длинный хвост, можно начинать Ф4 параллельно Ф2 (текстовая часть на Ф0). Совокупно — это **месяцы**, не недели; разбивать на спринты NEXUS-Sprint и валидировать каждый Reality Checker'ом перед прод.

**Рекомендуемая последовательность спринтов:**
1. **Спринт 1 (фундамент):** Фаза 0 целиком. Без неё РФ-продукт нежизнеспособен.
2. **Спринт 2 (ценность для юзера):** Фаза 1 (профиль+скачивание) — то, что видно сразу.
3. **Спринт 3 (расширяемость):** Фаза 2 Skill Engine MVP.
4. **Спринт 4 (флагман-продукт):** Фаза 3 Кибербез + OSINT (на движке).
5. **Спринт 5–7 (медиа-направление):** Фаза 4 поэтапно (текст→видео→UGC).
6. **Спринт 8–9 (дистрибуция контента):** Фаза 5 (TG/VK/YouTube → IG/TikTok).

---

## 12. Риски
| Риск | Митигация |
|---|---|
| GPU-простой убивает экономику | continuous batching vLLM + spot + auto-scale; расти за спросом |
| Tool-call парсер своей модели ненадёжен на русских схемах | Reality Check (Ф0 этап 10) на реальном tool-loop ДО прода |
| Скилл = произвольный код на машине юзера | trust-уровни + nexus.json + sandbox + согласие (Ф2 §4.5) |
| Кибербез-агент даёт лазейку к несанкционированному | authorization-gate ×7 + двойной гейт в engine + legal-ревью + тест-gate |
| РФ-оплата зарубежных медиа-API | fal.ai relay (видео) + Yandex рубли (аудио) с самого начала |
| Meta-блок + юрриски Instagram | egress-relay + дисклеймер + НЕ трогать рекламные API; основа на TG/VK/YouTube |
| Видео/постинг-job теряются при рестарте | persist на диск `~/.nexus/jobs/` + scheduler.db |
| Токены соцсетей утекут | Fernet+keyring vault, не base64 |

---

## 13. Открытые решения (нужен выбор пользователя)
1. **Стартовое железо:** 1×RTX 4090 (Qwen3-14B, дешевле, ~100 активных) против L40S/A6000 48GB (Qwen3-32B, качество reasoning). Рекомендация: **4090 на старте**, 48GB при росте.
2. **Где арендовать GPU:** spot за рубежом ($0.55/1M, дёшево, но egress из РФ) против Timeweb РФ (дороже, но рубли+ближе). Рекомендация: **гибрид — spot основа + РФ-резерв**.
3. **Какой спринт первым:** Фаза 0 (фундамент, обязательна) — но если нужна быстрая демонстрируемая ценность, можно Фазу 1 (профиль+скачивание) на текущей Anthropic-базе параллельно.
4. **GigaChat/YaGPT** как опциональный «российский премиум-режим» — добавлять или только Qwen3?

---

## Файлы (создать / править)
**Создать:** `llm_providers.py` (=`provider_adapter.py`, объединить), `usage.py`, `skills_engine.py`, `vault.py`, `publishers/`, `media_providers.py`.
**Править:** `app.py` (провайдер `:36-42,135-146,686-723`; usage `:692-695,801-816,851-858`; quota `:728-747,963`; skills `:225-242,245-261,486-602,678`; media/jobs `:797,862-941,976-993`); `nexus-auth-server/server.py` (usage_events SCHEMA `:50`, роуты `:207+`); `templates/index.html` (профиль-расход, планировщик, интеграции, скиллы-UI); `departments.json` (cybersecurity, content, osint).
