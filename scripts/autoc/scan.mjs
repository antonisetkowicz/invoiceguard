#!/usr/bin/env node
/**
 * scan.mjs — krok 1 systemu /autoc.
 *
 * Skanuje wszystkie sesje Claude Code i produkuje:
 *   .claude/session-state/sessions.json  — pełna lista sesji + status limitu
 *   .claude/session-state/projects.json  — sesje pogrupowane wg projektu
 *   .claude/session-state/SESSIONS.md    — czytelny raport dla człowieka
 *
 * Użycie:
 *   node scripts/autoc/scan.mjs
 *   node scripts/autoc/scan.mjs --remote /ścieżka/do/remote-sessions.json
 *   node scripts/autoc/scan.mjs --json          # wypisz sessions.json na stdout
 *   node scripts/autoc/scan.mjs --blocked-only  # tylko zablokowane limitem
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  scanLocalSessions, groupByProject, writeJson, readJson, ensureStateDir,
  extractRemoteList, normalizeRemoteSession, loadRules, fmtAge,
  STATE_DIR, PROJECTS_DIR,
} from './lib.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const now = Date.now();
const rules = loadRules();

// --- sesje lokalne ---------------------------------------------------------
const local = await scanLocalSessions();

// --- sesje zdalne (opcjonalny zrzut z MCP list_sessions) -------------------
let remote = [];
const remoteFile = opt('--remote', path.join(STATE_DIR, 'remote-sessions.json'));
if (remoteFile && fs.existsSync(remoteFile)) {
  const raw = readJson(remoteFile, null);
  const list = extractRemoteList(raw);
  remote = list.map((r) => normalizeRemoteSession(r, now, rules));
}

const sessions = [...local, ...remote];
const blocked = sessions.filter((s) => s.status === 'blocked_by_limit');
const due = blocked.filter((s) => s.auto_resumable && s.reset_passed);
const waiting = blocked.filter((s) => s.auto_resumable && !s.reset_passed);
const needsHuman = blocked.filter((s) => !s.auto_resumable);

const report = {
  generated_at: new Date(now).toISOString(),
  projects_dir: PROJECTS_DIR,
  remote_source: fs.existsSync(remoteFile) ? remoteFile : null,
  counts: {
    total: sessions.length,
    local: local.length,
    remote: remote.length,
    blocked_by_limit: blocked.length,
    due_for_resume: due.length,
    waiting_for_reset: waiting.length,
    needs_human: needsHuman.length,
  },
  sessions,
};

const projects = {
  generated_at: report.generated_at,
  projects: groupByProject(sessions),
};

ensureStateDir();
const sessionsFile = writeJson(path.join(STATE_DIR, 'sessions.json'), report);
const projectsFile = writeJson(path.join(STATE_DIR, 'projects.json'), projects);

// --- raport markdown -------------------------------------------------------
const lines = [];
lines.push(`# Sesje Claude Code — skan ${report.generated_at}`, '');
lines.push(`Sesji łącznie: **${sessions.length}** (lokalne ${local.length}, zdalne ${remote.length}) · `
  + `zablokowane limitem: **${blocked.length}** · do wznowienia teraz: **${due.length}** · `
  + `czekają na reset: **${waiting.length}** · wymagają człowieka: **${needsHuman.length}**`, '');

lines.push('## Projekty', '');
lines.push('| Projekt | Sesje (lok./zdal.) | Zablokowane | Kategorie | Gałęzie | Ostatnia aktywność |');
lines.push('|---|---|---|---|---|---|');
for (const p of projects.projects) {
  const kat = Object.entries(p.kategorie).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} (${v})`).join(', ') || '—';
  lines.push(`| ${p.project} | ${p.sessions} (${p.lokalne}/${p.zdalne}) | ${p.blocked} | ${kat} | `
    + `${p.branches.slice(0, 3).join(', ') || '—'} | ${fmtAge(p.last_activity_at)} |`);
}
lines.push('');

const section = (title, list, extra) => {
  lines.push(`## ${title} (${list.length})`, '');
  if (!list.length) { lines.push('_brak_', ''); return; }
  for (const s of list) {
    lines.push(`- **${s.session_id}** — ${s.project} / ${s.kategoria}`
      + ` · limit: \`${s.limit_type}\`${s.limit_event?.reset_at_estimated ? ' (reset szacowany)' : ''}`
      + ` · reset: ${s.reset_at || '—'}${extra ? ` · ${extra(s)}` : ''}`);
    if (s.first_prompt) lines.push(`  > ${s.first_prompt.slice(0, 160).replace(/\s+/g, ' ')}`);
  }
  lines.push('');
};

section('Do wznowienia TERAZ (limit się odnowił)', due, (s) => `źródło: ${s.source}`);
section('Czekają na odnowienie limitu', waiting, (s) => `za ${Math.max(0, Math.round((new Date(s.reset_at) - now) / 60000))} min`);
section('Wymagają decyzji człowieka (limit tygodniowy/wydatków lub błąd logowania)', needsHuman,
  (s) => s.init_error ? `błąd: ${s.init_error.kind}` : (s.status_detail || '').slice(0, 90));

const mdFile = path.join(STATE_DIR, 'SESSIONS.md');
fs.writeFileSync(mdFile, `${lines.join('\n')}\n`, 'utf8');

// --- wyjście ---------------------------------------------------------------
if (flag('--json')) {
  console.log(JSON.stringify(flag('--blocked-only') ? { ...report, sessions: blocked } : report, null, 2));
} else {
  console.log(lines.join('\n'));
  console.log(`\nZapisano:\n  ${sessionsFile}\n  ${projectsFile}\n  ${mdFile}`);
}
