# autobiznes — autonomiczny system biznesowy

Pipeline uruchamiany komendą `/autobiznes`, który autonomicznie **tworzy →
buduje → wdraża → marketinguje** nowy mikro-produkt cyfrowy dla polskiego
SME. Wszystko, co wymaga człowieka (płatność kartą, logowanie 2FA/CAPTCHA,
podpis, decyzja prawna), jest eskalowane do jednego pliku
`HUMAN_ACTION_REQUIRED.md` — reszta dzieje się bez Twojego udziału.

## Architektura

```
.claude/
├── commands/autobiznes.md      # ORKIESTRATOR — wywołuje 7 subagentów 1→7
├── agents/                     # workerzy (model: claude-sonnet-5)
│   ├── researcher.md           # 1 → ideas.json
│   ├── idea-scorer.md          # 2 → chosen_idea.json
│   ├── copywriter.md           # 3 → copy.json
│   ├── web-builder.md          # 4 → site/
│   ├── deployer.md             # 5 → deployment.json
│   ├── marketing-specialist.md # 6 → marketing_report.json
│   └── analytics-tracker.md    # 7 → analytics_setup.json
└── settings.json               # globalne uprawnienia (tryb nieinteraktywny)

run/<ISO-timestamp>/            # persystencja stanu jednego runu
├── state.json                  # stan współdzielony (każdy agent scala)
├── log.md                      # log decyzji (co, dlaczego, źródła)
├── ideas.json … analytics_setup.json
├── site/                       # zbudowany artefakt do deployu
└── SUMMARY.md                  # podsumowanie runu

HUMAN_ACTION_REQUIRED.md        # powstaje TYLKO gdy potrzebna Twoja akcja
```

- **Orkiestrator** (slash command) leci na najsilniejszym dostępnym modelu
  (klasa Opus/Fable jeśli dostępna, inaczej Sonnet).
- **Subagenty** są izolowane — NIE mają dostępu do siebie nawzajem.
  Komunikują się wyłącznie przez pliki w `./run/<timestamp>/`.
- **Uprawnienia per-agent** deklarowane w YAML frontmatter (`tools:`).
  Np. `web-builder` nie ma dostępu do wysyłki maili, `deployer` tylko do
  narzędzi Vercel MCP.

## Wymagania wstępne

1. Skopiuj `.env.example` → `.env` i uzupełnij klucze (patrz sekcja poniżej).
   Sekrety NIGDY nie są hardcodowane — tylko przez `.env`.
2. Connectory MCP: Vercel (deploy). Opcjonalnie Ayrshare/Instantly/Windsor
   przez klucze w `.env`.

### Zmienne środowiskowe (.env)
| Zmienna | Do czego | Wymagane |
|---|---|---|
| `AYRSHARE_API_KEY` | publikacja social (marketing) | opcjonalne |
| `INSTANTLY_API_KEY` | import cold-email | opcjonalne |
| `VERCEL_TOKEN` / `VERCEL_TEAM_ID` | deploy przez CLI (gdy nie MCP) | opcjonalne |
| `WINDSOR_API_KEY` / `SUPERMETRICS_API_KEY` | pull analytics | opcjonalne |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | alert po runie (cron) | opcjonalne |
| `AUTOBIZNES_AUTOSEND` | `true` = auto-wysyłka 1. batcha cold-email | domyślnie `false` |

## Uruchomienie ręczne

```
# pełny auto-wybór niszy:
/autobiznes

# wymuszony kierunek:
/autobiznes nisza: automatyzacja dla gabinetów stomatologicznych

# suchy test (stop po researcher → idea-scorer):
/autobiznes --dry-run
```

Po runie zajrzyj do `run/<timestamp>/SUMMARY.md` oraz — jeśli istnieje —
do `HUMAN_ACTION_REQUIRED.md`.

## Cron (macOS)

Wpis do `crontab -e` (NIE jest wykonywany automatycznie — dodaj sam).
Uruchamia pipeline nieinteraktywnie raz dziennie o 08:00 i alarmuje na
Telegram, gdy po runie `HUMAN_ACTION_REQUIRED.md` jest niepusty.

```bash
# ── autobiznes: codziennie 08:00 ──────────────────────────────────────
0 8 * * * cd /Users/TWOJ_USER/invoiceguard && \
  /usr/bin/env -S bash -lc '\
    source .env 2>/dev/null; \
    TS=$(date +\%Y-\%m-\%dT\%H-\%M-\%SZ); \
    LOG="run/cron-$TS.log"; \
    claude -p "/autobiznes" --dangerously-skip-permissions >"$LOG" 2>&1; \
    if [ -s HUMAN_ACTION_REQUIRED.md ]; then \
      curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
        --data-urlencode chat_id="$TELEGRAM_CHAT_ID" \
        --data-urlencode text="autobiznes: run $TS wymaga Twojej akcji — sprawdź HUMAN_ACTION_REQUIRED.md"; \
    fi'

# raz w tygodniu (poniedziałek 08:00) zamiast codziennie:
# 0 8 * * 1 cd /Users/TWOJ_USER/invoiceguard && ... (jak wyżej)
```

> Podmień `TWOJ_USER` i ścieżkę. Flaga `--dangerously-skip-permissions` jest
> potrzebna, by cron szedł bez pytań — używaj tylko w zaufanym środowisku.

## Human-in-the-loop

`HUMAN_ACTION_REQUIRED.md` powstaje tylko wtedy, gdy jakiś krok wymaga
Ciebie. Każdy agent **dopisuje** sekcję (patrz `HUMAN_ACTION_REQUIRED.template.md`),
nigdy nie nadpisuje. Pusty/nieistniejący plik po runie = pełna automatyzacja.

Rzeczy, których pipeline NIGDY nie robi sam:
- zakup domeny / płatność kartą,
- logowanie z 2FA / CAPTCHA,
- podpisy, decyzje prawne,
- pierwszy batch cold-email (chyba że `AUTOBIZNES_AUTOSEND=true`).

## Jak dodać nowego subagenta

1. Utwórz `.claude/agents/<nazwa>.md` z frontmatter:
   ```yaml
   ---
   name: <nazwa>
   description: <kiedy używać — 1 zdanie>
   model: claude-sonnet-5
   tools: Read, Write, ...   # tylko narzędzia potrzebne tej roli
   ---
   ```
2. Opisz rolę: kontrakt I/O (czyta/pisze pliki w `RUN_DIR`), procedurę,
   schema wyjścia, reguły human-in-the-loop, definicję sukcesu.
3. Wpnij go w kolejność w `.claude/commands/autobiznes.md` (tabela kroków +
   opis oczekiwanego artefaktu i warunków stop/retry).
4. Pamiętaj o izolacji: agent komunikuje się TYLKO przez pliki w `RUN_DIR`.

## Status budowy

- [x] Szkielet 7 agentów (frontmatter + rola)
- [x] Orkiestrator `autobiznes.md` (pełna logika)
- [x] `settings.json`, `.env.example`, README, wpis crona
- [x] Pełna logika: `researcher`, `idea-scorer`
- [ ] Pełna logika: `copywriter`, `web-builder`, `deployer`,
      `marketing-specialist`, `analytics-tracker` (po akceptacji suchego testu)
