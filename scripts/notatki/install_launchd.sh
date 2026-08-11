#!/bin/bash
#
# install_launchd.sh — włącza automatyczne pobieranie notatek co N minut.
#
# launchd, nie cron: przeżywa restart, budzi się po uśpieniu Maca i nie wymaga
# otwartego terminala.
#
# Użycie:
#   ./install_launchd.sh              # co 30 minut (domyślnie)
#   ./install_launchd.sh 15           # co 15 minut
#   ./install_launchd.sh --usun       # odinstaluj
#   ./install_launchd.sh --status     # sprawdź czy działa
#
set -u

LABEL="com.notatki.icloud-sync"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NOTATKI_ROOT="${NOTATKI_ROOT:-$HOME/Notatki-PDF}"

[ "$(uname -s)" = "Darwin" ] || { echo "BLAD: tylko macOS." >&2; exit 1; }

case "${1:-}" in
  --usun|--uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Usunięto automat $LABEL."
    exit 0
    ;;
  --status)
    if launchctl list | grep -q "$LABEL"; then
      echo "AKTYWNY: $LABEL"
      launchctl list | grep "$LABEL"
    else
      echo "NIEAKTYWNY: $LABEL"
    fi
    echo "plist: $PLIST"
    echo "log:   $NOTATKI_ROOT/_stan/auto.log"
    exit 0
    ;;
esac

INTERVAL_MIN="${1:-30}"
case "$INTERVAL_MIN" in
  ''|*[!0-9]*) echo "BLAD: interwał musi być liczbą minut." >&2; exit 2 ;;
esac
[ "$INTERVAL_MIN" -lt 5 ] && { echo "BLAD: minimum 5 minut (Notes.app nie lubi częstszego odpytywania)." >&2; exit 2; }
INTERVAL_SEC=$((INTERVAL_MIN * 60))

chmod +x "$SCRIPT_DIR/auto.sh" "$SCRIPT_DIR/sync.sh" 2>/dev/null || true
mkdir -p "$HOME/Library/LaunchAgents" "$NOTATKI_ROOT/_stan"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT_DIR/auto.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>$INTERVAL_SEC</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$NOTATKI_ROOT/_stan/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$NOTATKI_ROOT/_stan/launchd.err.log</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
if launchctl load "$PLIST" 2>/dev/null; then
  echo "Zainstalowano: $LABEL (co $INTERVAL_MIN min)"
  echo "  plist: $PLIST"
  echo "  log:   $NOTATKI_ROOT/_stan/auto.log"
  echo "  stop:  $0 --usun"
else
  echo "BLAD: launchctl load nie powiodło się." >&2
  echo "Najczęstsza przyczyna: Terminal potrzebuje 'Pełny dostęp do dysku'" >&2
  echo "(Ustawienia systemowe → Prywatność i ochrona → Pełny dostęp do dysku)." >&2
  exit 1
fi
