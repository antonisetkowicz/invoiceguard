#!/usr/bin/env node
/**
 * selftest.mjs — test detektorów limitu i kategoryzacji na syntetycznych transkryptach.
 * Uruchomienie: node scripts/sessions/selftest.mjs
 * Nie dotyka prawdziwych sesji — pracuje w katalogu tymczasowym.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scanLocalSessions, groupByProject, extractResetAt, matchLimit,
  normalizeRemoteSession, extractRemoteList, categorize, DEFAULT_RULES,
} from './lib.mjs';

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wznow-test-'));
const projDir = path.join(tmp, 'projects', '-tmp-projekt-alfa');
fs.mkdirSync(projDir, { recursive: true });

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const line = (o) => `${JSON.stringify(o)}\n`;
const base = { cwd: '/tmp/projekt-alfa', gitBranch: 'main', version: '2.1.0', isSidechain: false };

const write = (id, entries) =>
  fs.writeFileSync(path.join(projDir, `${id}.jsonl`), entries.map(line).join(''), 'utf8');

// 1) limit 5h z jawnym epochem w PRZESZŁOŚCI → gotowa do wznowienia
const past = Math.floor((Date.now() - 60_000) / 1000);
write('sesja-gotowa', [
  { ...base, type: 'user', timestamp: iso(-7200_000), message: { role: 'user', content: 'Napraw błąd w logowaniu' } },
  { ...base, type: 'assistant', timestamp: iso(-7100_000), message: { role: 'assistant', content: [{ type: 'text', text: 'Patrzę na kod.' }] } },
  { ...base, type: 'system', timestamp: iso(-7000_000), content: `Claude AI usage limit reached|${past}` },
]);

// 2) limit 5h bez czasu resetu → reset szacowany, wciąż w przyszłości
write('sesja-czeka', [
  { ...base, type: 'user', timestamp: iso(-3600_000), message: { role: 'user', content: 'Dodaj testy do modułu faktur' } },
  { ...base, type: 'system', timestamp: iso(-600_000), content: '5-hour limit reached' },
]);

// 3) limit, po którym praca ruszyła dalej → NIE zablokowana
write('sesja-odblokowana', [
  { ...base, type: 'user', timestamp: iso(-5400_000), message: { role: 'user', content: 'Wdroż landing na Vercel' } },
  { ...base, type: 'system', timestamp: iso(-5000_000), content: 'Claude AI usage limit reached|' + past },
  { ...base, type: 'assistant', timestamp: iso(-1000_000), message: { role: 'assistant', content: [{ type: 'text', text: 'Wracam do pracy, deployuję.' }] } },
]);

// 4) limit wydatków → wymaga człowieka
write('sesja-portfel', [
  { ...base, type: 'user', timestamp: iso(-9000_000), message: { role: 'user', content: 'Zbadaj rynek SME' } },
  { ...base, type: 'system', timestamp: iso(-8000_000), content: "You've hit your monthly spend limit · raise it at claude.ai/settings/usage" },
]);

// 5) sesja, w której tylko ROZMAWIANO o limitach → NIE zablokowana
write('sesja-o-limitach', [
  { ...base, type: 'user', timestamp: iso(-4000_000), message: { role: 'user', content: 'Zbuduj system, który wykrywa, że sesja dostała komunikat "Claude AI usage limit reached" i wznawia ją po resecie' } },
  { ...base, type: 'assistant', timestamp: iso(-3900_000), message: { role: 'assistant', content: [{ type: 'text', text: `Opisuję wzorce: rate_limit_error, API Error: 429, usage limit reached, monthly spend limit. ${'Szczegółowe omówienie każdego z nich. '.repeat(20)}` }] } },
]);

const sessions = await scanLocalSessions({ projectsDir: path.join(tmp, 'projects') });
const byId = Object.fromEntries(sessions.map((s) => [s.session_id, s]));

ok(sessions.length === 5, `skan znalazł 5 sesji (jest ${sessions.length})`);
ok(byId['sesja-o-limitach']?.status !== 'blocked_by_limit',
  'sesja-o-limitach: rozmowa O limitach nie jest brana za zatrzymanie przez limit');
ok(byId['sesja-gotowa']?.status === 'blocked_by_limit', 'sesja-gotowa: status blocked_by_limit');
ok(byId['sesja-gotowa']?.auto_resumable === true, 'sesja-gotowa: auto_resumable');
ok(byId['sesja-gotowa']?.reset_passed === true, 'sesja-gotowa: reset już minął → do wznowienia');
ok(byId['sesja-gotowa']?.limit_event?.reset_at_estimated === false, 'sesja-gotowa: reset odczytany z epocha, nie szacowany');
ok(byId['sesja-gotowa']?.kategoria === 'bug/fix', `sesja-gotowa: kategoria bug/fix (jest ${byId['sesja-gotowa']?.kategoria})`);

ok(byId['sesja-czeka']?.status === 'blocked_by_limit', 'sesja-czeka: status blocked_by_limit');
ok(byId['sesja-czeka']?.reset_passed === false, 'sesja-czeka: reset jeszcze nie minął');
ok(byId['sesja-czeka']?.limit_event?.reset_at_estimated === true, 'sesja-czeka: reset oszacowany (+5h)');
ok(byId['sesja-czeka']?.kategoria === 'testy', `sesja-czeka: kategoria testy (jest ${byId['sesja-czeka']?.kategoria})`);

ok(byId['sesja-odblokowana']?.status !== 'blocked_by_limit', 'sesja-odblokowana: aktywność po limicie zdejmuje blokadę');
ok(byId['sesja-odblokowana']?.kategoria === 'deploy/infra', `sesja-odblokowana: kategoria deploy/infra (jest ${byId['sesja-odblokowana']?.kategoria})`);

ok(byId['sesja-portfel']?.status === 'blocked_by_limit', 'sesja-portfel: wykryty limit');
ok(byId['sesja-portfel']?.limit_type === 'spend', 'sesja-portfel: typ limitu = spend');
ok(byId['sesja-portfel']?.auto_resumable === false, 'sesja-portfel: NIE wznawiamy automatycznie');

const projects = groupByProject(sessions);
ok(projects.length === 1, `grupowanie: jeden projekt (jest ${projects.length})`);
ok(projects[0].blocked === 3, `grupowanie: 3 sesje zablokowane (jest ${projects[0].blocked})`);
ok(projects[0].auto_resumable === 2, `grupowanie: 2 do auto-wznowienia (jest ${projects[0].auto_resumable})`);

// --- detektory punktowe ----------------------------------------------------
ok(matchLimit('API Error: 429 rate_limit_error')?.type === 'rate', 'matchLimit: 429 → rate');
ok(matchLimit('normalna odpowiedź asystenta') === null, 'matchLimit: zwykły tekst nie jest limitem');
ok(extractResetAt('usage limit reached|1786500000') === new Date(1786500000000).toISOString(),
  'extractResetAt: epoch w sekundach');
ok(extractResetAt('retry-after: 120', '2026-08-11T10:00:00.000Z') === '2026-08-11T10:02:00.000Z',
  'extractResetAt: retry-after w sekundach');
ok(typeof extractResetAt('limit reached, resets at 3pm', '2026-08-11T10:00:00.000Z') === 'string',
  'extractResetAt: format "resets at 3pm"');
ok(extractResetAt('brak informacji o resecie') === null, 'extractResetAt: brak danych → null');

// --- sesje zdalne ----------------------------------------------------------
const remotePayload = {
  ccr: {
    data: [
      {
        id: 'session_limit',
        title: 'Aplikacje do tworzenia reklamy',
        session_status: 'SESSION_STATUS_IDLE',
        created_at: iso(-86400_000),
        updated_at: iso(-3600_000),
        status_bucket: 'SESSION_STATUS_BUCKET_FAILED',
        post_turn_summary: { status_category: 'failed', status_detail: "You've hit your monthly spend limit · raise it at claude.ai/settings/usage" },
        session_context: { sources: [{ git_repository: { url: 'https://github.com/antonisetkowicz/invoiceguard' } }], outcomes: [{ git_repository: { git_info: { repo: 'antonisetkowicz/invoiceguard', branches: ['claude/reklama-7lvm5d'] } } }] },
      },
      {
        id: 'session_rate',
        title: 'Zbuduj panel klienta',
        session_status: 'SESSION_STATUS_IDLE',
        created_at: iso(-86400_000),
        updated_at: iso(-6 * 3600_000),
        status_bucket: 'SESSION_STATUS_BUCKET_FAILED',
        post_turn_summary: { status_category: 'failed', status_detail: 'Claude AI usage limit reached' },
        session_context: { sources: [{ git_repository: { url: 'https://github.com/antonisetkowicz/invoiceguard' } }] },
      },
      {
        id: 'session_ok',
        title: 'Badanie kanałów pozyskiwania klientów',
        session_status: 'SESSION_STATUS_RUNNING',
        created_at: iso(-3600_000),
        updated_at: iso(-60_000),
        status_bucket: 'SESSION_STATUS_BUCKET_WORKING',
      },
    ],
  },
};

const remote = extractRemoteList(remotePayload).map((r) => normalizeRemoteSession(r));
const rById = Object.fromEntries(remote.map((s) => [s.session_id, s]));
ok(rById.session_limit.status === 'blocked_by_limit' && rById.session_limit.auto_resumable === false,
  'remote: limit wydatków → blokada, ale bez auto-wznowienia');
ok(rById.session_rate.status === 'blocked_by_limit' && rById.session_rate.auto_resumable === true
  && rById.session_rate.reset_passed === true,
  'remote: limit 5h sprzed 6h → gotowa do wznowienia');
ok(rById.session_ok.status === 'active' && rById.session_ok.limit_type === null,
  'remote: sesja pracująca nie jest oznaczana jako zablokowana');
ok(rById.session_limit.project === 'antonisetkowicz/invoiceguard',
  `remote: projekt z repo (jest ${rById.session_limit.project})`);
ok(rById.session_ok.project === '(bez repo)', 'remote: sesja bez repo trafia do kategorii "(bez repo)"');

// --- kategoryzacja ---------------------------------------------------------
ok(categorize({ first_prompt: 'Wyślij cold-maile do 50 firm' }, DEFAULT_RULES) === 'marketing/sprzedaż',
  'kategoryzacja: cold-mail → marketing/sprzedaż');
ok(categorize({ first_prompt: '' }, DEFAULT_RULES) === 'nieokreślona',
  'kategoryzacja: pusty prompt → nieokreślona');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} test(ów) nie przeszło` : '\nWszystkie testy przeszły');
process.exit(failed ? 1 : 0);
