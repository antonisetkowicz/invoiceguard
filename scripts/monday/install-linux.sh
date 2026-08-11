#!/usr/bin/env bash
# Instaluje na Linuksie (cron użytkownika) otwieranie raportu „Monday"
# w poniedziałek o 07:00 i opcjonalnie generowanie o 05:30.
#
# Uruchom:          bash scripts/monday/install-linux.sh
# Bez generatora:   MONDAY_INSTALL_GENERATOR=0 bash scripts/monday/install-linux.sh
# Odinstalowanie:   bash scripts/monday/install-linux.sh --uninstall
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MARK="# monday-raport"
CRON_NOW="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$CRON_NOW" | grep -v "$MARK" || true)"

if [ "${1:-}" = "--uninstall" ]; then
  printf '%s\n' "$CLEANED" | crontab -
  echo "usunięto wpisy cron dla raportu Monday"
  exit 0
fi

chmod +x "$REPO_ROOT/scripts/monday/open-monday.sh"
NEW="$CLEANED
0 7 * * 1 DISPLAY=:0 bash \"$REPO_ROOT/scripts/monday/open-monday.sh\" $MARK"

if [ "${MONDAY_INSTALL_GENERATOR:-1}" = "1" ] && command -v claude >/dev/null 2>&1; then
  CLAUDE_BIN="$(command -v claude)"
  NEW="$NEW
30 5 * * 1 cd \"$REPO_ROOT\" && \"$CLAUDE_BIN\" -p \"/monday\" --dangerously-skip-permissions >> \"\$HOME/.monday-run.log\" 2>&1 $MARK"
fi

printf '%s\n' "$NEW" | crontab -
crontab -l | grep "$MARK"
echo
echo "Uwaga: komputer musi być włączony o tej godzinie (cron nie nadrabia)."
echo "Test bez czekania: bash \"$REPO_ROOT/scripts/monday/open-monday.sh\""
