---
description: Sprawdza, które sesje Claude Code (lokalne i zdalne) zatrzymał limit, wznawia je automatycznie po odnowieniu limitu i kategoryzuje wszystkie konwersacje wg projektu. Uruchamiany ręcznie albo co 5h przez Routine „autoc-cykl-5h”.
argument-hint: '[--dry-run | --tylko-lokalne | --tylko-zdalne | --kategorie]'
---

# /autoc — orkiestrator auto-wznowienia sesji

Jesteś ORKIESTRATOREM. Nie robisz pracy subagentów sam — wywołujesz ich
sekwencyjnie przez tool `Task`/`Agent` i pilnujesz kontraktu plikowego.

`STATE_DIR` = `.claude/session-state/` — stan TRWAŁY (nie `run/<TS>/`, bo
system musi pamiętać próby wznowień między cyklami).

Argument użytkownika: `$ARGUMENTS`
- pusty → pełny przebieg (skan + wznowienia lokalne i zdalne),
- `--dry-run` → skan i plan, zero wznowień,
- `--tylko-lokalne` / `--tylko-zdalne` → zawęź zakres,
- `--kategorie` → sam raport kategoryzacji projektów (bez wznawiania).

## Krok 0 — inicjalizacja
1. `mkdir -p .claude/session-state`.
2. Ustal `TS` = bieżący czas ISO.
3. Zapamiętaj stan `HUMAN_ACTION_REQUIRED.md` (istnieje? rozmiar?) sprzed runu.
4. Odczytaj politykę z `.claude/autoc.config.json`. Tryb = `dry-run`, jeśli
   podano `--dry-run`; inaczej `apply`.

## Kroki 1→2 — subagenci

| # | subagent | wejście | produkuje | pomiń gdy |
|---|---|---|---|---|
| 1 | `session-scanner` | `~/.claude/projects/`, MCP `list_sessions` | `sessions.json`, `projects.json`, `SESSIONS.md`, `remote-sessions.json` | nigdy |
| 2 | `session-resumer` | `sessions.json`, `autoc.config.json` | `resume-actions.json`, `resume-report.json`, wpisy w `resume-log.json` | `--dry-run` (uruchom go w trybie dry-run) lub `--kategorie` (pomiń całkiem) |

Przekaż każdemu subagentowi: `STATE_DIR`, tryb (`apply`/`dry-run`) i zakres
(`lokalne`/`zdalne`/`oba`).

### Po każdym kroku
- Sprawdź, czy artefakt powstał. Brak `sessions.json` → błąd krytyczny, STOP i
  raport z przyczyną (bez `sessions.json` krok 2 wznawiałby w ciemno).
- Błąd przejściowy (sieć/MCP timeout) → ponów maksymalnie 1×.
- Jeśli `HUMAN_ACTION_REQUIRED.md` urósł — zanotuj, ale kontynuuj.

## Krok 3 — kategoryzacja konwersacji wg projektu

Wczytaj `STATE_DIR/projects.json` i przygotuj do raportu tabelę:

| Projekt | Sesje | Zablokowane limitem | Główne kategorie | Gałęzie | Ostatnia aktywność |

Kategorie tematyczne biorą się z `.claude/session-rules.json` (plik
użytkownika, edytowalny ręcznie — kolejność reguł ma znaczenie, wygrywa
pierwsza pasująca). Jeśli plik nie istnieje, działają reguły domyślne z
`scripts/autoc/lib.mjs`.

Jeśli któryś projekt ma > 30% sesji w kategorii `inne`/`nieokreślona` —
zaproponuj użytkownikowi konkretną nową regułę do `session-rules.json`
(pokaż gotowy fragment JSON), ale **nie dopisuj jej sam**.

## Krok 4 — powiadomienie (opcjonalne, darmowe)

Jeśli w `.env` są `TELEGRAM_BOT_TOKEN` i `TELEGRAM_CHAT_ID` **i** w tym cyklu
coś naprawdę się wydarzyło (wznowiono sesję albo pojawiła się nowa eskalacja),
wyślij jedno zwięzłe powiadomienie:

```bash
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d chat_id="$TELEGRAM_CHAT_ID" --data-urlencode text="/autoc: wznowiono N sesji, M czeka na reset, K wymaga Ciebie"
```

Cisza, gdy nic się nie zmieniło — cykl co 5h nie ma prawa spamować.

## Krok 5 — RAPORT KOŃCOWY (zawsze)

Wypisz użytkownikowi w czacie, po polsku:

1. **Jedno zdanie podsumowania** — ile sesji przeskanowano, ile wznowiono.
2. **Tabela projektów** z kroku 3 (kategoryzacja konwersacji).
3. **Wznowione teraz** — ID sesji, projekt, kategoria, lokalna/zdalna, numer
   próby.
4. **Czekają na odnowienie limitu** — ID, projekt, dokładny `reset_at` i czy
   jest odczytany, czy szacowany; przy sesjach zdalnych zaznacz, że budzik
   jednorazowy został ustawiony (albo dlaczego nie).
5. **Wymaga Ciebie** — pełna treść tego, co dopisano do
   `HUMAN_ACTION_REQUIRED.md` w tym runie (limit wydatków, limit tygodniowy,
   wygasłe logowanie, sesje po 3 nieudanych próbach). Jeśli nic — napisz to
   wprost.
6. **Ścieżki plików**: `.claude/session-state/SESSIONS.md`, `sessions.json`,
   `projects.json`, `resume-actions.json`, `resume-log.json`.
7. **Następny cykl**: kiedy wypada najbliższe uruchomienie Routine
   `autoc-cykl-5h` (co 5h) — sprawdź `next_run_at` przez `list_triggers`
   (narzędzie bywa nazwane `mcp__Claude_Code_Remote__list_triggers` albo
   `mcp__claude-code-remote__list_triggers`). Jeśli tego Routine NIE MA,
   powiedz o tym wyraźnie i podaj gotowe wywołanie `create_trigger` z
   `cron_expression: "0 */5 * * *"` i `create_new_session_on_fire: true`.

## Zasady twarde
- Wznawiamy WYŁĄCZNIE sesje zatrzymane przez limit, który odnawia się sam
  (`five_hour`, `rate`). Limit tygodniowy i limit wydatków → eskalacja.
- Sesja przerwana przez człowieka (Esc, zamknięcie) NIE jest wznawiana.
- Maksymalnie `max_attempts` prób na sesję i `max_per_run` sesji na cykl —
  reszta czeka. Nigdy nie obchodź rejestru `resume-log.json`.
- Sekrety tylko z `.env`; polityka z `.claude/autoc.config.json`.
- Nigdy nie kasuj cudzych Routine — tylko własne `autoc-resume-*` /
  `autoc-wake-*`, i nigdy `autoc-cykl-5h`.
- Ten pipeline nie zmienia kodu w repo użytkownika. Jedyne pliki, które
  zapisuje, to `.claude/session-state/*` i (gdy trzeba)
  `HUMAN_ACTION_REQUIRED.md`.
