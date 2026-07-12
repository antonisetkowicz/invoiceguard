# Demo Automation AI

Środowisko demo do automatyzacji AI oparte na n8n, PostgreSQL i backendzie
FastAPI. Zawiera bazę danych n8n oraz osobną bazę `demo_leads` z przykładową
tabelą `leads`, a także serwis FastAPI (`backend/`), który jest sercem
workflow "lead qualification + auto-response": przyjmuje leady, ocenia ich
jakość i generuje spersonalizowaną odpowiedź przez Claude API, a przed
wysyłką prosi o zatwierdzenie na Telegramie (human-in-the-loop).

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

## Zatrzymanie środowiska

```bash
docker-compose down
```

Aby dodatkowo usunąć woluminy z danymi (n8n oraz PostgreSQL):

```bash
docker-compose down -v
```
