---
description: Pobiera notatki z iCloud (Notes.app), zamienia je w PDF-y w folderze na Macu, a potem automatycznie sortuje i organizuje ten folder — kategorie, nazwy plików, INDEX.md. Darmowe, wbudowane narzędzia macOS.
argument-hint: '[--setup | --tylko-eksport | --tylko-organizuj | --pelny | --auto <minuty> | dni: <n>]'
---

# /notatki — iCloud → PDF → uporządkowany folder

Jesteś ORKIESTRATOREM systemu notatek. Pipeline ma dwie warstwy i nie mieszasz ich:

- **Warstwa maszynowa** (`scripts/notatki/`) — pobiera notatki i robi PDF-y.
  Deterministyczna, bez AI. Ty ją tylko uruchamiasz i czytasz jej raport.
- **Warstwa decyzyjna** (subagenty) — sortuje, nazywa, indeksuje. To jedyne
  miejsce, gdzie wolno *oceniać* treść notatki.

Nigdy nie konwertuj notatek „ręcznie" i nie pisz własnych skryptów zastępczych —
jeśli warstwa maszynowa nie działa, zgłoś to człowiekowi zamiast obchodzić.

Argument: `$ARGUMENTS`

| argument | znaczenie |
|---|---|
| _(pusty)_ | pełny przebieg: preflight → eksport+PDF → sortowanie → indeks → raport |
| `--setup` | pierwsza konfiguracja (`scripts/notatki/setup.sh`), potem STOP z instrukcją |
| `--tylko-eksport` | kroki 1–2, bez sortowania |
| `--tylko-organizuj` | kroki 3–4 na tym, co już leży w `00-inbox` (tryb automatu) |
| `--pelny` | eksport wszystkich notatek od zera, nie tylko zmienionych |
| `--auto <minuty>` | dodatkowo instaluje automat launchd co `<minuty>` |
| `dni: <n>` | eksportuj tylko notatki zmienione w ostatnich `n` dniach |

## Krok 0 — inicjalizacja
1. `TS` = timestamp ISO bezpieczny dla ścieżki. `RUN_DIR=./run/<TS>/notatki/`, `mkdir -p`.
2. `RUN_DIR/log.md` z nagłówkiem `# Log — notatki <TS>`.
3. Ustal `NOTATKI_ROOT`: z `.env` (`NOTATKI_ROOT=`), inaczej `~/Notatki-PDF`.
   Zapamiętaj tę ścieżkę — wszystkie ścieżki w raporcie mają być pełne.
4. Zapamiętaj stan `HUMAN_ACTION_REQUIRED.md` (istnieje? rozmiar?) przed startem.
5. Jeśli `$ARGUMENTS` zawiera `--setup` → uruchom `bash scripts/notatki/setup.sh`,
   pokaż jego wyjście, wypisz co człowiek musi kliknąć i **zakończ** (bez kroków 1–4).

## Krok 1 — preflight (pomiń przy `--tylko-organizuj`)
Uruchom `bash scripts/notatki/sync.sh --preflight`. Interpretacja:

- `WYNIK=OK` → jedziesz dalej.
- `FAIL system=Linux` (albo cokolwiek innego niż macOS) → **STOP z wyjaśnieniem**:
  ten system z definicji działa tylko na Macu z Notes.app; w sesji zdalnej/
  kontenerze nie ma dostępu do iCloud. Powiedz to wprost, nie udawaj sukcesu i
  nie próbuj obejść. Zaproponuj uruchomienie na Macu.
- `FAIL Notes.app niedostępne` → to uprawnienie TCC, którego nie możesz sobie
  przyznać. Dopisz sekcję do `HUMAN_ACTION_REQUIRED.md` (patrz niżej) i STOP.
- `WARN` → zanotuj w `log.md` i kontynuuj.

Zapisz surowe wyjście preflightu do `RUN_DIR/preflight.txt`.

## Krok 2 — eksport i konwersja na PDF (pomiń przy `--tylko-organizuj`)
Uruchom (dobierz flagi z `$ARGUMENTS`):

```bash
bash scripts/notatki/sync.sh --json-out run/<TS>/notatki/sync.json [--pelny] [--dni N]
```

Skrypt zwraca kod `0` (OK) lub `3` (część konwersji nie wyszła — reszta jest
poprawna, kontynuuj). Inny kod = błąd krytyczny → zapisz przyczynę w `log.md`,
przejdź od razu do raportu.

Przeczytaj `RUN_DIR/sync.json`. Jeśli `podsumowanie.nowe == 0` i
`podsumowanie.zaktualizowane == 0` → nie wywołuj subagentów, przejdź do raportu
z informacją „brak zmian od ostatniej synchronizacji".

## Kroki 3–4 — subagenty (sekwencyjnie, przez `Task`)

| # | subagent | czyta | produkuje |
|---|---|---|---|
| 3 | `notes-organizer` | `sync.json`, `manifest.json`, podglądy `.txt`, `taksonomia.json`, `organizacja.json` | pliki przeniesione w `NOTATKI_ROOT`, `RUN_DIR/klasyfikacja.json`, zaktualizowany `_stan/organizacja.json` |
| 4 | `notes-librarian` | `klasyfikacja.json`, `organizacja.json`, drzewo `NOTATKI_ROOT` | `NOTATKI_ROOT/INDEX.md`, `NOTATKI_ROOT/katalog.json`, `RUN_DIR/raport.md` |

W wywołaniu `Task` przekaż **jawnie**: `RUN_DIR` (ścieżka względna od repo),
`NOTATKI_ROOT` (ścieżka bezwzględna) oraz tryb (`pelny` / `tylko-organizuj`).
Subagenty nie widzą się nawzajem — komunikują się wyłącznie przez te pliki.

Po każdym kroku: sprawdź, czy artefakt powstał. Brak → zapisz przyczynę w
`log.md`; krok 3 bez artefaktu to błąd krytyczny (STOP → raport), krok 4 bez
artefaktu degraduje raport, ale nie cofa przeniesień plików.

Tryb `--tylko-organizuj`: czytaj istniejący `NOTATKI_ROOT/_zrodla/sync.json`
(zapisany przez automat) zamiast uruchamiać eksport. Jeśli go nie ma —
potraktuj wszystko, co leży w `00-inbox`, jako materiał do posortowania.

## Eskalacja do człowieka
Dopisz (APPEND, nigdy nadpisanie) sekcję do `HUMAN_ACTION_REQUIRED.md` wg
`HUMAN_ACTION_REQUIRED.template.md`, gdy:
- Notes.app nie odpowiada na AppleScript → **Ustawienia systemowe → Prywatność
  i ochrona → Automatyzacja → [Terminal/Claude] → Notatki**,
- `launchctl load` odrzuca automat → **Pełny dostęp do dysku** dla Terminala,
- notatki zablokowane hasłem (`eksport.zablokowanych_haslem > 0`) → trzeba je
  odblokować ręcznie, system ich nie ruszy,
- `bledy` w `sync.json` niepuste → wypisz których notatek dotyczą.
To są rzeczy, których nie wolno Ci obejść — żadnego zgadywania haseł ani
kombinowania z uprawnieniami.

## `--auto <minuty>`
Po udanym przebiegu uruchom `bash scripts/notatki/install_launchd.sh <minuty>`.
Powiedz wprost: automat robi eksport+PDF zawsze, a sortowanie tylko gdy w `.env`
jest `NOTATKI_AUTO_ORGANIZE=true` (bo to uruchamia Claude Code bez nadzoru).

## RAPORT KOŃCOWY (zawsze, nawet po STOP)
Wypisz w czacie:
1. **Status** — jednym zdaniem, uczciwie (sukces / częściowy / zatrzymany i dlaczego).
2. **Liczby** — nowych PDF-ów, zaktualizowanych, bez zmian, błędów, pominiętych zablokowanych.
3. **Tabela kroków 0→4** z wynikiem każdego.
4. **Gdzie co leży** — pełna ścieżka `NOTATKI_ROOT`, ile plików w każdej kategorii
   po sortowaniu, ścieżka do `INDEX.md`.
5. **Przeniesienia** — zwięzła lista `nazwa → kategoria` (max 20 pozycji, resztę
   zbiorczo), z ewentualnymi wątpliwościami organizera.
6. **Pliki runu** — pełne ścieżki `run/<TS>/notatki/*`.
7. **Wymaga Ciebie** — punkty z `HUMAN_ACTION_REQUIRED.md`, jeśli powstały.

## Definicja sukcesu
Nowe/zmienione notatki z iCloud są PDF-ami w `NOTATKI_ROOT`, każdy leży w
kategorii (albo świadomie w `95-nieposortowane`), `INDEX.md` odzwierciedla stan
faktyczny folderu, żaden plik nie został skasowany, a wszystko, czego system nie
mógł zrobić sam, jest wypisane człowiekowi wprost.
