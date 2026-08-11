#!/usr/bin/env node
/**
 * install-global.mjs — instaluje /wznow GLOBALNIE na tym komputerze.
 *
 * Po instalacji:
 *   - komenda `/wznow` działa w KAŻDEJ konwersacji Claude Code (dowolny projekt),
 *     bo ląduje w `~/.claude/commands/` razem z subagentami w `~/.claude/agents/`,
 *   - cykl co 5h chodzi w tle niezależnie od jakiejkolwiek otwartej sesji
 *     (launchd na macOS, cron na Linuksie),
 *   - stan i konfiguracja siedzą w `~/.claude/` (`wznow.config.json`,
 *     `session-rules.json`, `session-state/`).
 *
 * Użycie:
 *   node scripts/sessions/install-global.mjs             # instalacja + harmonogram
 *   node scripts/sessions/install-global.mjs --no-cron   # bez harmonogramu
 *   node scripts/sessions/install-global.mjs --dry-run   # pokaż, co by zrobił
 *   node scripts/sessions/install-global.mjs --uninstall # odinstaluj
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, '..', '..');
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const DEST_DIR = path.join(CLAUDE_DIR, 'wznow');
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
const AGENTS_DIR = path.join(CLAUDE_DIR, 'agents');
const RUNNER = path.join(DEST_DIR, 'run-cycle.sh');
const PLIST_LABEL = 'com.wznow.cykl5h';
const PLIST_PATH = path.join(HOME, 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
const CRON_MARK = '# wznow-cykl-5h (auto-wznawianie sesji Claude Code)';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const DRY = has('--dry-run');
const isMac = process.platform === 'darwin';

const done = [];
const note = (msg) => { done.push(msg); console.log(`  ${msg}`); };

const write = (file, content, { mode } = {}) => {
  if (DRY) return note(`[dry-run] zapisałbym ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  if (mode) fs.chmodSync(file, mode);
  note(`zapisano ${file}`);
};

const rm = (file) => {
  if (!fs.existsSync(file)) return;
  if (DRY) return note(`[dry-run] usunąłbym ${file}`);
  fs.rmSync(file, { recursive: true, force: true });
  note(`usunięto ${file}`);
};

// ---------------------------------------------------------------------------
// Przepisywanie ścieżek repo → ścieżki globalne
// ---------------------------------------------------------------------------

const GLOBAL_HEADER = '<!-- WERSJA GLOBALNA — wygenerowana przez scripts/sessions/install-global.mjs.\n'
  + '     Nie edytuj tego pliku ręcznie: zmieniaj oryginał w repo i uruchom instalator ponownie. -->\n\n';

/**
 * Zamienia ścieżki repo-zależne na globalne:
 *   scripts/sessions/X.mjs → ~/.claude/wznow/X.mjs
 *   .claude/cokolwiek      → ~/.claude/cokolwiek
 * Lookbehind pilnuje, żeby nie ruszać ścieżek już poprawnych (`~/.claude/…`).
 */
function globalize(text) {
  return text
    .replace(/node scripts\/sessions\//g, 'node ~/.claude/wznow/')
    .replace(/scripts\/sessions\//g, '~/.claude/wznow/')
    .replace(/(?<![~\w/.])\.claude\//g, '~/.claude/');
}

// ---------------------------------------------------------------------------
// Harmonogram
// ---------------------------------------------------------------------------

const RUNNER_SH = `#!/bin/sh
# Cykl /wznow — uruchamiany co 5h przez launchd (macOS) albo cron (Linux).
# Skan wszystkich sesji + wznowienie tych, którym limit już się odnowił.
set -u
DIR="$HOME/.claude/wznow"
LOG="$DIR/cykl.log"

# rotacja logu przy 512 KB, żeby nie rósł w nieskończoność
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 524288 ]; then
  mv "$LOG" "$LOG.1"
fi

NODE_BIN="\${WZNOW_NODE:-$(command -v node || echo /usr/local/bin/node)}"

{
  echo "=== cykl $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  "$NODE_BIN" "$DIR/scan.mjs" || echo "scan.mjs zakończył się błędem"
  "$NODE_BIN" "$DIR/resume.mjs" --apply || echo "resume.mjs zakończył się błędem (albo część wznowień nie wyszła)"
} >> "$LOG" 2>&1
`;

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>${RUNNER}</string>
  </array>
  <key>StartInterval</key><integer>18000</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${path.join(DEST_DIR, 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(DEST_DIR, 'launchd.err.log')}</string>
</dict>
</plist>
`;

function installSchedulerMac() {
  write(PLIST_PATH, PLIST);
  if (DRY) return note('[dry-run] załadowałbym LaunchAgent przez launchctl');
  const uid = process.getuid ? process.getuid() : 0;
  let r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST_PATH], { encoding: 'utf8' });
  if (r.status !== 0) {
    // starsze macOS-y / już załadowany agent
    spawnSync('launchctl', ['unload', PLIST_PATH], { encoding: 'utf8' });
    r = spawnSync('launchctl', ['load', '-w', PLIST_PATH], { encoding: 'utf8' });
  }
  note(r.status === 0
    ? `LaunchAgent ${PLIST_LABEL} załadowany — cykl co 5h działa w tle`
    : `LaunchAgent zapisany, ale launchctl zwrócił błąd: ${(r.stderr || '').trim() || r.status}. `
      + `Załaduj ręcznie: launchctl load -w ${PLIST_PATH}`);
}

function installSchedulerCron() {
  const line = `0 */5 * * * /bin/sh ${RUNNER}`;
  const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  const existing = cur.status === 0 ? cur.stdout : '';
  if (existing.includes(CRON_MARK)) return note('wpis crona już istnieje — zostawiam bez zmian');
  const next = `${existing.replace(/\s*$/, '\n')}${CRON_MARK}\n${line}\n`;
  if (DRY) return note(`[dry-run] dopisałbym do crontaba: ${line}`);
  const put = spawnSync('crontab', ['-'], { input: next, encoding: 'utf8' });
  note(put.status === 0
    ? 'dopisano wpis crona (co 5h)'
    : `nie udało się zapisać crontaba: ${(put.stderr || '').trim()}. Dopisz ręcznie:\n${CRON_MARK}\n${line}`);
}

function uninstallScheduler() {
  if (isMac) {
    if (fs.existsSync(PLIST_PATH) && !DRY) {
      const uid = process.getuid ? process.getuid() : 0;
      spawnSync('launchctl', ['bootout', `gui/${uid}/${PLIST_LABEL}`], { encoding: 'utf8' });
      spawnSync('launchctl', ['unload', PLIST_PATH], { encoding: 'utf8' });
    }
    rm(PLIST_PATH);
    return;
  }
  const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  if (cur.status !== 0 || !cur.stdout.includes(CRON_MARK)) return note('brak wpisu crona — nic do usunięcia');
  const cleaned = cur.stdout.split('\n')
    .filter((l, i, arr) => !l.includes(CRON_MARK) && !(arr[i - 1] || '').includes(CRON_MARK))
    .join('\n');
  if (DRY) return note('[dry-run] usunąłbym wpis crona');
  spawnSync('crontab', ['-'], { input: `${cleaned.replace(/\s*$/, '\n')}`, encoding: 'utf8' });
  note('usunięto wpis crona');
}

// ---------------------------------------------------------------------------
// Odinstalowanie
// ---------------------------------------------------------------------------

if (has('--uninstall')) {
  console.log('Odinstalowuję globalny /wznow…');
  uninstallScheduler();
  rm(path.join(COMMANDS_DIR, 'wznow.md'));
  rm(path.join(AGENTS_DIR, 'session-scanner.md'));
  rm(path.join(AGENTS_DIR, 'session-resumer.md'));
  rm(DEST_DIR);
  console.log('\nGotowe. Zostawiłem `~/.claude/wznow.config.json`, `~/.claude/session-rules.json` '
    + 'i `~/.claude/session-state/` — usuń ręcznie, jeśli chcesz wyczyścić też ustawienia i historię.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Instalacja
// ---------------------------------------------------------------------------

console.log(`Instaluję globalny /wznow (${DRY ? 'DRY-RUN' : 'na serio'})…\n`);

// 0. instalator musi widzieć źródła w repo (kopia w ~/.claude/wznow/ służy tylko
//    do odinstalowania — nie ma obok siebie plików komendy i agentów)
const commandSrc = path.join(REPO_ROOT, '.claude', 'commands', 'wznow.md');
if (!fs.existsSync(commandSrc)) {
  console.error(`Nie znajduję ${commandSrc}.\n`
    + 'Instalację uruchamiaj z checkoutu repo: node scripts/sessions/install-global.mjs\n'
    + '(kopia w ~/.claude/wznow/ obsługuje tylko --uninstall).');
  process.exit(2);
}

// 1. silnik + instalator (żeby dało się odinstalować bez repo)
for (const f of ['lib.mjs', 'scan.mjs', 'resume.mjs', 'selftest.mjs', 'install-global.mjs']) {
  write(path.join(DEST_DIR, f), fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
}

// 2. komenda i subagenci — z przepisanymi ścieżkami
write(
  path.join(COMMANDS_DIR, 'wznow.md'),
  globalize(fs.readFileSync(commandSrc, 'utf8')) + '\n' + GLOBAL_HEADER,
);
for (const agent of ['session-scanner.md', 'session-resumer.md']) {
  write(
    path.join(AGENTS_DIR, agent),
    globalize(fs.readFileSync(path.join(REPO_ROOT, '.claude', 'agents', agent), 'utf8')) + '\n' + GLOBAL_HEADER,
  );
}

// 3. konfiguracja — NIGDY nie nadpisujemy istniejącej (to ustawienia użytkownika)
for (const f of ['wznow.config.json', 'session-rules.json']) {
  const dest = path.join(CLAUDE_DIR, f);
  if (fs.existsSync(dest)) note(`${dest} już istnieje — zostawiam Twoją wersję`);
  else write(dest, fs.readFileSync(path.join(REPO_ROOT, '.claude', f), 'utf8'));
}

// 4. runner + harmonogram
write(RUNNER, RUNNER_SH, { mode: 0o755 });
if (has('--no-cron')) note('pominąłem harmonogram (--no-cron)');
else if (isMac) installSchedulerMac();
else installSchedulerCron();

// 5. weryfikacja
if (!DRY) {
  const test = spawnSync(process.execPath, [path.join(DEST_DIR, 'selftest.mjs')], { encoding: 'utf8' });
  const okTests = /Wszystkie testy przeszły/.test(test.stdout || '');
  note(okTests ? 'testy silnika przeszły w wersji globalnej' : `UWAGA: testy nie przeszły:\n${test.stdout}${test.stderr}`);

  const scan = spawnSync(process.execPath, [path.join(DEST_DIR, 'scan.mjs')], { encoding: 'utf8' });
  const line = (scan.stdout || '').split('\n').find((l) => l.startsWith('Sesji łącznie'));
  note(scan.status === 0 ? `pierwszy skan wykonany — ${line || 'brak podsumowania'}` : 'UWAGA: pierwszy skan nie wyszedł');
}

console.log(`\nGotowe (${done.length} kroków).

Co masz teraz:
  • /wznow           — działa w KAŻDEJ konwersacji Claude Code na tym komputerze
  • cykl co 5h       — ${has('--no-cron') ? 'NIE zainstalowany (--no-cron)' : isMac ? `launchd ${PLIST_LABEL}` : 'cron (co 5h)'}, chodzi niezależnie od otwartych sesji
  • ustawienia       — ~/.claude/wznow.config.json, ~/.claude/session-rules.json
  • stan i raporty   — ~/.claude/session-state/ (SESSIONS.md, sessions.json, projects.json)
  • log cyklu        — ~/.claude/wznow/cykl.log

Sprawdzenie, że harmonogram żyje:
  ${isMac ? `launchctl list | grep ${PLIST_LABEL}` : 'crontab -l | grep wznow'}
  tail -20 ~/.claude/wznow/cykl.log

Odinstalowanie:  node ~/.claude/wznow/install-global.mjs --uninstall`);
