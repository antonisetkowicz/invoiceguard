---
description: Grupowo dodaje repozytoria do zakresu bieżącej sesji na starcie — jedna seria potwierdzeń zamiast przerywania pracy w połowie zadania.
---

# /repos-setup

## Po co to istnieje

Narzędzia platformy Claude Code Remote/Cowork działające na poziomie całego konta GitHub
(`list_repos`, `add_repo`, `create_session` i podobne) zawsze wymagają Twojego ręcznego
potwierdzenia — `MCP error -32003: MCP tool call requires approval`. To **twarda bramka
bezpieczeństwa platformy**, nie ustawienie w `.claude/settings.json` — żaden `defaultMode`
(w tym `bypassPermissions`) jej nie omija, bo gdyby omijał, dowolny commit w dowolnym repo
mógłby po cichu rozszerzyć dostęp sesji na całe Twoje konto GitHub bez Twojej wiedzy.

Ta komenda **nie eliminuje** tych potwierdzeń. Zbiera je w jedną serię na początku sesji,
zamiast dawać Ci je pojedynczo w losowych momentach w trakcie pracy.

## Wymagania

Działa TYLKO w sesji interaktywnej, w kliencie który potrafi wyświetlić prompt
Allow/Deny (appka mobilna, desktop, claude.ai/code w przeglądarce). W sesjach bez kanału
do potwierdzeń (np. część przebiegów w tle/API) `list_repos`/`add_repo` kończą się błędem
`-32003` bez żadnego sposobu na potwierdzenie — komenda w takiej sesji nie zadziała.

## Użycie

- `/repos-setup` — dodaje WSZYSTKIE repozytoria dostępne na koncie. Przy dużej liczbie repo
  oznacza to odpowiednio dużo kliknięć na starcie — rozważ zawężenie.
- `/repos-setup fraza: <substring>` — dodaje tylko repozytoria, których `owner/repo`
  zawiera podaną frazę (np. `fraza: antonisetkowicz` albo `fraza: friday`).
- `/repos-setup lista: <repo1>, <repo2>, ...` — dodaje tylko wymienione repozytoria
  (format `owner/repo`), pomijając wyszukiwanie.

## Kroki (wykonuje agent po wywołaniu komendy)

1. Jeśli podano `lista:` — pomiń krok 2, przejdź do kroku 3 z tą listą.
2. Wywołaj `list_repos` (z `query` = `fraza:` jeśli podano, inaczej puste = wszystkie,
   `limit` wysoki np. 100). Poczekaj na Twoje potwierdzenie w UI.
3. Dla każdego zwróconego/wskazanego repozytorium (`owner/repo`) wywołaj `add_repo`
   z `access: "read"` (chyba że użytkownik jawnie poprosi o `push` dla konkretnego repo —
   `push` daje możliwość commitowania/otwierania PR, więc domyślnie zostaje węższe `read`).
   Każde wywołanie poczeka na osobne Twoje potwierdzenie — to zamierzone, nieomijalne.
4. Na koniec agent wypisuje krótkie podsumowanie: ile repo dodano, ile odrzucono/pominięto
   (np. już w zakresie, brak dostępu), i że sesja ma teraz dostęp do tych repozytoriów do
   końca swojego trwania.

## Czego ta komenda NIE robi

- Nie zapisuje trwałej listy "zawsze dodawaj te repo" — to per-sesja (`add_repo` działa na
  zakres bieżącej sesji, nie na przyszłe sesje). Każda nowa sesja odpala tę komendę od nowa.
- Nie omija ani nie próbuje omijać bramki `-32003` — to by wymagało cichego auto-zatwierdzania
  dostępu do całego konta bez Twojej wiedzy, czego celowo nie robimy (patrz sekcja "Po co to
  istnieje" wyżej).
