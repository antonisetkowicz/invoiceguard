#!/bin/bash
#
# sync.sh — maszynowa część systemu notatek: iCloud (Notes.app) → HTML → PDF.
#
# Robi dokładnie trzy rzeczy i nic więcej:
#   1. eksportuje notatki z Notes.app do HTML (AppleScript),
#   2. konwertuje na PDF (JXA/AppKit — zero zależności),
#   3. utrzymuje stan przyrostowy, żeby nie robić tej samej pracy dwa razy.
#
# Sortowanie/organizacja to osobny krok — robi ją Claude (/notatki).
#
# Kompatybilne z bash 3.2 (domyślny na macOS): bez jq, bez python, bez tablic
# asocjacyjnych, bez mapfile.
#
# Użycie:
#   ./sync.sh [--pelny] [--dni N] [--root SCIEZKA] [--json-out PLIK] [--cicho]
#   ./sync.sh --preflight     # tylko sprawdzenie środowiska i uprawnień
#
set -u
export LC_CTYPE="${LC_CTYPE:-UTF-8}"   # macOS: poprawne lamanie polskich znakow w sed/tr

SEP=$(printf '\037')
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---------------------------------------------------------------- konfiguracja
NOTATKI_ROOT_DEFAULT="$HOME/Notatki-PDF"
NOTATKI_LOOKBACK_DAYS=""
NOTATKI_ACCOUNT=""
NOTATKI_PAPER="A4"

# .env czytamy bezpiecznie: bez `source`, tylko klucze NOTATKI_*
ENV_FILE="$REPO_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line; do
    case "$line" in
      NOTATKI_*=*)
        k="${line%%=*}"
        v="${line#*=}"
        v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
        case "$k" in
          NOTATKI_ROOT|NOTATKI_LOOKBACK_DAYS|NOTATKI_ACCOUNT|NOTATKI_PAPER|NOTATKI_AUTO_ORGANIZE)
            eval "$k=\$v" ;;
        esac
        ;;
    esac
  done < "$ENV_FILE"
fi

NOTATKI_ROOT="${NOTATKI_ROOT:-$NOTATKI_ROOT_DEFAULT}"
case "$NOTATKI_ROOT" in "~"*) NOTATKI_ROOT="$HOME${NOTATKI_ROOT#\~}" ;; esac

# ------------------------------------------------------------------ argumenty
MODE="sync"
FULL=0
DNI_OVERRIDE=""
JSON_OUT=""
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --preflight) MODE="preflight" ;;
    --pelny|--full) FULL=1 ;;
    --dni) shift; DNI_OVERRIDE="${1:-}" ;;
    --root) shift; NOTATKI_ROOT="${1:-}" ;;
    --json-out) shift; JSON_OUT="${1:-}" ;;
    --cicho|--quiet) QUIET=1 ;;
    --pomoc|--help|-h)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "sync.sh: nieznany argument: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }
die() { printf 'BLAD: %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ preflight
preflight() {
  local problems=0

  if [ "$(uname -s)" != "Darwin" ]; then
    echo "PREFLIGHT: FAIL system=$(uname -s) — ten skrypt działa wyłącznie na macOS (Notes.app)."
    return 1
  fi
  echo "PREFLIGHT: OK system=macOS $(sw_vers -productVersion 2>/dev/null)"

  if command -v osascript >/dev/null 2>&1; then
    echo "PREFLIGHT: OK osascript"
  else
    echo "PREFLIGHT: FAIL brak osascript"
    problems=$((problems + 1))
  fi

  if command -v textutil >/dev/null 2>&1; then
    echo "PREFLIGHT: OK textutil (podglądy tekstowe)"
  else
    echo "PREFLIGHT: WARN brak textutil — podglądy tekstowe będą pominięte"
  fi

  # dostęp do Notes.app = uprawnienie Automation (TCC). Pierwsze uruchomienie
  # pokazuje systemowy dialog — bez kliknięcia człowieka to nie zadziała.
  local accounts
  accounts=$(osascript -e 'tell application "Notes" to get name of every account' 2>&1)
  if [ $? -ne 0 ]; then
    echo "PREFLIGHT: FAIL Notes.app niedostępne przez AppleScript"
    echo "PREFLIGHT: powod=$accounts"
    echo "PREFLIGHT: napraw=Ustawienia systemowe → Prywatność i ochrona → Automatyzacja → zezwól Terminalowi na sterowanie Notatkami"
    problems=$((problems + 1))
  else
    echo "PREFLIGHT: OK Notes.app konta=[$accounts]"
    case "$accounts" in
      *iCloud*) echo "PREFLIGHT: OK znaleziono konto iCloud" ;;
      *) echo "PREFLIGHT: WARN brak konta o nazwie 'iCloud' — sprawdź NOTATKI_ACCOUNT" ;;
    esac
  fi

  echo "PREFLIGHT: root=$NOTATKI_ROOT"
  if mkdir -p "$NOTATKI_ROOT" 2>/dev/null; then
    echo "PREFLIGHT: OK katalog docelowy zapisywalny"
  else
    echo "PREFLIGHT: FAIL nie mogę utworzyć $NOTATKI_ROOT"
    problems=$((problems + 1))
  fi

  if [ "$problems" -gt 0 ]; then
    echo "PREFLIGHT: WYNIK=FAIL problemow=$problems"
    return 1
  fi
  echo "PREFLIGHT: WYNIK=OK"
  return 0
}

if [ "$MODE" = "preflight" ]; then
  preflight
  exit $?
fi

# ------------------------------------------------------------ struktura katalogów
ZRODLA="$NOTATKI_ROOT/_zrodla"
STAN="$NOTATKI_ROOT/_stan"
INBOX="$NOTATKI_ROOT/00-inbox"
STATE_FILE="$STAN/state.tsv"
LAST_SYNC="$STAN/last_sync"

[ "$(uname -s)" = "Darwin" ] || die "ten skrypt działa wyłącznie na macOS (Notes.app przez AppleScript)"

mkdir -p "$INBOX" "$ZRODLA/podglad" "$STAN" \
         "$NOTATKI_ROOT/10-projekty" "$NOTATKI_ROOT/20-klienci" \
         "$NOTATKI_ROOT/30-finanse" "$NOTATKI_ROOT/40-pomysly" \
         "$NOTATKI_ROOT/50-osobiste" "$NOTATKI_ROOT/90-archiwum" \
         "$NOTATKI_ROOT/95-nieposortowane" || die "nie mogę utworzyć struktury w $NOTATKI_ROOT"

[ -f "$STATE_FILE" ] || : > "$STATE_FILE"

# ------------------------------------------------------------------- zakres dni
# Pierwszy run = wszystko (0). Kolejne = od ostatniej synchronizacji + zapas 2 dni.
LOOKBACK=0
if [ "$FULL" -eq 1 ]; then
  LOOKBACK=0
elif [ -n "$DNI_OVERRIDE" ]; then
  LOOKBACK="$DNI_OVERRIDE"
elif [ -n "${NOTATKI_LOOKBACK_DAYS:-}" ]; then
  LOOKBACK="$NOTATKI_LOOKBACK_DAYS"
elif [ -f "$LAST_SYNC" ]; then
  last=$(cat "$LAST_SYNC" 2>/dev/null)
  case "$last" in
    ''|*[!0-9]*) LOOKBACK=0 ;;
    *)
      now=$(date +%s)
      diff_days=$(( (now - last) / 86400 + 2 ))
      [ "$diff_days" -lt 1 ] && diff_days=1
      LOOKBACK="$diff_days"
      ;;
  esac
fi

say "→ eksport z Notes.app (zakres: $([ "$LOOKBACK" -eq 0 ] && echo 'wszystkie notatki' || echo "ostatnie $LOOKBACK dni"))"

# świeży katalog źródeł na każdy run (HTML to materiał roboczy, nie archiwum)
rm -rf "$ZRODLA/html" "$ZRODLA/podglad"
mkdir -p "$ZRODLA/html" "$ZRODLA/podglad"

# Notes.app w tle, żeby nie wyskakiwało okno na wierzch
open -g -j -a Notes 2>/dev/null || true

EXPORT_OUT=$(osascript "$SCRIPT_DIR/export_icloud_notes.applescript" \
  "$ZRODLA" "$LOOKBACK" "$NOTATKI_ACCOUNT" 2>&1)
EXPORT_RC=$?

if [ "$EXPORT_RC" -ne 0 ]; then
  echo "BLAD: eksport z Notes.app nie powiódł się." >&2
  echo "  powod: $EXPORT_OUT" >&2
  echo "  najczęstsza przyczyna: brak zgody Automatyzacji (Ustawienia systemowe →" >&2
  echo "  Prywatność i ochrona → Automatyzacja → Terminal → Notatki)." >&2
  exit 1
fi

EKSPORT_N=$(printf '%s' "$EXPORT_OUT" | awk -F"$SEP" '{print $2}' | tail -1)
ZABLOKOWANE_N=$(printf '%s' "$EXPORT_OUT" | awk -F"$SEP" '{print $3}' | tail -1)
case "$EKSPORT_N" in ''|*[!0-9]*) EKSPORT_N=0 ;; esac
case "$ZABLOKOWANE_N" in ''|*[!0-9]*) ZABLOKOWANE_N=0 ;; esac

say "→ wyeksportowano notatek: $EKSPORT_N (pominięto zablokowanych hasłem: $ZABLOKOWANE_N)"

# ------------------------------------------------------------------- narzędzia
slugify() {
  printf '%s' "$1" \
    | sed -e 's/Ą/A/g' -e 's/ą/a/g' -e 's/Ć/C/g' -e 's/ć/c/g' \
          -e 's/Ę/E/g' -e 's/ę/e/g' -e 's/Ł/L/g' -e 's/ł/l/g' \
          -e 's/Ń/N/g' -e 's/ń/n/g' -e 's/Ó/O/g' -e 's/ó/o/g' \
          -e 's/Ś/S/g' -e 's/ś/s/g' -e 's/Ź/Z/g' -e 's/ź/z/g' \
          -e 's/Ż/Z/g' -e 's/ż/z/g' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-\{1,\}//' -e 's/-\{1,\}$//' \
    | cut -c1-60
}

json_str() {  # minimalne cytowanie — wchodzą tu tylko ścieżki i id, nie treść
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

html_to_pdf() {  # $1=html $2=pdf ; łańcuch fallbacków, pierwszy to czysty macOS
  osascript -l JavaScript "$SCRIPT_DIR/html2pdf.js" "$1" "$2" "$NOTATKI_PAPER" >/dev/null 2>&1 \
    && [ -s "$2" ] && return 0

  if command -v wkhtmltopdf >/dev/null 2>&1; then
    wkhtmltopdf --quiet "$1" "$2" >/dev/null 2>&1 && [ -s "$2" ] && return 0
  fi

  local chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [ -x "$chrome" ]; then
    "$chrome" --headless=new --disable-gpu --no-pdf-header-footer \
      --print-to-pdf="$2" "file://$1" >/dev/null 2>&1 && [ -s "$2" ] && return 0
  fi

  if command -v pandoc >/dev/null 2>&1; then
    pandoc "$1" -o "$2" >/dev/null 2>&1 && [ -s "$2" ] && return 0
  fi

  return 1
}

# --------------------------------------------------------------- pętla po notatkach
NEW_STATE="$STAN/state.tsv.new"
: > "$NEW_STATE"

J_NOWE=""; J_UPD=""; J_ERR=""
N_NOWE=0; N_UPD=0; N_SAME=0; N_ERR=0

MANIFEST_TSV="$ZRODLA/manifest.tsv"
if [ -s "$MANIFEST_TSV" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue

    note_id=$(printf '%s' "$line"   | awk -F"$SEP" '{print $1}')
    note_day=$(printf '%s' "$line"  | awk -F"$SEP" '{print $2}')
    note_title=$(printf '%s' "$line"| awk -F"$SEP" '{print $3}')
    html_rel=$(printf '%s' "$line"  | awk -F"$SEP" '{print $4}')

    [ -n "$note_id" ] || continue
    html_abs="$ZRODLA/$html_rel"
    [ -f "$html_abs" ] || continue

    seq=$(basename "$html_rel" .html)
    hash=$(shasum -a 256 "$html_abs" 2>/dev/null | awk '{print $1}')
    [ -n "$hash" ] || hash="brak"

    prev_line=$(grep -F "$note_id$SEP" "$STATE_FILE" 2>/dev/null | head -1)
    prev_hash=$(printf '%s' "$prev_line" | awk -F"$SEP" '{print $2}')
    prev_pdf=$(printf '%s' "$prev_line"  | awk -F"$SEP" '{print $3}')

    # podgląd tekstowy dla Claude (klasyfikacja bez czytania całego HTML)
    if command -v textutil >/dev/null 2>&1; then
      textutil -stdin -format html -convert txt -stdout < "$html_abs" 2>/dev/null \
        | head -c 4000 > "$ZRODLA/podglad/$seq.txt" 2>/dev/null || true
    fi

    # bez zmian → nic nie robimy, przepisujemy stan
    if [ -n "$prev_hash" ] && [ "$prev_hash" = "$hash" ] && [ -f "$NOTATKI_ROOT/$prev_pdf" ]; then
      printf '%s%s%s%s%s\n' "$note_id" "$SEP" "$hash" "$SEP" "$prev_pdf" >> "$NEW_STATE"
      N_SAME=$((N_SAME + 1))
      continue
    fi

    # zmieniona i już posortowana → aktualizujemy PDF W MIEJSCU (kategoria zostaje)
    if [ -n "$prev_pdf" ] && [ -f "$NOTATKI_ROOT/$prev_pdf" ]; then
      pdf_rel="$prev_pdf"
      status="zaktualizowana"
    else
      slug=$(slugify "$note_title")
      [ -n "$slug" ] || slug="notatka"
      case "$note_day" in ????-??-??) : ;; *) note_day=$(date +%Y-%m-%d) ;; esac
      base="${note_day}__${slug}"
      pdf_rel="00-inbox/${base}.pdf"
      n=2
      while [ -f "$NOTATKI_ROOT/$pdf_rel" ]; do
        pdf_rel="00-inbox/${base}-${n}.pdf"
        n=$((n + 1))
      done
      status="nowa"
    fi

    if html_to_pdf "$html_abs" "$NOTATKI_ROOT/$pdf_rel"; then
      printf '%s%s%s%s%s\n' "$note_id" "$SEP" "$hash" "$SEP" "$pdf_rel" >> "$NEW_STATE"
      entry="    {\"seq\": \"$seq\", \"id\": \"$(json_str "$note_id")\", \"pdf\": \"$(json_str "$pdf_rel")\", \"html\": \"_zrodla/$(json_str "$html_rel")\", \"podglad\": \"_zrodla/podglad/$seq.txt\"}"
      if [ "$status" = "nowa" ]; then
        N_NOWE=$((N_NOWE + 1))
        [ -n "$J_NOWE" ] && J_NOWE="$J_NOWE,
"
        J_NOWE="$J_NOWE$entry"
      else
        N_UPD=$((N_UPD + 1))
        [ -n "$J_UPD" ] && J_UPD="$J_UPD,
"
        J_UPD="$J_UPD$entry"
      fi
    else
      # nie zapisujemy hasha — przy następnym runie spróbujemy ponownie
      [ -n "$prev_line" ] && printf '%s\n' "$prev_line" >> "$NEW_STATE"
      N_ERR=$((N_ERR + 1))
      [ -n "$J_ERR" ] && J_ERR="$J_ERR,
"
      J_ERR="$J_ERR    {\"seq\": \"$seq\", \"html\": \"_zrodla/$(json_str "$html_rel")\", \"powod\": \"konwersja HTML→PDF nie powiodła się\"}"
    fi
  done < "$MANIFEST_TSV"
fi

mv "$NEW_STATE" "$STATE_FILE"
date +%s > "$LAST_SYNC"

# ---------------------------------------------------------------- raport JSON
SYNC_JSON="$ZRODLA/sync.json"
{
  printf '{\n'
  printf '  "wygenerowano": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "root": "%s",\n' "$(json_str "$NOTATKI_ROOT")"
  printf '  "lookback_dni": %s,\n' "$LOOKBACK"
  printf '  "eksport": { "notatek": %s, "zablokowanych_haslem": %s },\n' "$EKSPORT_N" "$ZABLOKOWANE_N"
  printf '  "podsumowanie": { "nowe": %s, "zaktualizowane": %s, "bez_zmian": %s, "bledy": %s },\n' \
    "$N_NOWE" "$N_UPD" "$N_SAME" "$N_ERR"
  printf '  "nowe": [\n%s\n  ],\n' "$J_NOWE"
  printf '  "zaktualizowane": [\n%s\n  ],\n' "$J_UPD"
  printf '  "bledy": [\n%s\n  ]\n' "$J_ERR"
  printf '}\n'
} > "$SYNC_JSON"

if [ -n "$JSON_OUT" ]; then
  mkdir -p "$(dirname "$JSON_OUT")" 2>/dev/null || true
  cp "$SYNC_JSON" "$JSON_OUT" 2>/dev/null || true
fi

say "→ nowe PDF-y: $N_NOWE | zaktualizowane: $N_UPD | bez zmian: $N_SAME | błędy: $N_ERR"
say "→ raport: $SYNC_JSON"
say "→ do posortowania: $INBOX"

[ "$N_ERR" -gt 0 ] && exit 3
exit 0
