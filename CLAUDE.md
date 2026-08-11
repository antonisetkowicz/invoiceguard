# CLAUDE.md — pamięć projektu

To repo zawiera CZTERY byty:
1. **InvoiceGuard** — istniejący SaaS (Next.js 15 + React 19 + TypeScript + Prisma + Postgres). Audyt faktur B2B / odzysk kosztów.
2. **autobiznes** — autonomiczny system biznesowy zbudowany w `.claude/`, uruchamiany komendą `/autobiznes`.
3. **autoodpowiedzi** — asystent automatycznego reagowania na e-mail/WhatsApp zbudowany w `.claude/`, uruchamiany komendą `/autoodpowiedzi`.
4. **wznow** — auto-wznawianie sesji Claude Code zatrzymanych przez limit + kategoryzacja konwersacji wg projektu, uruchamiane komendą `/wznow` i cyklem co 5h.

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
  6. `marketing-specialist` → `marketing_report.json` (DARMOWY silnik pozyskiwania klientów: WebSearch realnych firm ICP → publiczne adresy z ich stron → spersonalizowane cold-maile jako DRAFTY w Gmailu, człowiek wysyła; social jako pliki + Buffer Free. Bez płatnych: Ayrshare/Instantly opcjonalne. Szczegóły „System pozyskiwania klientów" w `.claude/agents/marketing-specialist.md`)
  7. `analytics-tracker` → `analytics_setup.json` (baseline dnia 0)
- **Stan runu**: `./run/<ts>/state.json` (każdy agent scala) + `log.md` (log decyzji). Katalog `run/*` jest **gitignorowany** (efemeryczny) — artefakty runów nie trafiają do repo.
- **Human-in-the-loop**: `HUMAN_ACTION_REQUIRED.md` (gitignorowany) powstaje tylko gdy potrzebna akcja człowieka; agent DOPISUJE sekcję, nie nadpisuje. Format: `HUMAN_ACTION_REQUIRED.template.md`.

### Zasady twarde (przestrzegaj zawsze)
- **TYLKO DARMOWE NARZĘDZIA (domyślnie)**: każdy krok pipeline'u musi być wykonalny za darmo. Płatne usługi (Ayrshare, Instantly, Windsor, Supermetrics, płatne konektory, zakup domeny) są WYŁĄCZNIE opcjonalnym upgradem — nigdy nie mogą być warunkiem powodzenia kroku. Domyślny stack: WebSearch/WebFetch (research), Vercel Hobby (deploy `*.vercel.app`), Formspree Free / Google Forms (leady), posty jako pliki + Buffer Free (social), sekwencja+CSV / darmowe drafty Gmail (cold-email), Vercel Web Analytics free / Neon-Supabase free Postgres / plik (analytics), Telegram Bot (alerty). Jeśli czegoś nie da się zrobić za darmo automatycznie — zostaw gotowe pliki i opisz krótką darmową akcję ręczną w `HUMAN_ACTION_REQUIRED.md`.
- Sekrety WYŁĄCZNIE przez `.env` (patrz `.env.example`). Płatne klucze (`AYRSHARE_API_KEY`, `INSTANTLY_API_KEY`, `WINDSOR_API_KEY`/`SUPERMETRICS_API_KEY`) opcjonalne; darmowe: `LEAD_FORM_ENDPOINT` (Formspree), `DATABASE_URL` (Neon/Supabase free), `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, `AUTOBIZNES_AUTOSEND`. Nigdy nie hardcoduj.
- Nic wymagającego płatności kartą / 2FA / CAPTCHA / podpisu / decyzji prawnej → eskalacja do `HUMAN_ACTION_REQUIRED.md`, nie rób sam.
- Pierwszy batch cold-email NIE jest wysyłany bez zgody — chyba że `AUTOBIZNES_AUTOSEND=true`.
- Subagenty nie mają dostępu do siebie — tylko przez pliki w `RUN_DIR`.
- Cron (macOS): gotowy wpis w `README.autobiznes.md` (`--dangerously-skip-permissions` + alert Telegram gdy `HUMAN_ACTION_REQUIRED.md` niepusty).
- **RAPORT KOŃCOWY (zawsze)**: na koniec KAŻDEGO runu autobiznes wypisz użytkownikowi w czacie pełny raport: produkt+status, WSZYSTKIE linki do stron (produkcyjny URL + tymczasowy link podglądu, jeśli deployment za ochroną 403), tabela kroków 1→7, pełne ścieżki wszystkich utworzonych plików (`run/<TS>/...`), lista „Wymaga Ciebie" z `HUMAN_ACTION_REQUIRED.md` oraz ścieżka do `SUMMARY.md`. Szczegóły w sekcji „RAPORT KOŃCOWY" w `.claude/commands/autobiznes.md`.

### Jak dodać nowego subagenta
Nowy `.claude/agents/<nazwa>.md` (frontmatter: `name`, `description`, `model: claude-sonnet-5`, `tools`) + wpięcie w tabelę kroków w `.claude/commands/autobiznes.md`. Szczegóły w `README.autobiznes.md`.

### Komenda /coldmail (samodzielny silnik pozyskiwania klientów)
`.claude/commands/coldmail.md` — `/coldmail branża: <...>, miasto: <...>, liczba: <n>`. Namierza realne firmy (Google Maps + Panorama Firm + strony), wyciąga TYLKO publiczne adresy e-mail (bez zgadywania, bez płatnej weryfikacji SMTP), pisze spersonalizowany mail 1:1 pod każdą i tworzy WERSJE ROBOCZE w Gmailu pod konkretny adres. NIGDY nie wysyła — człowiek wysyła ręcznie. Darmowe narzędzia, RODO/opt-out, uczciwe zastrzeżenia w raporcie.

### Komenda /wyslij (auto-wysyłka — ŚWIADOME RYZYKO) ⚠️
`.claude/commands/wyslij.md` — `/wyslij leady: <CSV>, temat: <...>`. W odróżnieniu od `/coldmail`, ta komenda **faktycznie wysyła** e-maile (nie tylko drafty), przez **MailerLite** (jedyny darmowy konektor z realną wysyłką — Gmail w tej sesji nie ma narzędzia do wysyłki). **Ryzyko zaakceptowane przez właściciela**: MailerLite jest ESP dla list opt-in i zabrania w regulaminie wysyłki do niezasubskrybowanych kontaktów B2B (jak leady z `/coldmail`) — użycie w ten sposób łamie ToS dostawcy i grozi zawieszeniem konta. Cold B2B e-mail z opt-outem jest legalny (RODO/uzasadniony interes); ryzykiem NIE jest prawo, tylko regulamin platformy. Rzeczywista wysyłka wykonuje się TYLKO gdy `AUTOBIZNES_AUTOSEND=true` w `.env` — bez tego komenda tworzy kampanię jako draft w MailerLite i eskaluje do `HUMAN_ACTION_REQUIRED.md`. **Nie jest wpięta w krok 6 `/autobiznes`** — tam zostaje bezpieczna ścieżka (drafty Gmail); `/wyslij` odpala się świadomie, osobno.

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

## wznow — jak to działa

System, który **co 5 godzin** sprawdza, które sesje Claude Code zatrzymał limit,
**wznawia je po odnowieniu limitu** i **kategoryzuje konwersacje wg projektu**.
Pełna dokumentacja: `README.wznow.md`.

### Uruchomienie
- `/wznow` — pełny przebieg (skan + wznowienia + raport).
- `/wznow --dry-run` — plan bez wznawiania. `/wznow --kategorie` — sam raport projektów.
- Bez Claude'a: `node scripts/sessions/scan.mjs`, `node scripts/sessions/resume.mjs --apply`,
  `node scripts/sessions/selftest.mjs` (testy detektorów limitu).

### Architektura
- **Orkiestrator**: `.claude/commands/wznow.md` → 2 subagenty: `session-scanner`
  (inwentarz sesji lokalnych + zdalnych, tylko odczyt) → `session-resumer`
  (wznowienia, budziki, eskalacje).
- **Silnik**: `scripts/sessions/` — `lib.mjs` (parser transkryptów
  `~/.claude/projects/**/*.jsonl`, detektory limitu, grupowanie wg projektu),
  `scan.mjs`, `resume.mjs`, `selftest.mjs`. Czysty Node, zero zależności.
- **Polityka**: `.claude/wznow.config.json` (commitowany, bez sekretów) —
  `auto_resume_local`, `auto_resume_remote`, `max_attempts`, `cooldown_min`,
  `max_age_days`, `max_per_run`, `exclude`, `resume_prompt`. Zmienne
  `AUTORESUME_*` z `.env` nadpisują te wartości.
- **Reguły kategoryzacji**: `.claude/session-rules.json` — edytowane WYŁĄCZNIE
  ręcznie; wygrywa pierwsza pasująca reguła (wąskie kategorie wyżej niż `feature`).
- **Stan**: `.claude/session-state/` (gitignorowany — zawiera fragmenty promptów):
  `sessions.json`, `projects.json`, `SESSIONS.md`, `resume-report.json`,
  `resume-log.json` (append-only rejestr prób).

### Instalacja globalna (dostępność w KAŻDEJ konwersacji)
`node scripts/sessions/install-global.mjs` (jednorazowo, na komputerze użytkownika):
kopiuje komendę do `~/.claude/commands/wznow.md`, subagentów do `~/.claude/agents/`,
silnik do `~/.claude/wznow/` (z przepisaniem ścieżek na globalne), zakłada
harmonogram co 5h (launchd `com.wznow.cykl5h` na macOS, cron na Linuksie) i
zostawia stan w `~/.claude/session-state/`. Konfiguracji użytkownika NIGDY nie
nadpisuje. Deinstalacja: `node ~/.claude/wznow/install-global.mjs --uninstall`.
Skrypty same wykrywają kontekst (repo vs `~/.claude/`), można wymusić `WZNOW_HOME`.

### Harmonogram
- **Chmura**: Routine `wznow-cykl-5h` (`0 */5 * * *`) budzi **sesję dyżurną**
  („Dyżur /wznow", tag `wznow-dyzur`), która ma konektory MCP i robi cały
  pipeline. Świeża sesja per odpalenie NIE zadziała — Routine w tej organizacji
  nie dostają konektorów MCP, więc nie zobaczyłyby listy sesji.
- **Lokalnie (macOS)**: cron co 5h na `scan.mjs` + `resume.mjs --apply` — wpis
  gotowy w `README.wznow.md`. Chmura nie widzi sesji lokalnych i odwrotnie.

### Zasady twarde
- Wznawiamy TYLKO limity odnawialne same z siebie (`five_hour`, `rate`). Limit
  tygodniowy, limit wydatków i `worker_auth_expired` → `HUMAN_ACTION_REQUIRED.md`.
- Sesja przerwana przez człowieka NIGDY nie jest wznawiana — tylko taka, gdzie
  ostatnim zdarzeniem był komunikat o limicie i nie ma po nim żadnej pracy.
- Bezpieczniki przed pętlą: `max_attempts` 3, `cooldown_min` 60, `max_per_run` 5,
  `max_age_days` 7. `resume.mjs` bez `--apply` niczego nie uruchamia.
- Prompt wznawiający pochodzi z configu i zabrania rozszerzania zakresu prac.
- Nie kasujemy cudzych Routine — tylko własne `wznow-resume-*` / `wznow-wake-*`,
  nigdy `wznow-cykl-5h`.

---

## Stan prac (aktualne decyzje)

- **Framework kompletny**: wszystkie 7 agentów mają pełną logikę, orkiestrator, `settings.json`, `.env.example`, `README.autobiznes.md`. Na branchu `claude/autobiznes-autonomous-system-h1niui` → **PR #12** (draft).
- **Wybrany produkt (human override na idea-3)**: **„Sekwencer"** — cold-email engine dla agencji/freelancerów B2B (generuje spersonalizowane sekwencje z listy firm + eksport do Instantly). Monetyzacja 149–499 zł/mc.
- **Wykonane dla Sekwencera**: krok 3 (`copy.json`) i krok 4 (landing w `run/.../site/`, statyczny HTML+CSS, zwalidowany). Artefakty są lokalne/gitignorowane.
- **Do dokończenia**: krok 5 (deploy Vercel — przerwany), 6 (marketing), 7 (analytics).

## WAŻNE — dostępność w nowej konwersacji
System działa w każdej sesji, w której checkout zawiera `.claude/` (agents + command) i ten `CLAUDE.md`. Obecnie są one na branchu `claude/autobiznes-autonomous-system-h1niui`, **nie na `main`**. Aby `/autobiznes` był dostępny w każdej nowej sesji niezależnie od brancha — **zmerguj PR #12 do `main`** (wymaga decyzji człowieka).
