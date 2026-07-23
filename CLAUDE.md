# CLAUDE.md — pamięć projektu

To repo zawiera TRZY byty:
1. **InvoiceGuard** — istniejący SaaS (Next.js 15 + React 19 + TypeScript + Prisma + Postgres). Audyt faktur B2B / odzysk kosztów.
2. **autobiznes** — autonomiczny system biznesowy zbudowany w `.claude/`, uruchamiany komendą `/autobiznes`.
3. **autoodpowiedzi** — asystent automatycznego reagowania na e-mail/WhatsApp zbudowany w `.claude/`, uruchamiany komendą `/autoodpowiedzi`.

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
- **RAPORT KOŃCOWY (zawsze)**: na koniec KAŻDEGO runu autobiznes wypisz użytkownikowi w czacie pełny raport: produkt+status, WSZYSTKIE linki do stron (produkcyjny URL + tymczasowy link podglądu, jeśli deployment za ochroną 403), tabela kroków 1→7, pełne ścieżki wszystkich utworzonych plików (`run/<TS>/...`), lista „Wymaga Ciebie" z `HUMAN_ACTION_REQUIRED.md` oraz ścieżka do `SUMMARY.md`. Szczegóły w sekcji „RAPORT KOŃCOWY" w `.claude/commands/autobiznes.md`.

### Jak dodać nowego subagenta
Nowy `.claude/agents/<nazwa>.md` (frontmatter: `name`, `description`, `model: claude-sonnet-5`, `tools`) + wpięcie w tabelę kroków w `.claude/commands/autobiznes.md`. Szczegóły w `README.autobiznes.md`.

---

## autoodpowiedzi — jak to działa

Asystent (NIE autopilot) reagowania na przychodzące e-maile i WhatsApp.
Priorytet: nigdy nie wysłać czegoś niewłaściwego w imieniu użytkownika —
auto-send tylko dla wąskiej, ręcznie zatwierdzonej białej listy; wszystko
inne to gotowy draft do akceptacji.

### Uruchomienie
- `/autoodpowiedzi` — pełny przebieg (email + WhatsApp).
- `/autoodpowiedzi email` / `/autoodpowiedzi whatsapp` — jeden kanał.

### Architektura
- **Orkiestrator**: `.claude/commands/autoodpowiedzi.md` — wywołuje 6
  subagentów 1→6 sekwencyjnie, leci na najsilniejszym dostępnym modelu
  (klasyfikacja to krok, gdzie błąd kosztuje najwięcej).
- **6 subagentów** w `.claude/agents/*.md`, izolowane, komunikacja tylko
  przez pliki w `./run/<ISO-timestamp>/`: `email-watcher` →
  `whatsapp-watcher` → `classifier` (bramka bezpieczeństwa) →
  `draft-responder` → `auto-sender` → `escalation-notifier`.
- **Biała lista**: `whitelist.json` (root, **nie** gitignorowany) — startuje
  pusta, edytowana WYŁĄCZNIE ręcznie przez użytkownika.
- **Trwała historia**: `message_log.json` (root, gitignorowany — dane
  prywatne) — append-only, zapobiega podwójnemu przetworzeniu.
- **Human-in-the-loop**: ten sam `HUMAN_ACTION_REQUIRED.md` co autobiznes
  (dopisywany, nie nadpisywany).

### Ograniczenie techniczne (WAŻNE)
Gmail MCP w tej sesji NIE ma narzędzia do wysyłki (tylko `create_draft`/
`update_draft`) — auto-send dla e-maila jest dziś technicznie niemożliwy.
Wszystkie e-maile lądują jako draft; te z whitelisty dostają etykietę
`auto-odpowiedzi/gotowe-do-wyslania`. Realny auto-send działa tylko dla
WhatsApp (Twilio, domyślna integracja A z README.autoodpowiedzi.md), i
tylko dla whitelisty + `sensitivity: low`. Szczegóły w
`.claude/agents/auto-sender.md` i `README.autoodpowiedzi.md`.

### Zasady twarde
- `sensitivity: medium/high` (pieniądze/prawo/zdrowie/relacje/nieznany
  nadawca) zawsze wyklucza auto-send, niezależnie od whitelisty.
- W razie wątpliwości klasyfikator ZAWSZE wybiera draft, nigdy nie zgaduje
  w stronę auto-send.
- Sekrety wyłącznie przez `.env` (patrz `.env.example`): `WHATSAPP_INTEGRATION`,
  `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_WHATSAPP_NUMBER`,
  `WHATSAPP_LOCAL_BRIDGE_URL`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
  (współdzielone z autobiznes).

---

## Stan prac (aktualne decyzje)

- **Framework kompletny**: wszystkie 7 agentów mają pełną logikę, orkiestrator, `settings.json`, `.env.example`, `README.autobiznes.md`. Na branchu `claude/autobiznes-autonomous-system-h1niui` → **PR #12** (draft).
- **Wybrany produkt (human override na idea-3)**: **„Sekwencer"** — cold-email engine dla agencji/freelancerów B2B (generuje spersonalizowane sekwencje z listy firm + eksport do Instantly). Monetyzacja 149–499 zł/mc.
- **Wykonane dla Sekwencera**: krok 3 (`copy.json`) i krok 4 (landing w `run/.../site/`, statyczny HTML+CSS, zwalidowany). Artefakty są lokalne/gitignorowane.
- **Do dokończenia**: krok 5 (deploy Vercel — przerwany), 6 (marketing), 7 (analytics).

## WAŻNE — dostępność w nowej konwersacji
System działa w każdej sesji, w której checkout zawiera `.claude/` (agents + command) i ten `CLAUDE.md`. Obecnie są one na branchu `claude/autobiznes-autonomous-system-h1niui`, **nie na `main`**. Aby `/autobiznes` był dostępny w każdej nowej sesji niezależnie od brancha — **zmerguj PR #12 do `main`** (wymaga decyzji człowieka).
