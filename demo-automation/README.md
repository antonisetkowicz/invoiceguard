# Demo Automation AI

Środowisko demo do automatyzacji AI oparte na n8n, PostgreSQL, backendzie
FastAPI i dashboardzie React. Zawiera bazę danych n8n oraz osobną bazę
`demo_leads` z przykładową tabelą `leads`, serwis FastAPI (`backend/`), który
jest sercem workflow "lead qualification + auto-response" (przyjmuje leady,
ocenia ich jakość i generuje spersonalizowaną odpowiedź przez Claude API, a
przed wysyłką prosi o zatwierdzenie na Telegramie), oraz dashboard
(`frontend/`) do prezentacji na callach sprzedażowych.

## Struktura

```
/demo-automation
  /docker-compose.yml
  /.env.example
  /init-db/init.sql
  /backend
    /app
      main.py, config.py, database.py, models.py, schemas.py, ai.py, telegram.py
    /requirements.txt
    /.env.example
    /Dockerfile
  /frontend
    /src
      App.tsx, components/, hooks/, lib/api.ts
    /package.json
    /.env.example
  /case-studies
    generate_case_study.py
    requirements.txt
    /fonts
    /examples
  /n8n-workflow.json
  /README.md
```

## Wymagania

- Docker i Docker Compose
- Klucz API Anthropic (`ANTHROPIC_API_KEY`)
- Token bota Telegram i ID czatu (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) —
  potrzebne tylko do endpointu zatwierdzania na Telegramie

## Uruchomienie

1. Skopiuj plik z przykładowymi zmiennymi środowiskowymi i uzupełnij dane:

   ```bash
   cp .env.example .env
   ```

   Ustaw w `.env` m.in. `POSTGRES_PASSWORD`, `N8N_BASIC_AUTH_PASSWORD` oraz
   `ANTHROPIC_API_KEY`.

2. Uruchom środowisko:

   ```bash
   docker-compose up -d
   ```

   Przy pierwszym starcie kontener PostgreSQL wykona skrypt
   `init-db/init.sql`, który tworzy bazę `demo_leads` z tabelą `leads` i
   przykładowymi rekordami.

3. Sprawdź status kontenerów (obie usługi mają skonfigurowane healthchecki):

   ```bash
   docker-compose ps
   ```

## Dostęp do n8n

Panel n8n jest dostępny pod adresem:

```
http://localhost:5678
```

Logowanie odbywa się przy użyciu danych z `N8N_BASIC_AUTH_USER` i
`N8N_BASIC_AUTH_PASSWORD` ustawionych w pliku `.env`.

## Baza danych

- **n8n** — baza `${POSTGRES_DB}` (domyślnie `n8n`), używana przez n8n do
  przechowywania workflow, credentiali i historii wykonań.
- **demo_leads** — osobna baza z tabelą `leads`, przeznaczona na przykładowe
  dane leadów przetwarzanych w demo:

  | Kolumna           | Typ         | Opis                                   |
  |--------------------|-------------|-----------------------------------------|
  | id                 | SERIAL      | Klucz główny                            |
  | name               | VARCHAR     | Imię i nazwisko leada                   |
  | email              | VARCHAR     | Adres e-mail                            |
  | company            | VARCHAR     | Nazwa firmy                             |
  | message            | TEXT        | Treść zapytania                         |
  | status             | VARCHAR     | Status leada (np. `new`, `qualified`)   |
  | created_at         | TIMESTAMPTZ | Data utworzenia                         |
  | ai_response        | TEXT        | Odpowiedź wygenerowana przez AI         |
  | qualified_score    | INTEGER     | Wynik kwalifikacji leada przez AI       |

Do bazy `demo_leads` można się połączyć z poziomu n8n (Postgres credential),
używając hosta `postgres`, portu `5432` i danych logowania z `.env`.

## Backend FastAPI (`backend/`)

Serwis dostępny pod adresem `http://localhost:8000` (uruchamiany razem z resztą
środowiska przez `docker-compose up`, jako usługa `backend`).

Endpointy:

- `POST /webhook/lead` — przyjmuje `{name, email, company, message}`, zapisuje
  leada do tabeli `leads`, wywołuje Claude API (model z `ANTHROPIC_MODEL`,
  domyślnie `claude-sonnet-4-6`) w celu oceny `qualified_score` (0-100) i
  wygenerowania spersonalizowanej odpowiedzi email, zapisuje wynik z powrotem
  do bazy i zwraca go w JSON.
- `GET /leads` — zwraca listę wszystkich leadów posortowaną po `created_at`
  malejąco (do wyświetlenia w demo UI).
- `POST /webhook/telegram-approval` — przyjmuje `{lead_id}`, wysyła na
  Telegram podsumowanie leada wraz z przyciskami inline "Zatwierdź" /
  "Edytuj" (human-in-the-loop przed faktyczną wysyłką odpowiedzi).

Uruchomienie lokalnie bez Dockera (np. do developmentu):

```bash
cd backend
cp .env.example .env
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Dokumentacja OpenAPI dostępna jest pod `http://localhost:8000/docs`.

### Dane demo (`backend/scripts/seed_demo_data.py`)

Wypełnia tabelę `leads` sześcioma realistycznymi leadami z różnych branż
(e-commerce, usługi B2B, SaaS, nieruchomości), o zróżnicowanym poziomie
"gorącości" — przydatne, żeby mieć gotowe dane do pokazania na callu nawet
bez wypełniania formularza na żywo.

```bash
cd backend
python scripts/seed_demo_data.py           # czyści tabelę i seeduje na nowo
python scripts/seed_demo_data.py --keep    # nie czyści tabeli, dopisuje leady
python scripts/seed_demo_data.py --no-ai   # pomija Claude API, używa gotowych wyników
```

Domyślnie każdy lead jest kwalifikowany przez prawdziwe Claude API (ten sam
kod co `POST /webhook/lead`), więc `qualified_score` wypada naturalnie
zróżnicowanie. Jeśli `ANTHROPIC_API_KEY` nie jest ustawiony albo wywołanie się
nie powiedzie, skrypt automatycznie używa przygotowanych wcześniej wartości
fallback — dane demo są więc zawsze gotowe, nawet offline.

## Dashboard React (`frontend/`)

Dashboard do pokazywania na callach sprzedażowych — ciemny motyw, gradientowe
akcenty, formularz do symulowania leadów i podgląd wyników AI na żywo (polling
`GET /leads` co 3s).

Uruchomienie lokalnie:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Dashboard będzie dostępny pod `http://localhost:5173` i domyślnie łączy się z
backendem pod `http://localhost:8000` (zmień `VITE_API_BASE_URL` w `.env`,
jeśli backend działa pod innym adresem).

Funkcje:

- Formularz "Symuluj nowego leada" — wysyła `POST /webhook/lead`, karta leada
  pojawia się natychmiast (optymistycznie) w stanie "Ocena w toku".
- Lista leadów jako karty z animacją wejścia, kolorowym badge'em
  `qualified_score` (czerwony <40, żółty 40-70, zielony >70) i rozwijanym
  panelem z odpowiedzią AI.
- Licznik metryk u góry: liczba leadów przetworzonych dzisiaj, liczba "hot"
  leadów oraz średni czas odpowiedzi (metryka symulowana na potrzeby demo).

## Generator case studies PDF (`case-studies/`)

Skrypt `generate_case_study.py` (reportlab) generuje 1-stronicowe case study
PDF na podstawie prostego JSON brief-u — nagłówek z nazwą projektu, sekcja
"Problem" (czerwony akcent), "Rozwiązanie" (niebieski akcent), numerowane
"Efekty" oraz stopka z tech stackiem jako tagi. Szczegóły i przykłady w
[`case-studies/README.md`](case-studies/README.md).

```bash
cd case-studies
pip install -r requirements.txt
python generate_case_study.py examples/*.json -o .
```

Gotowe PDF-y wygenerowane z przykładowych projektów (Boss Agency, ofertuj.pro,
DocFlow AI) są dołączone bezpośrednio w `case-studies/`.

## Workflow n8n (`n8n-workflow.json`)

Gotowy do zaimportowania workflow "Lead Qualification Demo":

1. Otwórz n8n pod `http://localhost:5678`.
2. Menu (⋮) → **Import from File** → wybierz `n8n-workflow.json`.
3. Workflow zawiera Sticky Notes z opisem każdego kroku (po polsku) — gotowe
   do prezentacji na żywo klientowi.

Kroki workflow:

1. **Webhook - Nowy Lead** (`POST /lead-intake`) — przyjmuje dane leada.
2. **HTTP Request - Kwalifikacja AI (FastAPI)** — wysyła leada do
   `POST http://localhost:8000/webhook/lead`, gdzie Claude API ocenia jego
   jakość i generuje odpowiedź.
3. **IF - Czy Hot Lead? (score > 60)** — rozgałęzia workflow na podstawie
   `qualified_score`:
   - **TRUE** → **HTTP Request - Powiadomienie Telegram** wywołuje
     `POST /webhook/telegram-approval`, wysyłając powiadomienie o hot leadzie.
   - **FALSE** → **Set - Low Priority** oznacza leada jako `low priority`,
     bez wysyłania powiadomienia.
4. **Respond to Webhook - Potwierdzenie** — zwraca potwierdzenie wraz z
   wygenerowaną przez AI odpowiedzią i wynikiem kwalifikacji.

Przed testem zaktualizuj credentiale/URL w węzłach HTTP Request, jeśli backend
działa pod innym adresem niż `http://localhost:8000` (np. wewnątrz sieci
Docker Compose adresem będzie `http://backend:8000`).

## Zatrzymanie środowiska

```bash
docker-compose down
```

Aby dodatkowo usunąć woluminy z danymi (n8n oraz PostgreSQL):

```bash
docker-compose down -v
```
