# Fablize — установка и интеграция в NEXUS

> Дата: 2026-06-19. Статус: установлено, активно с глобального уровня.

Fablize — плагин-harness для Claude Code, который заставляет довести задачу до конца **с доказательствами и проверкой как процедуру**. Не поднимает потолок модели — заставляет дойти до своего потолка. Исходник пользователя был в `C:\Users\User\Downloads\321\fablize-clean\fablize` (временный путь).

## Где лежит
- **Плагин (стабильная папка):** `C:\Users\User\Desktop\projects\fablize-source`
- **Регистрация плагина:** `~/.claude/settings.json` → `extraKnownMarketplaces.fablize` (directory source) + `enabledPlugins."fablize@fablize": true` (по образцу `hyperframes`).
- **Always-on блок:** `~/.claude/CLAUDE.md`, §10, между маркерами `<!-- FABLIZE:BEGIN ... FABLIZE:END -->` (строки ~162–195).
- **Состояние setup:** `~/.fablize/progress.json` (scope=global, integrated_into=nexus).
- **Бэкапы:** `~/.claude/CLAUDE.md.fablize-bak.1781851588`.

## Что чинили под Windows
1. **`python3` отсутствовал** (был только `python`). Все хуки (`gate_*.py`, `router.sh`, `finish-the-work.sh`) и `goals.py` зовут именно `python3`. Решение: создан `python3.exe` = копия `python.exe` в `C:\Users\User\AppData\Local\Programs\Python\Python313\` (папка на PATH). Работает и в PowerShell, и в Git Bash.
2. **`.sh`-хуки** исполняются Claude Code через Git Bash `C:\Program Files\Git\bin\bash.exe` (не WSL). Проверено: все 4 хука дают exit 0, роутер ловит русские триггеры.

## Как работает (два уровня)
- **Уровень 1 — хуки (всегда):** `router.sh` (UserPromptSubmit) подмешивает пак по ключевому слову; гейты `gate_stop`/`gate_post_tool`/`gate_prompt` ловят «обещал и не сделал» и «готово без доказательств».
- **Уровень 2 — always-on (§10 в CLAUDE.md):** резидентные правила, активируются ПО СИГНАЛУ.

## Логика активации (СИГНАЛ) — ключевое
- **Сигнал A — пользователь просит завершение:** «доведи до конца», «доделай», «сделай полностью», «закончи проект», «чтобы работало» и вариации.
- **Сигнал B — Клод/агенты сигналят по ходу:** обещал «сейчас сделаю» и не сделал · изменил файлы без проверки · отладка/упавший тест · render-артефакт (HTML/SVG/игра/UI/график/сайт) · 2+ задач подряд · агент вернул результат без Evidence.
- **Нет сигнала → обычный режим NEXUS**, ничего лишнего.

## Стыковка с NEXUS
- §4.4/§4.5 — fablize стал языком quality gates (Evidence Required, Reality Checker = финальный гейт верификации).
- §5 — при solo-работе дисциплины применяются к собственному исполнению.
- Потолок модели → эскалация состыкована с «max 3 retry» (§4.5): `/effort xhigh` → фоновый Workflow `effort:'max'` → сильнее модель → честный предел.

## ⚠️ Важные предостережения
- **НЕ запускать `setup.sh global`** — перезатрёт ручную интеграцию §10 дефолтным английским блоком.
- Применяется со следующей сессии (CLAUDE.md читается при старте); хуки — после перезапуска Claude Code.
- **Снять:** `bash C:/Users/User/Desktop/projects/fablize-source/setup/uninstall.sh global` либо вернуть бэкап CLAUDE.md.

## Дисциплины (паки)
- Multi-story: `fablize-source/scripts/goals.py` (create → next → checkpoint c evidence → финальный гейт `--verify-cmd`).
- Отладка: `fablize-source/packs/investigation-protocol.txt`.
- Render: `fablize-source/packs/verification-grounding-pack.txt`.
