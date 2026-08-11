#!/bin/bash
#
# setup.sh — jednorazowa konfiguracja systemu notatek na Macu.
#
# Tworzy strukturę katalogów, taksonomię startową, dowiązanie ./notatki w repo
# (żeby Claude widział folder bez dodatkowych uprawnień) i sprawdza środowisko.
# Nic nie nadpisuje: istniejące pliki zostają nietknięte.
#
set -u
export LC_CTYPE="${LC_CTYPE:-UTF-8}"   # macOS: poprawne lamanie polskich znakow w sed/tr

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

NOTATKI_ROOT="${NOTATKI_ROOT:-$HOME/Notatki-PDF}"
ENV_FILE="$REPO_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line; do
    case "$line" in
      NOTATKI_ROOT=*)
        v="${line#*=}"; v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
        NOTATKI_ROOT="$v" ;;
    esac
  done < "$ENV_FILE"
fi
case "$NOTATKI_ROOT" in "~"*) NOTATKI_ROOT="$HOME${NOTATKI_ROOT#\~}" ;; esac

echo "Konfiguruję system notatek w: $NOTATKI_ROOT"

mkdir -p \
  "$NOTATKI_ROOT/00-inbox" \
  "$NOTATKI_ROOT/10-projekty" \
  "$NOTATKI_ROOT/20-klienci" \
  "$NOTATKI_ROOT/30-finanse" \
  "$NOTATKI_ROOT/40-pomysly" \
  "$NOTATKI_ROOT/50-osobiste" \
  "$NOTATKI_ROOT/90-archiwum" \
  "$NOTATKI_ROOT/95-nieposortowane" \
  "$NOTATKI_ROOT/_zrodla/html" \
  "$NOTATKI_ROOT/_zrodla/podglad" \
  "$NOTATKI_ROOT/_stan" || { echo "BLAD: nie mogę utworzyć $NOTATKI_ROOT" >&2; exit 1; }

TAX="$NOTATKI_ROOT/_stan/taksonomia.json"
if [ ! -f "$TAX" ]; then
  cat > "$TAX" <<'TAX_EOF'
{
  "opis": "Kategorie, do których Claude sortuje PDF-y z notatek. Możesz to edytować ręcznie — Claude respektuje ten plik. Nowe kategorie dopisuje tylko wtedy, gdy ma na nie co najmniej 3 notatki, i zawsze zapisuje je tutaj.",
  "kategorie": [
    { "katalog": "10-projekty",  "opis": "Prace w toku: projekty, produkty, zadania z terminem, notatki wdrożeniowe, TODO." },
    { "katalog": "20-klienci",   "opis": "Konkretne firmy/osoby po drugiej stronie: ustalenia, spotkania, kontakty, oferty." },
    { "katalog": "30-finanse",   "opis": "Pieniądze: faktury, koszty, budżety, ceny, rozliczenia, podatki, umowy finansowe." },
    { "katalog": "40-pomysly",   "opis": "Nierozpoczęte koncepcje, burze mózgów, inspiracje, 'kiedyś to zrobię'." },
    { "katalog": "50-osobiste",  "opis": "Sprawy prywatne: zdrowie, dom, zakupy, podróże, rodzina." },
    { "katalog": "90-archiwum",  "opis": "Zamknięte i nieaktualne — zostawiamy dla historii." },
    { "katalog": "95-nieposortowane", "opis": "Nie dało się jednoznacznie przypisać. Domyślne miejsce w razie wątpliwości — nigdy nie zgadujemy na siłę." }
  ]
}
TAX_EOF
  echo "  + taksonomia startowa: $TAX"
else
  echo "  = taksonomia już istnieje (nie ruszam): $TAX"
fi

[ -f "$NOTATKI_ROOT/_stan/state.tsv" ] || : > "$NOTATKI_ROOT/_stan/state.tsv"

if [ ! -f "$NOTATKI_ROOT/_stan/organizacja.json" ]; then
  printf '{\n  "opis": "Mapa: notatka → gdzie leży jej PDF. Utrzymuje agent notes-organizer.",\n  "aktualizacja": null,\n  "pozycje": []\n}\n' \
    > "$NOTATKI_ROOT/_stan/organizacja.json"
  echo "  + $NOTATKI_ROOT/_stan/organizacja.json"
fi

# Dowiązanie w repo: Claude pracuje w katalogu repo, więc ./notatki daje mu
# dostęp do folderu bez zmiany uprawnień. Jest w .gitignore.
LINK="$REPO_DIR/notatki"
if [ -L "$LINK" ]; then
  echo "  = dowiązanie ./notatki już istnieje → $(readlink "$LINK")"
elif [ -e "$LINK" ]; then
  echo "  ! $LINK istnieje i nie jest dowiązaniem — pomijam"
else
  ln -s "$NOTATKI_ROOT" "$LINK" && echo "  + dowiązanie: ./notatki → $NOTATKI_ROOT"
fi

chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

if [ ! -f "$ENV_FILE" ]; then
  echo
  echo "UWAGA: brak $ENV_FILE — skopiuj .env.example do .env i ustaw NOTATKI_*."
elif ! grep -q '^NOTATKI_ROOT=' "$ENV_FILE" 2>/dev/null; then
  echo
  echo "UWAGA: w .env brakuje NOTATKI_ROOT — używam domyślnego $NOTATKI_ROOT."
fi

echo
echo "Sprawdzam środowisko..."
"$SCRIPT_DIR/sync.sh" --preflight
PF=$?

echo
if [ "$PF" -eq 0 ]; then
  echo "Gotowe. Następny krok: uruchom /notatki w Claude Code (pierwszy pełny import)."
  echo "Automat co 30 min:  $SCRIPT_DIR/install_launchd.sh 30"
else
  echo "Struktura gotowa, ale środowisko wymaga Twojej akcji — patrz PREFLIGHT wyżej."
fi
exit "$PF"
