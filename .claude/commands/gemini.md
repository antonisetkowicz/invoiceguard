---
description: "Zapytanie do Google Gemini API (generateContent) — użyteczne gdy potrzebny jest konkretnie model Gemini (inny kontekst/koszt/multimodalność niż Claude), nie jako zamiennik domyślnego modelu w tej sesji."
argument-hint: "prompt: <tekst>, model: <opcjonalnie, domyślnie gemini-2.5-flash>"
---

# /gemini — zapytanie do Google Gemini API

Wysyła pojedynczy prompt do Gemini API (`generateContent`) i zwraca odpowiedź
w czacie. To NIE jest przełącznik modelu tej sesji — to osobne, jednorazowe
wywołanie zewnętrznego API, przydatne gdy zadanie faktycznie wymaga Gemini
(np. porównanie odpowiedzi, multimodalność, kontekst/koszt specyficzny dla
Gemini), a nie ogólna rozmowa.

Argument: `$ARGUMENTS` — parsuj `prompt` (wymagany, dopytaj JEDNYM pytaniem
jeśli brak) i `model` (opcjonalnie, domyślnie `gemini-2.5-flash`; np.
`gemini-2.5-pro` dla trudniejszych zadań).

## Klucz API — WYŁĄCZNIE z `.env`, nigdy hardkodowany

Ta komenda czyta klucz ze zmiennej środowiskowej `GEMINI_API_KEY`, ustawionej
w lokalnym `.env` (gitignorowany, patrz `.env.example` — dopisz tam
`GEMINI_API_KEY=` jeśli brak wpisu). **Nigdy nie wklejaj realnego klucza do
tego pliku komendy, do `CLAUDE.md` ani do żadnego innego pliku trafiającego
do gita** — to złamałoby twardą zasadę tego repo („Sekrety WYŁĄCZNIE przez
`.env`... Nigdy nie hardkoduj”, patrz `CLAUDE.md`) i trwale zapisało sekret
w historii commitów.

Jeśli `GEMINI_API_KEY` nie jest ustawiony w środowisku — **nie proś
użytkownika o wklejenie klucza na czacie** (to trafia do logów/transkryptu).
Poinstruuj krótko: „ustaw `GEMINI_API_KEY` w lokalnym `.env`” i zatrzymaj się.
Klucz zdobywa się w Google AI Studio (aistudio.google.com/apikey) — darmowy
tier z limitami zapytań/min istnieje dla większości modeli Gemini.

## Wywołanie

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

## Błędy
- `401`/`403` → klucz nieprawidłowy/wygasły lub brak dostępu do modelu —
  poinformuj użytkownika, nie zgaduj przyczyny.
- `429` → limit darmowego tieru — podaj to wprost, zaproponuj poczekać lub
  zmniejszyć `model` na tańszy/szybszy wariant.
- Brak `GEMINI_API_KEY` → patrz sekcja wyżej, nie proś o klucz na czacie.

## Raport
W czacie: użyty model, sam tekst odpowiedzi Gemini, i jeśli wystąpił błąd —
kod błędu + jedno zdanie wyjaśnienia (bez surowego zrzutu JSON, chyba że
użytkownik prosi o szczegóły debugowania).

## Definicja sukcesu
Odpowiedź Gemini widoczna w czacie, klucz API nigdy nie trafia do
zawartości repo ani nie jest proszony na czacie — tylko z lokalnego `.env`.
