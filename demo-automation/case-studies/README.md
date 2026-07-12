# Case Studies PDF Generator

Generuje 1-stronicowe case studies PDF (reportlab) na podstawie prostego
JSON brief-u. Layout: nagłówek z nazwą projektu i logo-placeholderem,
sekcja "Problem" (czerwony akcent), "Rozwiązanie" (niebieski akcent),
"Efekty" jako numerowane punkty oraz stopka z tech stackiem jako tagi.
Osadza font DejaVu Sans (folder `fonts/`), więc poprawnie renderuje polskie
znaki diakrytyczne niezależnie od fontów zainstalowanych w systemie.

## Format wejściowy (JSON)

```json
{
  "project_name": "Boss Agency",
  "problem": "Opis problemu klienta...",
  "solution": "Opis wdrożonego rozwiązania...",
  "results": ["Efekt 1", "Efekt 2", "Efekt 3"],
  "tech_stack": ["n8n", "Claude API", "PostgreSQL"]
}
```

Wymagane pola: `project_name`, `problem`, `solution`, `results` (niepusta
lista), `tech_stack` (niepusta lista).

## Użycie

```bash
pip install -r requirements.txt

# pojedynczy plik -> case-study.pdf obok wejścia
python generate_case_study.py examples/boss-agency.json

# pojedynczy plik -> konkretna ścieżka wyjściowa
python generate_case_study.py examples/boss-agency.json -o boss-agency.pdf

# wiele plików naraz -> katalog wyjściowy
python generate_case_study.py examples/*.json -o .
```

## Przykładowe case studies (`examples/`)

- `boss-agency.json` — Boss Agency, pipeline do lead generation
- `ofertuj-pro.json` — ofertuj.pro, AI generator ofert B2B
- `docflow-ai.json` — DocFlow AI, multi-tenant document intelligence

Gotowe PDF-y wygenerowane z powyższych przykładów znajdują się bezpośrednio
w tym katalogu (`boss-agency.pdf`, `ofertuj-pro.pdf`, `docflow-ai.pdf`).
