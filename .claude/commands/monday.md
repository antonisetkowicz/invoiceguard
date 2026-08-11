---
description: Tygodniowy raport „Monday" — ogląda nowe filmy i czyta strony o nowych okazjach biznesowych związanych z AI, wybiera to, co da się zrobić w tym tygodniu, i wysyła raport na maila. Uruchamia 5 subagentów sekwencyjnie (ai-video-scout → monday-mailer).
argument-hint: '[opcjonalnie "do: <adres e-mail>, zakres: <7d|14d>, tematy: <np. agenci AI, automatyzacja SME>, --dry-run"]'
---

# /monday — orkiestrator tygodniowego raportu AI

Jesteś ORKIESTRATOREM. Nie robisz researchu sam — przygotowujesz run,
wywołujesz subagenty 1→5 SEKWENCYJNIE przez tool `Task`/`Agent`
(`subagent_type` = nazwa pliku z `.claude/agents/`), przekazujesz `RUN_DIR`
i pilnujesz kontraktu plikowego.

Argument (opcjonalny): `$ARGUMENTS` — parsuj pola:
- `do:` — adres odbiorcy (domyślnie `MONDAY_REPORT_TO` z `.env`),
- `zakres:` — okno czasowe znalezisk (domyślnie `7d`),
- `tematy:` — zawężenie obszarów (domyślnie: AI + biznes + automatyzacja
  dla SME + nowe modele/API + regulacje),
- `--dry-run` — zatrzymaj po kroku 4 (raport powstaje, **nic nie wychodzi
  na skrzynkę**).

## Krok 0 — inicjalizacja runu
1. `TS` = bieżący timestamp ISO bezpieczny dla ścieżki
   (np. `2026-08-17T05-30-00Z`). `RUN_DIR=./run/<TS>/`.
2. `mkdir -p <RUN_DIR>/monday`.
3. Policz zakres dat: `zakres_do` = dziś, `zakres_od` = dziś − `zakres`
   (domyślnie 7 dni). Zapisz `RUN_DIR/state.json`:
   ```json
   { "run_id": "<TS>", "started_at": "<ISO>", "pipeline": "monday",
     "args": { "do": "<adres|null>", "zakres_od": "<YYYY-MM-DD>",
               "zakres_do": "<YYYY-MM-DD>", "tematy": "<string|null>",
               "dry_run": false } }
   ```
4. `RUN_DIR/log.md` z nagłówkiem `# Log decyzji — monday run <TS>`.
5. Jeśli `monday_seen.json` nie istnieje w root repo — utwórz
   `{"videos":[],"articles":[],"opportunities":[],"runs":[]}`.
6. Zapamiętaj stan `HUMAN_ACTION_REQUIRED.md` (rozmiar/mtime lub brak).

## Kroki 1→5 — sekwencyjne wywołania subagentów

| # | subagent | wejście | produkuje |
|---|---|---|---|
| 1 | `ai-video-scout` | zakres dat, `monday_seen.json` | `videos.json` |
| 2 | `ai-web-scout` | `videos.json`, zakres dat | `articles.json` |
| 3 | `opportunity-analyst` | `videos.json`, `articles.json` | `opportunities.json` |
| 4 | `monday-reporter` | `opportunities.json` + oba źródła | `monday/report.html`, `monday/report.md`, `monday/subject.txt` |
| 5 | `monday-mailer` | `monday/*` | `monday/delivery.json`, aktualizacja `monday_seen.json` |

W promcie każdego kroku przekaż: `RUN_DIR=<ścieżka>`, zakres dat, ewentualne
`tematy` i jednozdaniowe przypomnienie kontraktu I/O.

### Po KAŻDYM kroku
1. Sprawdź, czy artefakt powstał.
   - Krok 1 i 2 padły OBA (brak `videos.json` i `articles.json`) → **STOP**,
     zapisz przyczynę w `log.md`, wyślij raport awaryjny (patrz „Chudy
     tydzień”).
   - Padł tylko jeden ze skautów → **kontynuuj** na tym, co jest, i odnotuj
     degradację w raporcie („w tym tygodniu tylko źródła tekstowe”).
   - Krok 3 nie dał ani jednej okazji → kontynuuj: raport i tak wychodzi,
     z sekcją „chudy tydzień” i samymi znaleziskami.
2. Sprawdź, czy `HUMAN_ACTION_REQUIRED.md` urósł — odnotuj, ale nie
   przerywaj pipeline'u.
3. `retry`: błąd przejściowy (sieć/timeout) → ponów maksymalnie 1×. Błąd
   merytoryczny → nie ponawiaj, zaloguj, idź dalej wg pkt. 1.

### Chudy tydzień (ważne)
Raport wychodzi **co tydzień, także gdy nic się nie wydarzyło**. Pusty
poniedziałek to też informacja. Nigdy nie dopychaj raportu wypełniaczem ani
starymi tematami z `monday_seen.json` tylko po to, żeby był dłuższy.

### --dry-run
Zatrzymaj po kroku 4. Nie wywołuj `monday-mailer`. W raporcie końcowym podaj
ścieżkę do `report.html` do podglądu w przeglądarce.

## Krok końcowy — SUMMARY
`RUN_DIR/SUMMARY.md`: zakres dat, ile filmów/artykułów przejrzano, TOP okazje
z `score`, sposób doręczenia (SMTP/draft/lokalnie), sekcja „Wymaga Ciebie”
z dopisów do `HUMAN_ACTION_REQUIRED.md` (albo „nic”), ścieżki artefaktów.

## RAPORT KOŃCOWY (ZAWSZE — wypisz użytkownikowi w czacie)
1. **Status** — raport wysłany / czeka jako draft / tylko lokalnie.
2. **Temat e-maila** i adres odbiorcy.
3. **TOP okazje** — nazwa + pierwszy krok na ten tydzień (skrót 1 linia).
4. **Statystyki** — ile filmów, ile stron, ile odrzucono i dlaczego (skrót).
5. **Wszystkie utworzone pliki** — pełne ścieżki (`run/<TS>/videos.json`,
   `articles.json`, `opportunities.json`, `monday/report.html`,
   `monday/report.md`, `monday/subject.txt`, `monday/delivery.json`,
   `log.md`, `SUMMARY.md`).
6. **Wymaga Ciebie** — pozycje z `HUMAN_ACTION_REQUIRED.md` albo „nic”.

## Zasady twarde
- **Tylko darmowe narzędzia**: `WebSearch`/`WebFetch` do researchu, SMTP
  Gmaila (hasło aplikacji) albo draft Gmail do doręczenia. Żadnych płatnych
  API danych — jeśli czegoś nie da się sprawdzić za darmo, napisz w raporcie
  „niepotwierdzone” zamiast zgadywać.
- Sekrety wyłącznie z `.env` (`MONDAY_REPORT_TO`, `MONDAY_SMTP_USER`,
  `MONDAY_SMTP_PASS`, opcjonalnie `MONDAY_SMTP_HOST`/`MONDAY_SMTP_PORT`,
  `MONDAY_FROM_NAME`). Nigdy do repo, nigdy do czatu.
- Raport idzie **wyłącznie na adres właściciela**. To nie jest newsletter —
  zero innych odbiorców, zero CC/BCC.
- Subagenty nie komunikują się między sobą — tylko przez pliki w `RUN_DIR`.
- Temat e-maila ZAWSZE zaczyna się od `[Monday]` — po tym rozpoznaje go
  filtr Gmaila i skrypt otwierający na komputerze użytkownika.

## Powiązane
- Harmonogram (wysyłka co tydzień + otwieranie maila w poniedziałek 7:00):
  `README.monday.md` i `scripts/monday/`.
