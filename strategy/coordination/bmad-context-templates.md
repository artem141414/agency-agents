# 🧬 NEXUS Context-Engineered Templates (адаптация BMAD v6)

> Три документа, которые держат контекст между фазами и агентами: **PRD → Architecture Spine → Story File**.
> Извлечено и адаптировано из [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) v6.8.0 под пайплайн NEXUS.
> Назначение — устранить потерю контекста при handoff (§4.4 CLAUDE.md) и дать dev-агенту самодостаточный story-файл для безошибочной реализации.
>
> **Когда применять:** NEXUS-Sprint и NEXUS-Full (фича/MVP/продуктовый цикл с явными acceptance criteria). Для NEXUS-Micro избыточно — там handoff-templates.md достаточно.

---

## Карта соответствия: BMAD-фазы ↔ NEXUS

| BMAD v6 фаза | Артефакт | NEXUS-департамент / агент | Fablize-привязка |
|---|---|---|---|
| 1. Analysis | Product Brief / Research | Trend Researcher, UX Researcher, Product Manager | — |
| 2. Plan | **PRD** | Product Manager | вход в `goals.py create` |
| 3. Solutioning | **Architecture Spine** + Epics | Software Architect, Backend Architect | — |
| 3→4 | **Story File** (context engine) | Sprint Prioritizer нарезает → handoff | один story = один `goals.py` story |
| 4. Implementation | dev-story → code-review | Frontend/Backend Dev → Code Reviewer, Reality Checker | checkpoint с evidence → финальный гейт |

**Поток данных:** PRD (стабильные `FR-N`, `UJ-N`) → Architecture (`AD-N` invariants) → Epics → Story-файлы (ссылаются на `FR-N`/`AD-N` по ID). Стабильные ID — это и есть «клей», который переживает реорганизацию и handoff.

---

## 1. PRD Template (Plan-фаза)

> **Принцип BMAD:** Glossary-anchored словарь + глобально нумерованные `FR-N` и `UJ-N`, чтобы все downstream-артефакты ссылались на стабильные ID. Counter-metrics — чтобы архитектор не оптимизировал не то.

```markdown
---
title: {Название продукта}
created: {YYYY-MM-DD}
updated: {YYYY-MM-DD}
---

# PRD: {Название продукта}

## 0. Назначение документа
[1 абзац: для кого PRD (PM, стейкхолдеры, владельцы downstream-воркфлоу), как устроен
(Glossary-словарь, фичи с вложенными FR, assumptions помечены инлайн и в индексе).
Если UX/исследования уже есть — назвать их здесь, не дублировать.]

## 1. Видение
[2-3 абзаца: что это, что даёт пользователю, почему важно. Самодостаточно.]

## 2. Целевой пользователь
### 2.1 Jobs To Be Done
[Маркерами. Эмоциональные, социальные, функциональные, контекстные.]
### 2.2 Не-пользователи (v1) (когда граница аудитории неочевидна)
### 2.3 Ключевые пользовательские сценарии (User Journeys)
*Нумеруются глобально UJ-1..UJ-N. FR ссылаются на них инлайн ("реализует UJ-3").*
- **UJ-1. {Заголовок — персона делает действие.}**
  - **Персона + контекст:** одна строка, объясняющая «почему».
  - **Точка входа:** авторизован? с какого экрана? откуда пришёл?
  - **Путь:** 3-5 конкретных шагов — тапы, экраны, решения.
  - **Кульминация:** момент доставки ценности и как пользователь это понял.
  - **Развязка:** в каком состоянии остался, что дальше.
  - **Edge case** (опц.): один реальный сбой и что делает пользователь.

## 3. Глоссарий
*Downstream-агенты обязаны использовать эти термины дословно. Синоним где-либо = нарушение дисциплины.*
- **Термин** — Определение. Связи с другими терминами. Кардинальность.

## 4. Фичи
*Каждая подсекция = связная фича: поведенческое описание → вложенные FR. FR нумеруются глобально FR-1..FR-N.*
### 4.1 {Имя фичи}
**Описание:** [Поведенческий нарратив. Реализует UJ-X, UJ-Y. Термины из глоссария дословно.
Инлайн-теги `[ASSUMPTION: ...]` где вывод сделан без подтверждения.]
**Функциональные требования:**
#### FR-1: {Короткое имя возможности}
[Актор] может [возможность] [при условиях]. Реализует UJ-X.
**Следствия (тестируемые):**
- {Конкретное проверяемое условие.}
**Вне scope:** (опц.) — что этот FR явно НЕ покрывает.

## 5. Не-цели (явно)
[Что продукт НЕ делает в v1. Гасит failure-mode «добавлю-ка ещё соседнюю штуку» на всех уровнях.]

## 6. MVP Scope
### 6.1 В scope    ### 6.2 Вне scope для MVP (с причиной, пометка v2/v3)

## 7. Метрики успеха
**Primary** — **SM-1**: метрика, определение, цель. Валидирует FR-X.
**Secondary** — **SM-2**: ...
**Counter-metrics (НЕ оптимизировать)** — **SM-C1**: почему это НЕ надо оптимизировать. Контрбаланс к SM-1.

## 8. Открытые вопросы
[Нумерованы. Становятся будущими тикетами, а не молчаливыми дырами.]

## 9. Индекс допущений
*Каждый `[ASSUMPTION]` из документа — для явного подтверждения.*
```

**Adapt-In (добавлять кластеры по нужде):** Cross-Cutting NFRs · Constraints (Safety/Privacy/Cost) · Aesthetic & Tone · IA · Монетизация · Платформа · Стейкхолдеры/аппрувы · Риски · ROI · Compliance (GDPR/HIPAA/152-ФЗ) · API-контракты (для dev-продуктов).

---

## 2. Architecture Spine (Solutioning-фаза)

> **Принцип BMAD:** Spine = **scaffold, а не зеркало кода**. Фиксируй только то, что будущий билдер НЕ прочитает из готового кода: инварианты (`AD-N`), конвенции, направление зависимостей. Детали владеет код.

```markdown
---
name: '{имя}'
type: architecture-spine
altitude: feature        # initiative · feature · epic
paradigm: '{паттерн: hexagonal, layered, pipes-and-filters, actor}'
scope: '{что управляет этот spine}'
status: draft            # draft · final
binds: []                # capability/unit IDs из PRD (FR-N) под управлением
---

# Architecture Spine — {имя}

## Design Paradigm
[Назови паттерн (известный грузит целую модель бесплатно) и смаппь его слои на namespace/директории.]

## Inherited Invariants (только если наследует родительский spine)
| Inherited | From parent | Binds here |
| --- | --- | --- |
| {AD-id} | {родительский spine} | {что ограничивает здесь} |

## Invariants & Rules
*Durable-сердце: решения, которые не прочитать из кода. Один блок на решение, стабильный ID (не переиспользуется/не перенумеровывается).*
### AD-1 — {решение}
- **Binds:** {capability/unit ids / FR-N / области / `all`}
- **Prevents:** {какое расхождение это останавливает}
- **Rule:** {ограничение, которому следует downstream}
*Включи mermaid-диаграмму направления зависимостей (кто на кого может зависеть) — это ТОЖЕ правило.*

## Consistency Conventions
| Concern | Convention |
| --- | --- |
| Naming (entities, files, interfaces, events) | |
| Data & formats (ids, dates, error shapes) | |
| State & cross-cutting (mutation, errors, logging, config, auth) | |

## Stack (SEED — актуально на момент написания; дальше владеет код)
| Name | Version |
| --- | --- |
| {язык / фреймворк / ключевая зависимость} | {pinned версия} |

## Structural Seed
[Формы, которые стоит зафиксировать на cold-start: system/container view, core-entity ERD,
минимальное дерево исходников. Каждая — ВАЛИДНЫЙ mermaid, не плейсхолдер.]

## Capability → Architecture Map
| Capability / Area | Lives in | Governed by |
| --- | --- | --- |
| {FR-id / область} | {компонент/модуль} | {AD-id, convention, paradigm} |

## Deferred
[Решения, осознанно спущенные вниз, каждое с причиной почему может подождать.]
```

---

## 3. Story File — Context Engine (Implementation-фаза) ⭐

> **Это самая ценная механика BMAD** и прямое усиление Fablize multi-story loop.
> Story-файл = самодостаточный контейнер: dev-агент получает ВСЁ для безошибочной реализации, не дёргая PRD/Architecture заново.
> **Один story-файл = одна story в `goals.py`.** Sprint Prioritizer генерирует файл → handoff dev-агенту.

### 3.1 Шаблон story-файла

```markdown
# Story {epic_num}.{story_num}: {story_title}

Status: ready-for-dev

## Story
As a {role}, I want {action}, so that {benefit}.

## Acceptance Criteria
1. [Из epics/PRD — формат Given/When/Then, ссылка на FR-N]

## Tasks / Subtasks
- [ ] Task 1 (AC: #)
  - [ ] Subtask 1.1
- [ ] Task 2 (AC: #)

## Dev Notes
- Релевантные архитектурные паттерны и ограничения (из Architecture Spine: AD-N)
- Компоненты дерева исходников, которые трогаем
- Резюме стандартов тестирования

### Project Structure Notes
- Соответствие унифицированной структуре проекта (пути, модули, нейминг)
- Обнаруженные конфликты/расхождения (с обоснованием)

### References
- Цитируй ВСЕ технические детали с путём и секцией источника:
  [Source: docs/architecture.md#AD-3], [Source: prd.md#FR-7]

## Dev Agent Record
### Agent Model Used
{модель и версия}
### Debug Log References
### Completion Notes List
### File List
```

### 3.2 Как Sprint Prioritizer наполняет story-файл (протокол context-engine)

> Цель не скопировать из epics — а **предотвратить типовые LLM-ошибки dev-агента**: изобретение велосипедов, неверные библиотеки/пути, регрессии, игнор UX, ложь о готовности.

Перед записью story-файла агент-нарезчик ОБЯЗАН (можно параллельными субагентами):

1. **Exhaustive analysis эпика** — цели, бизнес-ценность, ВСЕ stories эпика (кросс-контекст), требования и AC нашей story, зависимости.
2. **Previous story intelligence** (если story_num > 1) — прочитать предыдущий story-файл: dev notes, фидбек ревью, какие файлы созданы/изменены и их паттерны, что сработало/нет, найденные проблемы и решения.
3. **Git intelligence** — последние 5 коммитов: какие файлы тронуты, какие конвенции и библиотеки, архитектурные решения, подходы к тестам.
4. **Architecture guardrails** — выдрать из Architecture Spine всё story-релевантное: стек+версии, структуру кода, API-паттерны, схемы БД, security, тестовые стандарты. Какие `AD-N` обязательны.
5. **READ файлов, которые story будет МОДИФИЦИРОВАТЬ** (не NEW, а UPDATE) — **главная причина провалов реализации = это пропустили.** Для каждого задокументировать в Dev Notes: текущее состояние / что меняем / что НЕЛЬЗЯ сломать.
6. **Web research** (опц.) — последние стабильные версии библиотек, breaking changes, security-патчи.

**Critical-правило BMAD (перенести в наш Reality Checker):** реализация story должна оставить систему рабочей end-to-end — не просто закрыть свои AC. Если поведение нужно для корректной работы фичи в существующей системе — это требование, даже если не записано явно. Dev-агент это владеет.

---

## 4. Интеграция с Fablize multi-story loop

```
PRD (PM)  ─────────────────────────────►  goals.py create (цель = MVP по PRD)
   │
   ▼
Architecture Spine (Architect) ── AD-N ──┐
   │                                     │
   ▼                                     ▼
Epics (Architect) ──► Sprint Prioritizer нарезает ──► Story File N  (context engine)
                                                            │
                                          один story = один goals.py story
                                                            ▼
                          Dev-агент: dev-story ──► checkpoint (--verify-evidence: File List + тест)
                                                            ▼
                          Code Reviewer + Reality Checker ──► финальный гейт (goals.py --verify-cmd)
                                                            ▼
                                              done → следующий backlog story
```

- **Story File ←→ goals.py:** секции `Dev Agent Record` (File List, Completion Notes) = это evidence для `goals.py checkpoint --verify-evidence`.
- **Status story-файла** (`ready-for-dev` → `in-progress` → `done`) синхронен статусу story в `goals.py status`.
- **Финальный гейт (§4.5):** Reality Checker проверяет не только AC, но и end-to-end работоспособность (critical-правило из 3.2).

---

## 5. Что НЕ берём из BMAD (осознанно)

- ❌ Их движок `customize.toml` / `resolve_customization.py` / `sprint-status.yaml` — у нас уже есть `goals.py` и состояние в `./.fablize/`. Двойная система состояний не нужна.
- ❌ BMAD-персоны как отдельные агенты — у нас 14+ департаментов NEXUS, маппинг в таблице выше.
- ❌ npm-установку BMAD в проект — берём только шаблоны и протокол context-engine.

---

*Источник: BMAD Method v6.8.0 (commit 9d5739d), MIT/исходная лицензия проекта. Адаптировано под NEXUS + Fablize.*
