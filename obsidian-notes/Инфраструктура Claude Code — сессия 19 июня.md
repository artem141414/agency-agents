---
tags: [claude-code, инфраструктура, tooling, видео]
обновлено: 2026-06-19
---

# Инфраструктура Claude Code — сессия 19 июня 2026

> Разбор воркфлоу из ClaudeWorkflows + настройка инструментария. Что реально внедрено.

## ✅ Сделано

### 1. Конфиг `~/.claude` под git
- Репозиторий **`github.com/artem141414/myapp_claude`** (private, проверено HTTP 404 анонимно).
- Версионируется: `CLAUDE.md`, `AGENTS-INDEX.md`, `settings.json`, `agents/` (188 файлов), `commands/`, `hooks/`, `skills/`, `nexus-session-start.ps1`.
- **Секреты исключены** whitelist-`.gitignore` (`/*` + `!`): `.credentials.json`, `~/.claude.json`, `plugins/`, `projects/`, `sessions/`, история. Проверено сканом — ключей в коммите нет.
- README с гайдом развёртывания на новой машине + таблицей всех ключей/MCP.

### 2. Инструменты установлены (портативно, в `~/tools`, в PATH)
- **gh CLI** v2.95.0 → `~/tools/gh/bin` (winget/scoop/choco на машине нет).
- **ffmpeg** v N-125093 (BtbN build) → `~/tools/ffmpeg/.../bin`.

### 3. Видео-пайплайн вертикальных Reels — РАБОТАЕТ ✅
- Движок: **hyperframes** (HeyGen, плагин уже в `settings.json`) — HTML/CSS+GSAP → видео через Puppeteer+FFmpeg. Детерминированно.
- Dev-сборка `producer` падает на баге `build:fonts` (чужой exports-баг) → используется **published npm `hyperframes@0.6.112`** (0 уязвимостей) — правильный пользовательский путь.
- **Доказательство:** отрендерен тестовый клип `Desktop/projects/hf-test/reel/renders/reel.mp4` — h264, **1080×1920**, 30fps, 5.0с, 150 кадров, 1.6MB. Кадр проверен визуально (хук-титр + субтитры). Образец сохранён.
- Второй движок для генеративного видео: **higgsfield** MCP (Veo/Kling/Seedance) — нужна авторизация API-ключом.
- Рабочий цикл клипа: `/hyperframes` (описать словами) → `npm run check` → `npx hyperframes render`.

### 4. Новые шаблоны в `strategy/coordination/`
- **`bmad-context-templates.md`** — PRD / Architecture Spine / Story context-engine (адаптация BMAD v6.8 под NEXUS+Fablize). Усиливает multi-story loop.
- **`project-claude-md-template.md`** — Hard Rules (с причинами) + Session-Closing Pipeline (`/code-review`→`/simplify`→typecheck→commit).
- **`security-essentials-windows.md`** — защита от потери данных под Windows + выборка из «20 hooks» (SQL/секреты/test-gate) + supply-chain гигиена.

## Принцип, выдержанный за сессию
Из 7 разобранных воркфлоу ClaudeWorkflows **брали только недостающие звенья**, не дублируя то, что уже даёт NEXUS / Fablize / скиллы. Reddit-первоисточники недоступны (блок сети по IP) — работали по индексу + first-party репозиториям.

## Заметки
- `get-shit-done` (supply-chain rug-pull) — на машине НЕ установлен, риск не актуален.
- ClaudeWorkflows.org = индекс чужих воркфлоу (2698 шт.), обновляется каждые 2ч. Прямой доступ к Reddit-постам заблокирован.
