---
description: Autonomiczny pipeline biznesowy — tworzy, buduje, wdraża i marketinguje nowy mikro-produkt cyfrowy. Uruchamia 7 subagentów sekwencyjnie (researcher → analytics-tracker).
argument-hint: [opcjonalnie "nisza: <branża/kierunek>"]
---

# /autobiznes — orkiestrator pipeline'u

Jesteś ORKIESTRATOREM. Nie wykonujesz pracy subagentów samodzielnie — Twoim
zadaniem jest przygotować run, wywołać subagenty 1→7 SEKWENCYJNIE przez tool
`Task`/`Agent` (każdy `subagent_type` = nazwa z `.claude/agents/`), przekazać
im ścieżkę `RUN_DIR` i pilnować kontraktu plikowego oraz human-in-the-loop.

Argument użytkownika (opcjonalny): `$ARGUMENTS`
- Pusty → pełny auto-wybór niszy przez researchera.
- `nisza: <branża>` → wymuszony kierunek dla researchera.

## Krok 0 — inicjalizacja runu
1. Ustal `TS` = bieżący timestamp ISO w formie bezpiecznej dla ścieżki
   (np. `2026-07-22T14-30-00Z`). Ustaw `RUN_DIR=./run/<TS>/`.
2. Utwórz `RUN_DIR` (mkdir -p).
3. Zapisz `RUN_DIR/state.json`:
   ```json
   { "run_id": "<TS>", "started_at": "<ISO>", "args": { "nisza": "<z $ARGUMENTS lub null>" }, "steps": {} }
   ```
4. Utwórz pusty `RUN_DIR/log.md` z nagłówkiem `# Log decyzji — run <TS>`.
5. NIE twórz z góry `HUMAN_ACTION_REQUIRED.md` — powstaje tylko gdy agent go
   potrzebuje. Zapamiętaj jego mtime/rozmiar (albo fakt nieistnienia) PRZED
   pierwszym krokiem, by wykrywać dopisy.

## Kroki 1→7 — sekwencyjne wywołania subagentów
Wywołuj po kolei, każdy z osobnym `Task`, przekazując w promcie:
`RUN_DIR=<ścieżka>` oraz krótkie przypomnienie kontraktu I/O. Kolejność i
oczekiwane artefakty:

| # | subagent | wymaga wejścia | produkuje |
|---|---|---|---|
| 1 | researcher | (opcjonalnie nisza) | `ideas.json` |
| 2 | idea-scorer | `ideas.json` | `chosen_idea.json` |
| 3 | copywriter | `chosen_idea.json` | `copy.json` |
| 4 | web-builder | `chosen_idea.json`, `copy.json` | `site/` |
| 5 | deployer | `site/` | `deployment.json` |
| 6 | marketing-specialist | `copy.json`, `deployment.json` | `marketing_report.json` |
| 7 | analytics-tracker | `deployment.json` | `analytics_setup.json` |

### Po KAŻDYM kroku
1. Sprawdź, czy oczekiwany artefakt powstał w `RUN_DIR`.
   - Brak artefaktu krytycznego (kroki 1–2) → **STOP pipeline**, zapisz
     przyczynę w `log.md`, przejdź do SUMMARY.
   - Brak artefaktu w krokach 4–7, ale agent zgłosił blokadę human-in-the-loop
     → **NIE blokuj się**, kontynuuj następny krok (o ile ma czym się karmić),
     odnotuj degradację w `log.md`.
2. Sprawdź, czy `HUMAN_ACTION_REQUIRED.md` urósł/powstał od ostatniego kroku.
   Jeśli tak — zanotuj to, ale **kontynuuj pipeline** (nie przerywaj).
3. `retry`: jeśli krok padł z błędu przejściowego (sieć/timeout), ponów
   maksymalnie 1×. Błąd merytoryczny (agent nie zdołał) → nie ponawiaj,
   zaloguj i zastosuj regułę z pkt. 1.

### Warunki STOP
- Krok 1 nie wyprodukował `ideas.json` z ≥1 pomysłem → STOP.
- Krok 2 zwrócił `status: "blocked"` (wszystko odrzucone przez compliance) →
  STOP przed budową, eskaluj do człowieka, przejdź do SUMMARY.
- Tryb suchego testu (`$ARGUMENTS` zawiera `--dry-run`): zatrzymaj po kroku 2
  i wygeneruj SUMMARY z `ideas.json` + `chosen_idea.json`.

## Krok końcowy — SUMMARY
Wygeneruj `RUN_DIR/SUMMARY.md`:
- Co powstało (pomysł, MVP, artefakty).
- Live URL (z `deployment.json`, jeśli jest).
- Co opublikowano / co czeka na import (marketing).
- **Sekcja „Wymaga Ciebie"** — pełna treść wszystkich dopisów z
  `HUMAN_ACTION_REQUIRED.md` dotyczących tego runu (albo „nic — wszystko
  poszło automatycznie").
- Następne kroki / rekomendacje na kolejny run.

## RAPORT KOŃCOWY (ZAWSZE — wypisz użytkownikowi w czacie)
Na końcu KAŻDEGO runu (niezależnie od wyniku) wypisz użytkownikowi w
odpowiedzi pełny raport zawierający:
1. **Produkt** + status (LIVE / zatrzymany / zablokowany).
2. **Linki do stron** — wszystkie URL-e z `deployment.json`:
   - produkcyjny URL, a jeśli deployment jest za ochroną (403) — także
     tymczasowy link podglądu (`get_access_to_vercel_url`).
3. **Tabela kroków 1→7** — co wyprodukował każdy krok.
4. **Wszystkie utworzone pliki** — pełne ścieżki artefaktów runu
   (`run/<TS>/...`: ideas.json, chosen_idea.json, copy.json, site/,
   deployment.json, marketing/, analytics_setup.json, log.md, SUMMARY.md).
5. **Wymaga Ciebie** — pełna lista pozycji z `HUMAN_ACTION_REQUIRED.md`
   (albo „nic — wszystko automatycznie") + jasna informacja, czy plik jest
   niepusty.
6. **Ścieżka do `SUMMARY.md`** i następne kroki.

Ten raport jest OBOWIĄZKOWY na koniec pracy autobiznes — nie pomijaj go.

## Zasady twarde
- Sekrety tylko z `.env` — nigdy nie wpisuj kluczy do artefaktów runu.
- Nic wymagającego płatności kartą / 2FA / CAPTCHA / podpisu / decyzji
  prawnej — zawsze eskalacja do `HUMAN_ACTION_REQUIRED.md`.
- Subagenty nie komunikują się między sobą — tylko przez pliki w `RUN_DIR`.
