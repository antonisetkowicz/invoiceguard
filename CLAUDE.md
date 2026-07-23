# CLAUDE.md — pamięć projektu

To repo zawiera DWA byty:
1. **InvoiceGuard** — istniejący SaaS (Next.js 15 + React 19 + TypeScript + Prisma + Postgres). Audyt faktur B2B / odzysk kosztów.
2. **autobiznes** — autonomiczny system biznesowy zbudowany w `.claude/`, uruchamiany komendą `/autobiznes`.

---

## autobiznes — jak to działa (czytaj to najpierw)

Pipeline, który autonomicznie **tworzy → buduje → wdraża → marketinguje** nowy mikro-produkt cyfrowy dla polskiego SME. Eskaluje do człowieka tylko akcje wymagające karty/2FA/CAPTCHA/podpisu/decyzji prawnej — przez jeden plik `HUMAN_ACTION_REQUIRED.md`.

### Uruchomienie
- `/autobiznes` — pełny auto-wybór niszy.
- `/autobiznes nisza: <branża>` — wymuszony kierunek.
- `/autobiznes --dry-run` — stop po kroku 2 (researcher → idea-scorer).

### Architektura (wszystko plikowe, dlatego działa w każdej sesji w tym repo)
- **Orkiestrator**: `.claude/commands/autobiznes.md` — wywołuje 7 subagentów 1→7 sekwencyjnie przez tool `Task`, przekazuje `RUN_DIR`, pilnuje stop/retry i human-in-the-loop, generuje `SUMMARY.md`.
- **7 subagentów** w `.claude/agents/*.md` (`model: claude-sonnet-5`, allowlista narzędzi per-rola). Są IZOLOWANE — komunikują się WYŁĄCZNIE przez pliki w `./run/<ISO-timestamp>/`. Kolejność:
  1. `researcher` → `ideas.json` (web research PL SME)
  2. `idea-scorer` → `chosen_idea.json` (ważony scoring + compliance gate)
  3. `copywriter` → `copy.json` (landing PL, cold-email, social, SEO)
  4. `web-builder` → `site/` (landing/MVP, domyślnie statyczny landing)
  5. `deployer` → `deployment.json` (Vercel MCP; zakup domeny = eskalacja)
  6. `marketing-specialist` → `marketing_report.json` (Ayrshare + import Instantly)
  7. `analytics-tracker` → `analytics_setup.json` (baseline dnia 0)
- **Stan runu**: `./run/<ts>/state.json` (każdy agent scala) + `log.md` (log decyzji). Katalog `run/*` jest **gitignorowany** (efemeryczny) — artefakty runów nie trafiają do repo.
- **Human-in-the-loop**: `HUMAN_ACTION_REQUIRED.md` (gitignorowany) powstaje tylko gdy potrzebna akcja człowieka; agent DOPISUJE sekcję, nie nadpisuje. Format: `HUMAN_ACTION_REQUIRED.template.md`.

### Zasady twarde (przestrzegaj zawsze)
- Sekrety WYŁĄCZNIE przez `.env` (patrz `.env.example`): `AYRSHARE_API_KEY`, `INSTANTLY_API_KEY`, `VERCEL_TOKEN`, `WINDSOR_API_KEY`/`SUPERMETRICS_API_KEY`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, `AUTOBIZNES_AUTOSEND`. Nigdy nie hardcoduj.
- Nic wymagającego płatności kartą / 2FA / CAPTCHA / podpisu / decyzji prawnej → eskalacja do `HUMAN_ACTION_REQUIRED.md`, nie rób sam.
- Pierwszy batch cold-email NIE jest wysyłany bez zgody — chyba że `AUTOBIZNES_AUTOSEND=true`.
- Subagenty nie mają dostępu do siebie — tylko przez pliki w `RUN_DIR`.
- Cron (macOS): gotowy wpis w `README.autobiznes.md` (`--dangerously-skip-permissions` + alert Telegram gdy `HUMAN_ACTION_REQUIRED.md` niepusty).

### Jak dodać nowego subagenta
Nowy `.claude/agents/<nazwa>.md` (frontmatter: `name`, `description`, `model: claude-sonnet-5`, `tools`) + wpięcie w tabelę kroków w `.claude/commands/autobiznes.md`. Szczegóły w `README.autobiznes.md`.

---

## Stan prac (aktualne decyzje)

- **Framework kompletny**: wszystkie 7 agentów mają pełną logikę, orkiestrator, `settings.json`, `.env.example`, `README.autobiznes.md`. Na branchu `claude/autobiznes-autonomous-system-h1niui` → **PR #12** (draft).
- **Wybrany produkt (human override na idea-3)**: **„Sekwencer"** — cold-email engine dla agencji/freelancerów B2B (generuje spersonalizowane sekwencje z listy firm + eksport do Instantly). Monetyzacja 149–499 zł/mc.
- **Wykonane dla Sekwencera**: krok 3 (`copy.json`) i krok 4 (landing w `run/.../site/`, statyczny HTML+CSS, zwalidowany). Artefakty są lokalne/gitignorowane.
- **Do dokończenia**: krok 5 (deploy Vercel — przerwany), 6 (marketing), 7 (analytics).

## WAŻNE — dostępność w nowej konwersacji
System działa w każdej sesji, w której checkout zawiera `.claude/` (agents + command) i ten `CLAUDE.md`. Obecnie są one na branchu `claude/autobiznes-autonomous-system-h1niui`, **nie na `main`**. Aby `/autobiznes` był dostępny w każdej nowej sesji niezależnie od brancha — **zmerguj PR #12 do `main`** (wymaga decyzji człowieka).
