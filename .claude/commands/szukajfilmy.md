---
description: "Wyszukiwanie treści na YouTube i Instagramie — tytuły, opisy, linki, autorzy. TYLKO wyszukiwanie/metadane przez oficjalne/publiczne źródła (YouTube Data API jeśli skonfigurowany, inaczej WebSearch). NIE pobiera wideo, NIE transkrybuje, NIE loguje się na żadne konto, NIE używa nieoficjalnych scraperów Instagrama wymagających danych logowania — patrz sekcja „Czego ta komenda świadomie NIE robi”."
argument-hint: "zapytanie: <fraza>, platforma: youtube|instagram|oba (domyślnie oba), liczba: <n=10>"
---

# /szukajfilmy — wyszukiwanie w YouTube i Instagramie

Zwraca listę wyników (tytuł/opis/autor/link/miniatura jeśli dostępna) dla
zapytania na wskazanej platformie. To jest **wyszukiwarka metadanych**, nie
odtwarzacz — nie pobiera, nie ogląda ani nie transkrybuje samego wideo.

Argument: `$ARGUMENTS` — parsuj `zapytanie` (wymagane, dopytaj JEDNYM
pytaniem jeśli brak), `platforma` (domyślnie `oba`), `liczba` (domyślnie 10).

## YouTube

### Ścieżka A — YouTube Data API v3 (preferowana, jeśli jest klucz)
Jeśli w `.env` ustawiony jest `YOUTUBE_API_KEY` (patrz `.env.example`):
```
curl -s "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=<liczba>&q=<zapytanie URL-encoded>&key=$YOUTUBE_API_KEY"
```
To jest **oficjalne, darmowe API Google** (bezpłatny limit dzienny) — zero
naruszenia ToS. Z odpowiedzi JSON wyciągnij: `title`, `description`,
`channelTitle`, `videoId` → zbuduj link `https://www.youtube.com/watch?v=<id>`,
`publishedAt`, `thumbnails.medium.url`.

### Ścieżka B — WebSearch (fallback bez klucza, działa od razu)
`WebSearch` z zapytaniem `<zapytanie> site:youtube.com`. Mniej ustrukturyzowane
(brak pewnych opisów/dat), ale nie wymaga żadnej konfiguracji ani sekretów.

## Instagram

**Nie istnieje żadne oficjalne, darmowe API do wyszukiwania cudzych
publicznych postów po słowie kluczowym.** Instagram Graph API pozwala
zarządzać WYŁĄCZNIE kontami biznesowymi, do których użytkownik ma
uprawnienia administratora — nie ma w nim wyszukiwania cudzych treści.

Jedyna dostępna ścieżka: `WebSearch` z `<zapytanie> site:instagram.com`.
To zwraca tylko to, co wyszukiwarka faktycznie zaindeksowała (Instagram
mocno ogranicza indeksowanie niezalogowanym botom) — wyniki będą skąpe i
niepełne. Zawsze zaznacz to w raporcie, nie udawaj pełnego pokrycia.

### Czego ta komenda świadomie NIE robi (i dlaczego)
Nie instalujemy ani nie uruchamiamy nieoficjalnych scraperów Instagrama
(np. narzędzi typu instaloader/instagrapi znalezionych na GitHubie), mimo że
właściciel repo zaakceptował ryzyko naruszenia ToS platform w tym projekcie
(por. `/wyslij`). Różnica jest istotna i nie jest tylko formalnością:
- Realne scrapery Instagrama zwykle wymagają **zalogowania się** (dane
  logowania w `.env`/kodzie) albo aktywnego omijania jego ochrony
  antybotowej — to inna kategoria ryzyka niż wysyłka przez ESP z `/wyslij`
  (tam nie ma przejmowania konta ani obchodzenia zabezpieczeń).
- Kod „pierwszy z brzegu" z GitHuba pod frazę „instagram scraper" nie jest
  zweryfikowany — uruchomienie go przez `Bash` z dostępem do tego repo i
  ewentualnych sekretów to osobne ryzyko bezpieczeństwa, niezależne od ToS.
- Meta aktywnie ściga scraperów prawnie (poza samym ToS) — to większe
  ryzyko niż zawieszenie konta ESP.

Jeśli w przyszłości potrzebne jest głębsze pokrycie Instagrama: jedyna
czysta droga to Instagram Graph API na WŁASNYM koncie biznesowym (wymaga
przez użytkownika: konta biznesowego, aplikacji w Meta for Developers,
tokenu) — to eskalacja do `HUMAN_ACTION_REQUIRED.md`, nie coś do zrobienia
automatycznie.

## Raport
W czacie: tabela wyników (tytuł, autor, link) per platforma, źródło
(oficjalne API vs WebSearch), i jeśli Instagram — jawne zastrzeżenie o
niepełnym pokryciu.

## Definicja sukcesu
Zwrócona lista trafnych wyników z linkami dla każdej żądanej platformy,
z jasnym oznaczeniem źródła danych i ograniczeń — bez żadnego logowania,
pobierania wideo czy uruchamiania niezweryfikowanego kodu scrapującego.
