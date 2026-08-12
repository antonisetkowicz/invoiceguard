#!/usr/bin/env node
/**
 * install-api-global.mjs — instaluje /api GLOBALNIE na tym komputerze.
 *
 * /api to pojedynczy plik komendy bez silnika/subagentów/harmonogramu (w
 * odróżnieniu od /autoc), więc instalacja to zwykłe skopiowanie do
 * `~/.claude/commands/` — działa wtedy w KAŻDEJ konwersacji Claude Code na
 * tym komputerze, w dowolnym repo, niezależnie od tego, czy invoiceguard
 * jest wgrane.
 *
 * Użycie:
 *   node scripts/install-api-global.mjs             # instalacja
 *   node scripts/install-api-global.mjs --dry-run    # pokaż, co by zrobił
 *   node scripts/install-api-global.mjs --uninstall  # odinstaluj
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, '..');
const HOME = os.homedir();
const COMMANDS_DIR = path.join(HOME, '.claude', 'commands');
const DEST = path.join(COMMANDS_DIR, 'api.md');
const SRC = path.join(REPO_ROOT, '.claude', 'commands', 'api.md');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');

if (argv.includes('--uninstall')) {
  if (fs.existsSync(DEST)) {
    if (DRY) console.log(`[dry-run] usunąłbym ${DEST}`);
    else {
      fs.rmSync(DEST);
      console.log(`usunięto ${DEST}`);
    }
  } else {
    console.log('brak globalnej instalacji /api — nic do usunięcia');
  }
  process.exit(0);
}

if (!fs.existsSync(SRC)) {
  console.error(`Nie znajduję ${SRC}.\n`
    + 'Uruchamiaj z checkoutu repo: node scripts/install-api-global.mjs');
  process.exit(2);
}

const GLOBAL_HEADER = '<!-- WERSJA GLOBALNA — wygenerowana przez scripts/install-api-global.mjs.\n'
  + '     Nie edytuj tego pliku ręcznie: zmieniaj oryginał w repo (.claude/commands/api.md)\n'
  + '     i uruchom instalator ponownie. -->\n\n';
const content = GLOBAL_HEADER + fs.readFileSync(SRC, 'utf8');

console.log(`Instaluję globalny /api (${DRY ? 'DRY-RUN' : 'na serio'})…\n`);

if (DRY) {
  console.log(`  [dry-run] zapisałbym ${DEST}`);
} else {
  fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  fs.writeFileSync(DEST, content, 'utf8');
  console.log(`  zapisano ${DEST}`);
}

console.log(`
Gotowe. /api działa teraz w KAŻDEJ konwersacji Claude Code na tym komputerze,
niezależnie od tego, czy to repo jest w ogóle wgrane.

Klucze nadal WYŁĄCZNIE ze zmiennych środowiskowych, nigdy hardkodowane w
żadnym pliku: GEMINI_API_KEY, XAI_API_KEY.

Poza checkoutem tego repo nie ma repo-lokalnego .env do wczytania — ustaw
te zmienne globalnie, np. w ~/.zshrc / ~/.bashrc:
  export GEMINI_API_KEY="..."
  export XAI_API_KEY="..."

Odinstalowanie:  node scripts/install-api-global.mjs --uninstall
(albo ręcznie:   rm ~/.claude/commands/api.md)`);
