---
description: "Jednorazowe zapytanie do zewnętrznego LLM API — Google Gemini albo xAI Grok. Nie jest przełącznikiem domyślnego modelu tej sesji, tylko osobnym wywołaniem zewnętrznego dostawcy."
argument-hint: "provider: gemini|xai, prompt: <tekst>, model: <opcjonalnie>"
---

# /api — zapytanie do zewnętrznego LLM API (Gemini / xAI)

Wysyła pojedynczy prompt do wskazanego zewnętrznego dostawcy (Google Gemini
albo xAI Grok) i zwraca odpowiedź w czacie. To NIE jest przełącznik modelu
tej sesji — to osobne, jednorazowe wywołanie zewnętrznego API, przydatne gdy
zadanie faktycznie wymaga konkretnie tego dostawcy (np. porównanie
odpowiedzi, multimodalność, kontekst/koszt specyficzny dla danego modelu).

Argument: `$ARGUMENTS` — parsuj `provider` (wymagany: `gemini` albo `xai`,
dopytaj JEDNYM pytaniem jeśli brak lub niejednoznaczny), `prompt` (wymagany,
dopytaj JEDNYM pytaniem jeśli brak) i `model` (opcjonalnie — domyślnie
`gemini-2.5-flash` dla Gemini, `grok-4` dla xAI).

## Klucze API — WYŁĄCZNIE z `.env`, nigdy hardkodowane

Każdy dostawca ma własną zmienną środowiskową w lokalnym `.env`
(gitignorowany, patrz `.env.example` — dopisz tam brakujące wpisy):
- `GEMINI_API_KEY` — Google AI Studio (aistudio.google.com/apikey).
- `XAI_API_KEY` — xAI Console (console.x.ai).

**Nigdy nie wklejaj realnego klucza do tego pliku komendy, do `CLAUDE.md`
ani do żadnego innego pliku trafiającego do gita** — to złamałoby twardą
zasadę tego repo („Sekrety WYŁĄCZNIE przez `.env`... Nigdy nie hardkoduj”,
patrz `CLAUDE.md`) i trwale zapisało sekret w historii commitów.

Jeśli zmienna dla wybranego `provider` nie jest ustawiona w środowisku —
**nie proś użytkownika o wklejenie klucza na czacie** (trafiłby do
logów/transkryptu). Poinstruuj krótko: „ustaw `<NAZWA_ZMIENNEJ>` w lokalnym
`.env`” i zatrzymaj się.

## Wywołanie — provider: gemini

```
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"<prompt, poprawnie zescapowany JSON>"}]}]}'
```

Klucz przekazuj przez nagłówek `x-goog-api-key` (nie w URL jako
`?key=...`), żeby nie lądował w logach requestów/historii shella jako
parametr zapytania. Z odpowiedzi JSON wyciągnij
`candidates[0].content.parts[0].text`. Jeśli odpowiedź ma
`promptFeedback.blockReason` zamiast `candidates` — zgłoś to wprost jako
zablokowanie przez filtr bezpieczeństwa Gemini, nie jako pustą odpowiedź.

## Wywołanie — provider: xai

xAI ma API zgodne z formatem OpenAI chat completions:

```
curl -s -X POST \
  "https://api.x.ai/v1/chat/completions" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"<model>","messages":[{"role":"user","content":"<prompt, poprawnie zescapowany JSON>"}]}'
```

Z odpowiedzi JSON wyciągnij `choices[0].message.content`.

## Błędy (oba dostawcy)
- `401`/`403` → klucz nieprawidłowy/wygasły lub brak dostępu do modelu —
  poinformuj użytkownika, nie zgaduj przyczyny.
- `429` → limit tieru — podaj to wprost, zaproponuj poczekać albo zmienić
  `model` na tańszy/szybszy wariant.
- Brak klucza dla wybranego `provider` → patrz sekcja wyżej, nie proś o
  klucz na czacie.

## Raport
W czacie: użyty `provider` + `model`, sam tekst odpowiedzi, i jeśli
wystąpił błąd — kod błędu + jedno zdanie wyjaśnienia (bez surowego zrzutu
JSON, chyba że użytkownik prosi o szczegóły debugowania).

## Definicja sukcesu
Odpowiedź widoczna w czacie dla wskazanego dostawcy, żaden klucz API nigdy
nie trafia do zawartości repo ani nie jest proszony na czacie — tylko z
lokalnego `.env`.
