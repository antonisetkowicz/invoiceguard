#!/usr/bin/env node
/**
 * resume.mjs — krok 3 systemu /autoc: wznawianie sesji LOKALNYCH.
 *
 * Bierze wynik `scan.mjs`, wybiera sesje zatrzymane przez limit, którym limit
 * już się odnowił, i wznawia je poleceniem `claude --resume <id> -p "<prompt>"`
 * w katalogu roboczym tej sesji.
 *
 * DOMYŚLNIE TRYB PRÓBNY (dry-run) — nic nie uruchamia, tylko wypisuje plan.
 * Realne wznowienie wymaga JEDNOCZEŚNIE:
 *   - flagi `--apply`
 *   - `AUTOC_ENABLED=true` w .env (albo flagi `--force`)
 *
 * Sesje ZDALNE (claude.ai/code) nie są tu obsługiwane — nie da się ich wznowić
 * z dysku; robi to komenda /autoc przez MCP Claude_Code_Remote.
 *
 * Użycie:
 *   node scripts/autoc/resume.mjs                 # plan (dry-run)
 *   node scripts/autoc/resume.mjs --apply         # realne wznowienie
 *   node scripts/autoc/resume.mjs --apply --only <sessionId>
 *   node scripts/autoc/resume.mjs --json
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STATE_DIR, readJson, writeJson, loadEnv, loadConfig, fmtAge } from './lib.mjs';

loadEnv();
const conf = loadConfig();

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
/**
 * Zmienna środowiskowa pod nową nazwą (AUTOC_X), a jeśli jej nie ma — pod starą
 * (AUTORESUME_X sprzed przemianowania systemu), żeby istniejące `.env` działały.
 */
const env = (name) => process.env[`AUTOC_${name}`] ?? process.env[`AUTORESUME_${name}`];

/** Priorytet: zmienna środowiskowa > .claude/autoc.config.json > wartość domyślna. */
const num = (envName, confKey, dflt) => {
  const v = Number(env(envName) ?? conf[confKey]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
};

const DEFAULT_PROMPT = '[auto-wznowienie /autoc] Limit się odnowił. Kontynuuj dokładnie od miejsca, '
  + 'w którym przerwałeś. Najpierw jednym zdaniem streść, na czym stanąłeś, potem '
  + 'dokończ zadanie. Jeśli zadanie było już skończone — napisz to i nic nie zmieniaj. '
  + 'Nie zaczynaj nowego zakresu prac na własną rękę.';

const CFG = {
  enabled: env('ENABLED') !== undefined
    ? String(env('ENABLED')).toLowerCase() === 'true'
    : conf.auto_resume_local === true,
  maxAttempts: num('MAX_ATTEMPTS', 'max_attempts', 3),
  cooldownMin: num('COOLDOWN_MIN', 'cooldown_min', 60),
  maxAgeDays: num('MAX_AGE_DAYS', 'max_age_days', 7),
  maxPerRun: num('MAX_PER_RUN', 'max_per_run', 5),
  timeoutMin: num('TIMEOUT_MIN', 'timeout_min', 30),
  claudeBin: process.env.CLAUDE_BIN || 'claude',
  extraFlags: (env('CLAUDE_FLAGS') || '').split(' ').filter(Boolean),
  exclude: (env('EXCLUDE') || '').split(',').map((s) => s.trim()).filter(Boolean)
    .concat(Array.isArray(conf.exclude) ? conf.exclude : []),
  prompt: env('PROMPT') || conf.resume_prompt || DEFAULT_PROMPT,
};

const apply = flag('--apply');
const force = flag('--force');
const only = opt('--only');
const willRun = apply && (CFG.enabled || force);

// --- wejście ---------------------------------------------------------------
const sessionsFile = opt('--sessions', path.join(STATE_DIR, 'sessions.json'));
const scan = readJson(sessionsFile, null);
if (!scan) {
  console.error(`Brak ${sessionsFile} — uruchom najpierw: node scripts/autoc/scan.mjs`);
  process.exit(2);
}

const logFile = path.join(STATE_DIR, 'resume-log.json');
const log = readJson(logFile, { attempts: {}, runs: [] });
const now = Date.now();

// --- kwalifikacja ----------------------------------------------------------
const decisions = [];
for (const s of scan.sessions || []) {
  if (only && s.session_id !== only) continue;
  const d = { session_id: s.session_id, project: s.project, kategoria: s.kategoria, cwd: s.cwd, source: s.source };

  const skip = (reason) => { d.action = 'skip'; d.reason = reason; decisions.push(d); return true; };

  if (s.status !== 'blocked_by_limit') { skip('nie jest zatrzymana przez limit'); continue; }
  if (s.source !== 'local') { skip('sesja zdalna — wznawia ją /autoc przez MCP, nie ten skrypt'); continue; }
  if (!s.auto_resumable) { skip(`limit typu "${s.limit_type}" wymaga decyzji człowieka`); continue; }
  if (!s.reset_passed) {
    d.action = 'wait';
    d.reason = `limit odnowi się ${s.reset_at}`;
    d.reset_at = s.reset_at;
    decisions.push(d); continue;
  }
  if (!s.cwd || !fs.existsSync(s.cwd)) { skip(`katalog roboczy nie istnieje (${s.cwd || 'brak'})`); continue; }
  if (CFG.maxAgeDays && s.age_days > CFG.maxAgeDays) { skip(`sesja starsza niż ${CFG.maxAgeDays} dni (${s.age_days} d)`); continue; }
  if (CFG.exclude.some((frag) => (s.cwd || '').includes(frag))) { skip('katalog na liście AUTOC_EXCLUDE'); continue; }

  const past = log.attempts[s.session_id] || [];
  if (past.length >= CFG.maxAttempts) { skip(`wyczerpany limit prób (${past.length}/${CFG.maxAttempts})`); continue; }
  const last = past[past.length - 1];
  if (last && now - new Date(last.at).getTime() < CFG.cooldownMin * 60000) {
    skip(`cooldown — ostatnia próba ${fmtAge(last.at)}`); continue;
  }

  d.action = 'resume';
  d.attempt = past.length + 1;
  d.reset_at = s.reset_at;
  d.reset_estimated = Boolean(s.limit_event?.reset_at_estimated);
  decisions.push(d);
}

const toResume = decisions.filter((d) => d.action === 'resume').slice(0, CFG.maxPerRun || undefined);
const overflow = decisions.filter((d) => d.action === 'resume').length - toResume.length;

// --- wykonanie -------------------------------------------------------------
const results = [];
if (willRun) {
  for (const d of toResume) {
    const args = ['--resume', d.session_id, ...CFG.extraFlags, '-p', CFG.prompt];
    const started = new Date().toISOString();
    const proc = spawnSync(CFG.claudeBin, args, {
      cwd: d.cwd,
      timeout: CFG.timeoutMin * 60000,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: process.env,
    });

    const res = {
      session_id: d.session_id,
      at: started,
      finished_at: new Date().toISOString(),
      attempt: d.attempt,
      cwd: d.cwd,
      command: `${CFG.claudeBin} ${args.slice(0, 2).join(' ')} …`,
      exit_code: proc.status,
      timed_out: proc.error?.code === 'ETIMEDOUT' || proc.signal === 'SIGTERM',
      error: proc.error ? String(proc.error.message) : null,
      stdout_tail: (proc.stdout || '').slice(-800),
      stderr_tail: (proc.stderr || '').slice(-800),
    };
    res.result = res.exit_code === 0 ? 'ok' : (res.timed_out ? 'timeout' : 'error');
    results.push(res);

    (log.attempts[d.session_id] ||= []).push({
      at: res.at, attempt: d.attempt, result: res.result, exit_code: res.exit_code,
    });
    console.log(`[${res.result}] ${d.session_id} (${d.project}) — próba ${d.attempt}`);
  }
}

// --- zapis + raport --------------------------------------------------------
const report = {
  generated_at: new Date(now).toISOString(),
  mode: willRun ? 'apply' : 'dry-run',
  blocked_reason: apply && !willRun
    ? 'auto_resume_local=false w .claude/autoc.config.json (albo AUTOC_ENABLED != true) — uruchom z --force, by wymusić'
    : null,
  config: { ...CFG, prompt: `${CFG.prompt.slice(0, 80)}…` },
  counts: {
    kandydaci: decisions.filter((d) => d.action === 'resume').length,
    wznowione: results.filter((r) => r.result === 'ok').length,
    nieudane: results.filter((r) => r.result !== 'ok').length,
    czekaja: decisions.filter((d) => d.action === 'wait').length,
    pominiete: decisions.filter((d) => d.action === 'skip').length,
    ponad_limit_runu: Math.max(0, overflow),
  },
  planned: toResume,
  results,
  waiting: decisions.filter((d) => d.action === 'wait'),
  skipped: decisions.filter((d) => d.action === 'skip'),
};

log.runs.push({ at: report.generated_at, mode: report.mode, ...report.counts });
if (log.runs.length > 200) log.runs = log.runs.slice(-200);
writeJson(logFile, log);
const reportFile = writeJson(path.join(STATE_DIR, 'resume-report.json'), report);

if (flag('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nTryb: ${report.mode}${report.blocked_reason ? ` (${report.blocked_reason})` : ''}`);
  console.log(`Kandydaci: ${report.counts.kandydaci} · czekają na reset: ${report.counts.czekaja} · pominięte: ${report.counts.pominiete}`);
  for (const d of toResume) console.log(`  → wznowić: ${d.session_id} [${d.project}/${d.kategoria}] w ${d.cwd} (próba ${d.attempt})`);
  for (const d of report.waiting) console.log(`  ⏳ czeka:  ${d.session_id} [${d.project}] — ${d.reason}`);
  if (report.counts.ponad_limit_runu) console.log(`  (${report.counts.ponad_limit_runu} ponad limit AUTOC_MAX_PER_RUN=${CFG.maxPerRun} — pójdą w kolejnym cyklu)`);
  console.log(`\nRaport: ${reportFile}\nLog prób: ${logFile}`);
}

process.exit(results.some((r) => r.result !== 'ok') ? 1 : 0);
