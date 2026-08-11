#!/bin/bash
#
# auto.sh — jedno wywołanie dla automatu (launchd/cron):
#   sync.sh  →  (opcjonalnie) Claude Code w trybie headless, który sortuje.
#
# Sam nic nie sortuje — sortowanie to decyzja Claude'a przez komendę /notatki.
# Uruchamiane bez terminala, więc wszystko ląduje w logu.
#
set -u
export LC_CTYPE="${LC_CTYPE:-UTF-8}"   # macOS: poprawne lamanie polskich znakow w sed/tr
# launchd startuje z ubogim PATH — dokładamy typowe lokalizacje CLI
export PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

NOTATKI_ROOT="${NOTATKI_ROOT:-$HOME/Notatki-PDF}"
NOTATKI_AUTO_ORGANIZE="${NOTATKI_AUTO_ORGANIZE:-false}"
ENV_FILE="$REPO_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line; do
    case "$line" in
      NOTATKI_ROOT=*|NOTATKI_AUTO_ORGANIZE=*)
        k="${line%%=*}"; v="${line#*=}"
        v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
        eval "$k=\$v" ;;
    esac
  done < "$ENV_FILE"
fi
case "$NOTATKI_ROOT" in "~"*) NOTATKI_ROOT="$HOME${NOTATKI_ROOT#\~}" ;; esac

LOG_DIR="$NOTATKI_ROOT/_stan"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/auto.log"

log() { printf '[%s] %s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$*" >> "$LOG"; }

log "start auto.sh"

if ! "$SCRIPT_DIR/sync.sh" --cicho >> "$LOG" 2>&1; then
  rc=$?
  log "sync.sh zakonczyl sie kodem $rc (3 = czesc konwersji nie wyszla)"
  [ "$rc" -ne 3 ] && { log "przerywam"; exit "$rc"; }
fi

SYNC_JSON="$NOTATKI_ROOT/_zrodla/sync.json"
NOWE=0
if [ -f "$SYNC_JSON" ]; then
  NOWE=$(grep -c '"pdf":' "$SYNC_JSON" 2>/dev/null | tr -d ' ')
  case "$NOWE" in ''|*[!0-9]*) NOWE=0 ;; esac
fi
log "do posortowania pozycji: $NOWE"

if [ "$NOWE" -eq 0 ]; then
  log "brak nowych/zmienionych notatek — koniec"
  exit 0
fi

if [ "$NOTATKI_AUTO_ORGANIZE" != "true" ]; then
  log "NOTATKI_AUTO_ORGANIZE != true — PDF-y czekaja w 00-inbox na reczne /notatki"
  exit 0
fi

if ! command -v claude >/dev/null 2>&1; then
  log "brak CLI 'claude' w PATH — pomijam automatyczne sortowanie"
  exit 0
fi

log "uruchamiam Claude Code (headless) do sortowania"
cd "$REPO_DIR" || exit 1
claude -p "/notatki --tylko-organizuj" --dangerously-skip-permissions >> "$LOG" 2>&1
log "koniec sortowania (kod $?)"
exit 0
