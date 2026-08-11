#!/usr/bin/env bash
# Otwiera na TWOIM komputerze najnowszy raport „Monday" w Gmailu.
# Uruchamiany automatycznie w poniedziałek o 7:00 (launchd na macOS,
# cron/systemd na Linuksie) — patrz install-macos.sh / install-linux.sh.
#
# Użycie ręczne:  ./scripts/monday/open-monday.sh [adres@gmail.com]
#
# Adres odbiorcy: argument > $MONDAY_REPORT_TO > MONDAY_REPORT_TO z .env.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_FILE="${MONDAY_OPEN_LOG:-$HOME/.monday-open.log}"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG_FILE"; }

ADDR="${1:-${MONDAY_REPORT_TO:-}}"
if [ -z "$ADDR" ] && [ -f "$REPO_ROOT/.env" ]; then
  ADDR="$(grep -E '^[[:space:]]*(export[[:space:]]+)?MONDAY_REPORT_TO=' "$REPO_ROOT/.env" \
          | tail -n 1 | sed -E 's/^[^=]*=//; s/^["'\'']//; s/["'\'']$//' | tr -d '[:space:]')"
fi

# Gmail: wyszukiwanie po temacie jest odporniejsze niż po etykiecie —
# działa nawet zanim filtr nada etykietę `monday`.
QUERY='subject%3A%22%5BMonday%5D%22+newer_than%3A8d'
if [ -n "$ADDR" ]; then
  URL="https://mail.google.com/mail/u/${ADDR}/#search/${QUERY}"
else
  URL="https://mail.google.com/mail/u/0/#search/${QUERY}"
  log "UWAGA: brak MONDAY_REPORT_TO — otwieram domyślne konto Gmail (u/0)."
fi

open_url() {
  if command -v open >/dev/null 2>&1; then open "$1"          # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" # Linux
  elif command -v powershell.exe >/dev/null 2>&1; then powershell.exe Start-Process "$1"
  else return 1
  fi
}

if open_url "$URL"; then
  log "otwarto raport Monday w przeglądarce ($ADDR)"
else
  log "BŁĄD: nie znalazłem sposobu otwarcia przeglądarki. URL: $URL"
  echo "$URL"
  exit 1
fi

# Bonus: jeśli w repo jest lokalna kopia najnowszego raportu, otwórz ją też
# (przydatne, gdy pipeline działa na tym samym komputerze). Wyłącz przez
# MONDAY_OPEN_LOCAL=0.
if [ "${MONDAY_OPEN_LOCAL:-1}" = "1" ]; then
  LATEST="$(ls -1dt "$REPO_ROOT"/run/*/monday/report.html 2>/dev/null | head -n 1)"
  if [ -n "${LATEST:-}" ]; then
    # tylko jeśli raport jest z ostatnich 8 dni
    if [ -n "$(find "$LATEST" -mtime -8 2>/dev/null)" ]; then
      open_url "file://$LATEST" && log "otwarto lokalną kopię: $LATEST"
    fi
  fi
fi
