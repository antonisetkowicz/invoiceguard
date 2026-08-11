# notatki — iCloud → PDF → uporządkowany folder na Macu

System, który sam pobiera Twoje notatki z iCloud, zamienia je w PDF-y, wrzuca do
folderu na Macu i **sam ten folder sortuje** — kategorie, sensowne nazwy plików,
spis treści. Uruchamiany komendą `/notatki` w Claude Code albo automatem co N minut.

Cały łańcuch działa na wbudowanych narzędziach macOS — **zero płatnych usług,
zero instalacji z brew**, zgodnie z zasadą „tylko darmowe narzędzia" tego repo.

---

## Wymagania (uczciwie)

- **macOS z aplikacją Notatki (Notes.app) zalogowaną do iCloud.** Nie ma innej
  drogi: iCloud Notes nie mają publicznego API, a jedyny legalny, stabilny dostęp
  do treści to lokalny AppleScript do Notes.app. Skrypty **nie zadziałają** w
  sesji zdalnej Claude Code ani w kontenerze na Linuksie — muszą polecieć na
  Twoim Macu.
- **Dwie zgody systemowe**, których żaden skrypt nie przyzna sobie sam:
  1. Automatyzacja: Ustawienia systemowe → Prywatność i ochrona → **Automatyzacja**
     → Terminal (lub Claude Code) → **Notatki**.
  2. Tylko jeśli włączasz automat: **Pełny dostęp do dysku** dla Terminala.
- Notatki **zablokowane hasłem są pomijane** — Notes.app nie udostępnia ich treści
  skryptom i tak ma być.

---

## Instalacja (raz)

```bash
cd ~/ścieżka/do/invoiceguard

# 1. konfiguracja (dopisz do .env; plik jest gitignorowany)
cat scripts/notatki/env.notatki.example >> .env
#    ustaw NOTATKI_ROOT jeśli nie chcesz ~/Notatki-PDF

# 2. struktura katalogów + dowiązanie ./notatki + sprawdzenie środowiska
bash scripts/notatki/setup.sh
```

`setup.sh` na końcu odpala preflight. Jeśli zobaczysz
`PREFLIGHT: FAIL Notes.app niedostępne` — to ta zgoda z punktu 1 powyżej;
kliknij ją i uruchom ponownie.

Potem, w Claude Code w katalogu repo:

```
/notatki
```

Pierwszy przebieg zaciąga **wszystkie** notatki, kolejne — tylko zmienione.

---

## Jak to działa

```
Notes.app (iCloud)
      │  AppleScript: export_icloud_notes.applescript
      ▼
  _zrodla/html/*.html  +  manifest.json  +  podglad/*.txt
      │  JXA/AppKit: html2pdf.js  (NSAttributedString → NSPrintOperation)
      ▼
  00-inbox/RRRR-MM-DD__tytul.pdf
      │  Claude, agent notes-organizer
      ▼
  10-projekty/ 20-klienci/ 30-finanse/ 40-pomysly/ 50-osobiste/ 90-archiwum/
      │  Claude, agent notes-librarian
      ▼
  INDEX.md  +  katalog.json
```

Podział jest celowy: **warstwa maszynowa** (`scripts/notatki/`) jest
deterministyczna i nie ocenia treści, **warstwa decyzyjna** (dwa subagenty w
`.claude/agents/`) ocenia treść i nigdy nie kasuje plików.

### Struktura folderu docelowego

| Katalog | Co tam trafia |
|---|---|
| `00-inbox/` | świeże PDF-y czekające na posortowanie |
| `10-projekty/` | prace w toku, zadania z terminem |
| `20-klienci/` | ustalenia, spotkania, oferty per firma/osoba |
| `30-finanse/` | faktury, koszty, budżety, rozliczenia |
| `40-pomysly/` | koncepcje bez zobowiązania |
| `50-osobiste/` | sprawy prywatne |
| `90-archiwum/` | zamknięte i nieaktualne |
| `95-nieposortowane/` | świadome „nie wiem" — lepsze niż zgadywanie |
| `_zrodla/` | HTML + podglądy tekstowe (materiał roboczy, kasowany co run) |
| `_stan/` | stan przyrostowy, taksonomia, mapa notatka→plik, logi |
| `INDEX.md` | **od tego zaczynasz szukanie** |

Kategorie edytujesz ręcznie w `_stan/taksonomia.json` — Claude respektuje ten
plik. Nową kategorię dopisuje sam tylko wtedy, gdy ma na nią ≥3 notatki.

---

## Codzienne użycie

| Komenda | Efekt |
|---|---|
| `/notatki` | pełny przebieg: pobierz → PDF → posortuj → indeks → raport |
| `/notatki --tylko-eksport` | tylko nowe PDF-y w `00-inbox`, bez sortowania |
| `/notatki --tylko-organizuj` | posortuj to, co już leży w `00-inbox` |
| `/notatki --pelny` | przebuduj wszystko od zera (wszystkie notatki) |
| `/notatki dni: 7` | tylko notatki zmienione w ostatnim tygodniu |
| `/notatki --auto 30` | to co `/notatki` + instalacja automatu co 30 min |
| `/notatki --setup` | sama konfiguracja startowa |

Bezpośrednio z terminala (bez Claude'a):

```bash
bash scripts/notatki/sync.sh              # eksport + PDF, przyrostowo
bash scripts/notatki/sync.sh --pelny      # wszystko od nowa
bash scripts/notatki/sync.sh --preflight  # diagnostyka środowiska
```

---

## Automat (launchd)

```bash
bash scripts/notatki/install_launchd.sh 30    # co 30 minut
bash scripts/notatki/install_launchd.sh --status
bash scripts/notatki/install_launchd.sh --usun
```

launchd zamiast crona: przeżywa restart, dogania harmonogram po uśpieniu Maca i
nie wymaga otwartego terminala. Log: `$NOTATKI_ROOT/_stan/auto.log`.

Automat **zawsze** robi eksport i PDF-y. Sortowanie uruchamia tylko przy
`NOTATKI_AUTO_ORGANIZE=true` w `.env` — bo to znaczy odpalanie Claude Code
(`--dangerously-skip-permissions`) bez człowieka przy klawiaturze. Domyślnie
`false`: PDF-y czekają w `00-inbox`, a Ty sortujesz komendą `/notatki` wtedy,
kiedy chcesz.

---

## Co system robi, a czego nie zrobi

**Robi:** czyta notatki, generuje PDF-y, przenosi je między katalogami, nadaje
nazwy, buduje `INDEX.md`, wykrywa duplikaty i sieroty.

**Nie zrobi — i to jest zamierzone:**
- **niczego nie kasuje** — duplikaty tylko raportuje, decyzja jest Twoja,
- **nie modyfikuje notatek w iCloud** — źródło jest tylko do odczytu, Twój
  telefon i Notes.app zostają nietknięte,
- **nie wychodzi poza `NOTATKI_ROOT`** przy przenoszeniu plików,
- **nie obchodzi uprawnień systemowych** — brak zgody trafia do
  `HUMAN_ACTION_REQUIRED.md` jako zadanie dla Ciebie,
- **nie otwiera notatek zablokowanych hasłem.**

---

## Konwersja HTML→PDF — dlaczego tak

`html2pdf.js` używa AppKit przez JXA: `NSAttributedString` parsuje HTML silnikiem
WebKit, `NSTextView` układa tekst, a `NSPrintOperation` z dyspozycją
`NSPrintSaveJob` renderuje wielostronicowy PDF bez otwierania okna drukowania.
Wszystko to jest w systemie od zawsze — nie ma nic do zainstalowania.

Gdyby ta ścieżka zawiodła, `sync.sh` próbuje po kolei: `wkhtmltopdf` → headless
Chrome → `pandoc`, jeśli akurat są na maszynie. Notatki, których nie udało się
skonwertować, **nie zapisują hasha** — przy następnym przebiegu system spróbuje
je zrobić ponownie, zamiast uznać za załatwione.

---

## Rozwiązywanie problemów

| Objaw | Przyczyna i naprawa |
|---|---|
| `FAIL Notes.app niedostępne` | Brak zgody Automatyzacji. Ustawienia systemowe → Prywatność i ochrona → Automatyzacja → Terminal → Notatki. |
| `FAIL system=Linux` | Uruchamiasz w kontenerze/sesji zdalnej. Ten system działa tylko lokalnie na Macu. |
| Pusty eksport mimo notatek | Zły `NOTATKI_ACCOUNT`. Sprawdź: `osascript -e 'tell application "Notes" to get name of every account'`. Zostaw puste = wszystkie konta. |
| `launchctl load` odrzuca automat | Terminal potrzebuje Pełnego dostępu do dysku. |
| Claude nie widzi folderu | Uruchom `setup.sh` (tworzy dowiązanie `./notatki`) albo dodaj katalog przez `/add-dir`. |
| PDF-y powstają, ale nikt ich nie sortuje | `NOTATKI_AUTO_ORGANIZE=false` — tak działa domyślnie. Odpal `/notatki --tylko-organizuj`. |
| Notatka wróciła do złej kategorii | Nie wróci: notatki znane z `_stan/organizacja.json` zachowują kategorię, którą im nadałeś ręcznie. |

---

## Pliki systemu

```
.claude/commands/notatki.md          orkiestrator komendy /notatki
.claude/agents/notes-organizer.md    krok 3 — sortowanie i nazewnictwo
.claude/agents/notes-librarian.md    krok 4 — INDEX.md, katalog.json, problemy
scripts/notatki/setup.sh             jednorazowa konfiguracja
scripts/notatki/sync.sh              eksport + PDF + stan przyrostowy
scripts/notatki/export_icloud_notes.applescript   Notes.app → HTML + manifest
scripts/notatki/html2pdf.js          HTML → PDF na czystym AppKit
scripts/notatki/auto.sh              wejście dla automatu
scripts/notatki/install_launchd.sh   instalator/deinstalator automatu
scripts/notatki/env.notatki.example  fragment konfiguracji do .env
```
