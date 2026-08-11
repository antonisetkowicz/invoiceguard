#!/usr/bin/env bash
# Instaluje na macOS dwa zadania launchd:
#   1) com.monday.raport.otwieranie — PONIEDZIAŁEK 07:00: otwiera raport
#      w Gmailu (to jest to, o co chodziło: mail sam się otwiera na ekranie).
#   2) com.monday.raport.generowanie — PONIEDZIAŁEK 05:30 (opcjonalnie):
#      uruchamia `claude -p "/monday"` w tym repo, żeby raport powstał
#      i poszedł na skrzynkę zanim usiądziesz do komputera.
#
# Uruchom:  bash scripts/monday/install-macos.sh
# Bez generowania lokalnie (np. gdy raport robi harmonogram w chmurze):
#           MONDAY_INSTALL_GENERATOR=0 bash scripts/monday/install-macos.sh
# Odinstalowanie:  bash scripts/monday/install-macos.sh --uninstall
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
OPEN_LABEL="com.monday.raport.otwieranie"
GEN_LABEL="com.monday.raport.generowanie"
OPEN_PLIST="$AGENTS_DIR/$OPEN_LABEL.plist"
GEN_PLIST="$AGENTS_DIR/$GEN_LABEL.plist"

if [ "${1:-}" = "--uninstall" ]; then
  for label in "$OPEN_LABEL" "$GEN_LABEL"; do
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$AGENTS_DIR/$label.plist"
    echo "usunięto: $label"
  done
  exit 0
fi

mkdir -p "$AGENTS_DIR"
chmod +x "$REPO_ROOT/scripts/monday/open-monday.sh"

# --- 1) otwieranie maila: poniedziałek 07:00 ---------------------------------
cat >"$OPEN_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$OPEN_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_ROOT/scripts/monday/open-monday.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>7</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$HOME/.monday-open.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/.monday-open.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$OPEN_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$OPEN_PLIST"
echo "OK: $OPEN_LABEL — poniedziałek 07:00, otwiera raport w Gmailu."

# --- 2) generowanie raportu: poniedziałek 05:30 (opcjonalne) -----------------
if [ "${MONDAY_INSTALL_GENERATOR:-1}" = "1" ]; then
  CLAUDE_BIN="$(command -v claude || true)"
  if [ -z "$CLAUDE_BIN" ]; then
    echo "POMINIĘTO generator: nie znaleziono CLI 'claude' w PATH."
    echo "Raport musi wtedy powstawać gdzie indziej (np. Routine w chmurze)."
  else
    cat >"$GEN_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$GEN_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$REPO_ROOT" &amp;&amp; "$CLAUDE_BIN" -p "/monday" --dangerously-skip-permissions</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>5</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$HOME/.monday-run.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/.monday-run.err.log</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$GEN_LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$GEN_PLIST"
    echo "OK: $GEN_LABEL — poniedziałek 05:30, generuje i wysyła raport."
  fi
fi

cat <<'INFO'

Gotowe. Uwagi:
- Komputer musi być włączony (lub wybudzony) o danej godzinie. Jeśli spał,
  launchd odpali zadanie zaraz po wybudzeniu. Możesz też ustawić budzenie:
      sudo pmset repeat wakeorpoweron M 06:55:00
- Test bez czekania do poniedziałku:
      bash scripts/monday/open-monday.sh
- Podgląd logów:  tail -n 20 ~/.monday-open.log
- Odinstalowanie: bash scripts/monday/install-macos.sh --uninstall
INFO
