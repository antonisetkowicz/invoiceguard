# /wznow — auto-wznawianie sesji zatrzymanych przez limit + kategoryzacja konwersacji

System, który **co 5 godzin** sprawdza, które sesje Claude Code zatrzymał limit,
**wznawia je automatycznie** po odnowieniu limitu i **kategoryzuje wszystkie
konwersacje wg projektu**.

```
Routine „wznow-cykl-5h" (co 5h)
        │
        ▼
  sesja dyżurna  ──▶  /wznow  ──▶  session-scanner  ──▶  session-resumer
                                        │                      │
                            sessions.json/projects.json    wznowienia + budziki
                                        │                      │
                                        └──────▶ raport + HUMAN_ACTION_REQUIRED.md
```

---

## Co dokładnie robi

1. **Skanuje wszystkie sesje** — lokalne (transkrypty `~/.claude/projects/**/*.jsonl`)
   i zdalne (claude.ai/code, przez MCP `Claude_Code_Remote`).
2. **Wykrywa zatrzymanie przez limit** i rozpoznaje jego typ:
   | typ | źródło | co robi system |
   |---|---|---|
   | `five_hour` | „Claude AI usage limit reached", „5-hour limit reached" | wznawia automatycznie po resecie |
   | `rate` | `rate_limit_error`, `API Error: 429` | wznawia automatycznie po resecie |
   | `weekly` | „weekly limit reached" | **eskaluje do człowieka** |
   | `spend` | „monthly spend limit", „insufficient credits" | **eskaluje do człowieka** |
3. **Ustala moment odnowienia limitu** (`reset_at`): z epocha w komunikacie
   (`...limit reached|1786500000`), z `retry-after`, z ISO, z „resets at 3pm",
   a w ostateczności szacuje +5h od zdarzenia (oznaczone jako
   `reset_at_estimated`).
4. **Wznawia**:
   - sesje **lokalne** → `claude --resume <id> -p "<prompt kontynuacji>"` w ich
     katalogu roboczym,
   - sesje **zdalne** → jednorazowy Routine wbity w konkretną sesję
     (`create_trigger` z `persistent_session_id`).
5. **Ustawia budzik** dla sesji, którym limit jeszcze się nie odnowił —
   jednorazowy Routine na `reset_at + 5 min`, więc sesja rusza minutę po
   odnowieniu limitu, a nie dopiero w kolejnym cyklu.
6. **Kategoryzuje konwersacje wg projektu** — jedna tabela: projekt, liczba
   sesji (lokalne/zdalne), zablokowane limitem, kategorie tematyczne, gałęzie,
   ostatnia aktywność. Sesja lokalna z `~/projekty/invoiceguard` i sesja zdalna
   z repo `antonisetkowicz/invoiceguard` trafiają do **jednego** projektu.
7. **Eskaluje do człowieka** (`HUMAN_ACTION_REQUIRED.md`) to, czego nie ruszy
   sam: limit tygodniowy, limit wydatków, wygasłe logowanie mostka,
   sesje po 3 nieudanych próbach.

---

## Uruchomienie

```bash
/wznow                 # pełny przebieg: skan + wznowienia + raport
/wznow --dry-run       # skan i plan, zero wznowień
/wznow --kategorie     # sam raport kategoryzacji projektów
/wznow --tylko-lokalne # pomiń sesje zdalne
/wznow --tylko-zdalne  # pomiń transkrypty lokalne
```

Bez Claude'a, z samego terminala:

```bash
node scripts/sessions/scan.mjs            # inwentarz + kategoryzacja
node scripts/sessions/resume.mjs          # plan wznowień (dry-run)
node scripts/sessions/resume.mjs --apply  # realne wznowienie sesji lokalnych
node scripts/sessions/selftest.mjs        # test detektorów limitu (31 asercji)
```

---

## Pliki

| plik | rola |
|---|---|
| `.claude/commands/wznow.md` | orkiestrator komendy `/wznow` |
| `.claude/agents/session-scanner.md` | KROK 1 — inwentarz sesji (tylko odczyt) |
| `.claude/agents/session-resumer.md` | KROK 2 — wznowienia, budziki, eskalacje |
| `.claude/wznow.config.json` | **polityka** (bez sekretów, commitowana) |
| `.claude/session-rules.json` | reguły kategoryzacji — edytujesz ręcznie |
| `scripts/sessions/lib.mjs` | parser transkryptów, detektory limitu, grupowanie |
| `scripts/sessions/scan.mjs` | skan → `sessions.json`, `projects.json`, `SESSIONS.md` |
| `scripts/sessions/resume.mjs` | wznawianie sesji lokalnych + rejestr prób |
| `scripts/sessions/selftest.mjs` | testy na syntetycznych transkryptach |
| `.claude/session-state/` | stan runtime (**gitignorowany** — zawiera prompty) |

---

## Bezpieczniki (dlaczego to nie wpadnie w pętlę)

| bezpiecznik | domyślnie | gdzie zmienić |
|---|---|---|
| tylko limity odnawialne same | `five_hour`, `rate` | twarda reguła w kodzie |
| maks. prób na sesję | 3 | `max_attempts` |
| odstęp między próbami | 60 min | `cooldown_min` |
| maks. sesji na cykl | 5 | `max_per_run` |
| sesje porzucone | starsze niż 7 dni pomijane | `max_age_days` |
| katalogi wykluczone | brak | `exclude` |
| limit czasu wznowienia | 30 min | `timeout_min` |
| tryb próbny | `resume.mjs` bez `--apply` nic nie uruchamia | — |

Rejestr prób: `.claude/session-state/resume-log.json` (append-only). Sesja
przerwana przez człowieka **nigdy** nie jest wznawiana — tylko taka, w której
ostatnim zdarzeniem był komunikat o limicie i nie ma po nim żadnej pracy.

---

## Harmonogram co 5h

### Chmura (claude.ai/code) — działa samo

- Routine **`wznow-cykl-5h`** (`0 */5 * * *`, serwer zakotwicza minutę na
  moment utworzenia) budzi **sesję dyżurną** „Dyżur /wznow" (tag
  `wznow-dyzur`), która ma dostęp do MCP `Claude_Code_Remote` i wykonuje cały
  pipeline.
- Dlaczego przez sesję dyżurną, a nie świeżą sesję na każde odpalenie: Routine
  zakładane z poziomu sesji (przez MCP) **nie dostają w tej organizacji
  konektorów MCP** — parametr `connectors` jest zablokowany. Świeża sesja z
  takiego Routine nie zobaczyłaby listy sesji ani nie mogłaby ich obudzić.
  Sesja dyżurna, założona jak zwykła sesja, te konektory ma.
- Jeśli wolisz świeżą sesję na każdy cykl: załóż Routine **ręcznie w panelu
  Routines na claude.ai** — te zakładane przez UI mają zapisane konektory MCP
  (widać to w `list_triggers` jako `mcp_connections`). Prompt do wklejenia
  weź z pola `prompt` istniejącego `wznow-cykl-5h`.
- Podgląd i zmiana: `mcp__Claude_Code_Remote__list_triggers` /
  `update_trigger`. Wyłączenie na chwilę: `update_trigger` z `enabled: false`.
- Gdy sesja dyżurna zostanie zarchiwizowana: odtwórz ją (`create_session` z
  tagiem `wznow-dyzur`, branch z tym systemem) i wskaż nowy
  `persistent_session_id` w Routine.

### Komputer lokalny (macOS) — cron

Sesji lokalnych (`~/.claude/projects`) nie widać z chmury — ten sam system
uruchamiasz u siebie cronem:

```cron
# co 5 godzin: skan + wznowienie sesji zatrzymanych przez limit
0 */5 * * * cd ~/ścieżka/do/invoiceguard && \
  /usr/bin/env node scripts/sessions/scan.mjs >/dev/null 2>&1 && \
  /usr/bin/env node scripts/sessions/resume.mjs --apply >> ~/wznow-cron.log 2>&1
```

W cronie PATH bywa ubogi — ustaw `CLAUDE_BIN=/opt/homebrew/bin/claude` w `.env`,
jeśli `claude` nie startuje.

---

## Kategoryzacja konwersacji

Kategoria bierze się z pierwszego i ostatniego promptu sesji, wg reguł w
`.claude/session-rules.json`. **Wygrywa pierwsza pasująca reguła**, dlatego
wąskie kategorie stoją wyżej niż szeroki `feature` (inaczej „dodaj testy"
wpadłoby do `feature`, nie do `testy`).

Dodanie własnej kategorii:

```json
{
  "kategoria": "księgowość",
  "wzorce": ["ksieg", "księg", "\\bkpir\\b", "jpk"]
}
```

Wstaw ją **przed** `feature`. System nigdy nie dopisuje tu nic sam — jeśli
zobaczy dużo sesji w koszu `inne`, tylko zaproponuje gotowy fragment JSON.

---

## Ograniczenia (uczciwie)

- **Chmura nie widzi sesji lokalnych, a komputer nie widzi zdalnych.** To dwa
  osobne silniki tego samego systemu: cykl w chmurze pilnuje sesji
  claude.ai/code, cron na Macu pilnuje sesji z terminala.
- **Nazwa serwera MCP bywa różna w różnych sesjach** — raz
  `mcp__Claude_Code_Remote__*`, raz `mcp__claude-code-remote__*`. Agenci mają w
  allowliście oba warianty i używają tego, który zastaną; brak obu = obsługa
  tylko sesji lokalnych plus wpis w raporcie.
- **Wykrywanie limitu opiera się na treści komunikatu.** Wzorce są w
  `LIMIT_PATTERNS` w `scripts/sessions/lib.mjs`. Jeśli Anthropic zmieni
  formułkę, dopisz wzorzec — `selftest.mjs` sprawdzi, że nic się nie rozjechało.
- **Gdy komunikat nie podaje czasu resetu**, system zakłada okno 5h i oznacza
  to jako `reset_at_estimated: true`. Przy szacowanym resecie dalszym niż 6h
  budzik nie jest ustawiany — sesja czeka na zwykły cykl.
- **W chmurze rejestr prób nie przeżywa cyklu** (świeży kontener,
  `session-state/` jest gitignorowane). Hamulcem jest tam odstęp 5h między
  cyklami i `max_per_run`, a nie licznik prób.
- **Wznowiona sesja pracuje dalej sama.** Prompt kontynuacji wprost zabrania
  rozszerzania zakresu, ale sesja wznawia się z pełnym kontekstem i może zużyć
  tokeny. Nie włączaj `auto_resume_local`, jeśli tego nie chcesz.
