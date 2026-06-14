#!/usr/bin/env node
// NEXUS plugin builder: .md агентов (source) → плагины Claude Code (dist/).
// Без внешних зависимостей. Источник правды — agency_agents/ и marketing-office/.
// Запуск:  node build/build-plugins.mjs        (собрать enabled-плагины)
//          node build/build-plugins.mjs --all  (собрать все, игнорируя enabled)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));      // agency_agents/build
const AGENCY_ROOT = resolve(SCRIPT_DIR, '..');                  // agency_agents
const WORKSPACE_ROOT = resolve(AGENCY_ROOT, '..');             // projects/
const DIST = join(AGENCY_ROOT, 'dist', 'nexus');
const BUILD_ALL = process.argv.includes('--all');

const cfg = JSON.parse(readFileSync(join(SCRIPT_DIR, 'dept-map.json'), 'utf8'));
const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('  ⚠ ', ...a);

// --- мини-парсер frontmatter (key: value + continuation-строки с отступом) ---
function parseAgent(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return null;
  const [, fmRaw, body] = m;
  const fm = {};
  let lastKey = null;
  for (const line of fmRaw.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1];
      fm[lastKey] = kv[2].trim().replace(/^["']|["']$/g, '');
    } else if (lastKey && /^\s+\S/.test(line)) {
      // продолжение многострочного значения (description: > ...)
      fm[lastKey] = (fm[lastKey] + ' ' + line.trim()).trim();
    }
  }
  return { fm, body: body.trim() };
}

function toKebab(s) {
  return s.toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function yamlEscape(s) {
  // description пишем как литерал в одну строку, экранируя кавычки
  return String(s).replace(/\n+/g, ' ').replace(/"/g, '\\"').trim();
}

function buildAgentMd(name, description, model, maxTurns, tools, body) {
  const fm = [
    '---',
    `name: ${name}`,
    `description: "${yamlEscape(description)}"`,
    `model: ${model}`,
    `maxTurns: ${maxTurns}`,
    `tools: ${tools}`,
    '---',
    '',
  ].join('\n');
  return fm + body + '\n';
}

// --- сборка одного плагина ---
function buildPlugin(pluginName, spec) {
  const tools = spec.tools || cfg.defaults.tools;
  const model = spec.model || cfg.defaults.model;
  const maxTurns = spec.maxTurns || cfg.defaults.maxTurns;
  const outDir = join(DIST, pluginName);
  const agentsDir = join(outDir, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(join(outDir, '.claude-plugin'), { recursive: true });

  const seen = new Set();
  let count = 0;
  for (const src of spec.sources) {
    const srcDir = join(WORKSPACE_ROOT, src);
    if (!existsSync(srcDir)) { warn(`источник не найден: ${src}`); continue; }
    for (const file of readdirSync(srcDir).filter(f => f.endsWith('.md'))) {
      const parsed = parseAgent(readFileSync(join(srcDir, file), 'utf8'));
      if (!parsed) { warn(`нет frontmatter, пропуск: ${src}/${file}`); continue; }
      const name = toKebab(parsed.fm.name && /[a-zA-Z]/.test(parsed.fm.name) && !/[А-Яа-я]/.test(parsed.fm.name)
        ? parsed.fm.name : basename(file, '.md'));
      if (!name) { warn(`пустое имя, пропуск: ${file}`); continue; }
      if (seen.has(name)) { warn(`дубль имени "${name}", пропуск: ${file}`); continue; }
      seen.add(name);
      const description = parsed.fm.description || name;
      const aModel = parsed.fm.model || model;
      const aTools = parsed.fm.tools && /[a-zA-Z]/.test(parsed.fm.tools) ? parsed.fm.tools : tools;
      const aTurns = parsed.fm.maxTurns || maxTurns;
      writeFileSync(join(agentsDir, `${name}.md`),
        buildAgentMd(name, description, aModel, aTurns, aTools, parsed.body), 'utf8');
      count++;
    }
  }

  // plugin.json
  const pluginJson = {
    name: pluginName,
    version: spec.version,
    description: spec.description,
    author: cfg.marketplace.owner,
    license: 'LicenseRef-NEXUS-Proprietary',
    keywords: spec.keywords || [],
  };
  writeFileSync(join(outDir, '.claude-plugin', 'plugin.json'), JSON.stringify(pluginJson, null, 2) + '\n', 'utf8');

  // README
  writeFileSync(join(outDir, 'README.md'),
    `# ${pluginName}\n\n${spec.description}\n\n**Агентов в плагине:** ${count}\n\n` +
    `## Установка\n\`\`\`\n/plugin marketplace add <git-url>/nexus\n/plugin install ${pluginName}\n\`\`\`\n\n` +
    `Сгенерировано build/build-plugins.mjs — не редактировать вручную, правьте source-агентов.\n`, 'utf8');

  log(`  ✓ ${pluginName}: ${count} агентов`);
  return { name: pluginName, count };
}

// --- main ---
function main() {
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, '.claude-plugin'), { recursive: true });
  log(`NEXUS build → ${DIST}`);

  const built = [];
  const mpPlugins = [];
  for (const [name, spec] of Object.entries(cfg.plugins)) {
    if (!BUILD_ALL && !spec.enabled) { log(`  – ${name}: пропущен (enabled:false)`); continue; }
    if (!spec.sources || spec.sources.length === 0) { warn(`${name}: нет sources, пропуск`); continue; }
    const r = buildPlugin(name, spec);
    built.push(r);
    mpPlugins.push({
      name, source: `./${name}`, description: spec.description, version: spec.version,
      author: cfg.marketplace.owner, license: 'LicenseRef-NEXUS-Proprietary',
      category: spec.category || 'productivity', tags: spec.tags || [], keywords: spec.keywords || [],
    });
  }

  const marketplaceJson = {
    name: cfg.marketplace.name,
    owner: cfg.marketplace.owner,
    metadata: { description: cfg.marketplace.description, version: cfg.marketplace.version },
    plugins: mpPlugins,
  };
  writeFileSync(join(DIST, '.claude-plugin', 'marketplace.json'), JSON.stringify(marketplaceJson, null, 2) + '\n', 'utf8');

  const total = built.reduce((s, r) => s + r.count, 0);
  log(`\nГотово: ${built.length} плагин(ов), ${total} агентов. marketplace.json записан.`);
}

main();
