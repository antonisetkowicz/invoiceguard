---
description: "Podpina do bieżącej sesji Claude Code WSZYSTKIE repozytoria GitHub potrzebne do wykonania aktualnego zadania w tej konwersacji — żeby nie trzeba było o dostęp prosić ręcznie w trakcie pracy. Wykrywa repozytoria z argumentów, z linków/nazw padających w rozmowie, albo (bez argumentów) z samego kontekstu zadania."
argument-hint: "[owner/repo lub URL GitHuba, spacją/przecinkiem oddzielone] (opcjonalnie — bez argumentów: wykryj z kontekstu rozmowy)"
---

# /git — dostęp do repozytoriów GitHub potrzebnych w tej konwersacji

Cel: przed (albo w trakcie) pracy nad zadaniem upewnić się, że każde
repozytorium GitHub, które faktycznie jest potrzebne w tej konwersacji, jest
podpięte do sesji przez narzędzie `add_repo` — tak żeby dalsza praca (odczyt,
klon, PR-y) nie przerywała się na proszeniu o dostęp.

To NIE jest komenda do masowego podpinania wszystkiego, co się da — podpinamy
tylko to, co zadanie realnie wymaga (każde `add_repo` mintuje poświadczenia i
odpytuje GitHuba, więc to ma koszt).

## Krok 1 — ustal listę kandydatów

1. Jeśli w `$ARGUMENTS` podano jedno lub więcej `owner/repo` albo URL-i
   `github.com/...` — to jest lista kandydatów wprost, użyj jej.
2. Jeśli `$ARGUMENTS` jest puste — przejrzyj kontekst bieżącej konwersacji
   (co user opisał jako zadanie, jakie repo/organizacje/URL-e padły, jakie
   repo już są wymienione jako dostępne w tej sesji) i wypisz repozytoria,
   które są rzeczywiście potrzebne do wykonania zadania. Nie zgaduj repo
   „na wszelki wypadek" — tylko te, bez których zadania nie da się zrobić
   albo których user prosił.
3. Repozytorium, w którym już aktualnie pracujesz (bieżący checkout) pomiń —
   jest dostępne z definicji.
4. Jeśli nazwa repo jest niejednoznaczna (sama nazwa bez ownera, skrót) —
   użyj `list_repos` (filtr `query`) żeby znaleźć dokładny `owner/repo`
   zamiast zgadywać.

## Krok 2 — podepnij każdego kandydata

Dla każdego repo z listy z Kroku 1, którego jeszcze nie ma w zakresie sesji:

- Wywołaj `add_repo` z `owner` i `repo` jako osobnymi polami (nie sklejaj
  `owner/repo` w jedno pole).
- `access`: domyślnie `"read"`. Użyj `"push"` tylko jeśli zadanie w tej
  repo wymaga commitów/PR-ów/wywołań API modyfikujących (nie tylko
  odczytu/klonowania).
- Nie sprawdzaj wcześniej istnienia/dostępności repo przez `curl`, `gh repo
  view` czy `git ls-remote` — nieautoryzowane zapytania do prywatnych repo
  zwracają mylące 404. `add_repo` sam robi realny check i zwraca ustrukturyzowany
  wynik.
- Jeśli `add_repo` zwróci komunikat o braku autoryzacji (repo istnieje, ale
  nie jest włączone dla tego workspace'u / brak zainstalowanej aplikacji
  GitHub) — nie ponawiaj tego samego repo. Przekaż userowi dokładny powód z
  narzędzia.
- Jeśli zadanie wymaga przeszukiwania repo lokalnymi narzędziami plikowymi
  (Glob/Grep/Read na całym drzewie) zamiast tylko GitHub API, wykonaj
  polecenie klonujące zwrócone przez `add_repo`, a potem wywołaj
  `register_repo_root`, żeby `CLAUDE.md`/skille/pluginy tej repo załadowały
  się przy następnej turze.

## Krok 3 — raport

W czacie krótka tabela/lista:
- repo już dostępne wcześniej (pominięte),
- repo nowo podpięte (z `access` i czy sklonowane lokalnie),
- repo, których podpiąć się nie dało — z dokładnym powodem zwróconym przez
  `add_repo` (np. brak instalacji GitHub App, brak zgody organizacji) i bez
  zgadywania obejścia.

Jeśli lista kandydatów z Kroku 1 wyszła pusta (zadanie nie wymaga żadnego
dodatkowego repo poza bieżącym) — powiedz to wprost i nie wywołuj
`add_repo` w ogóle.

## Zasady twarde
- Nigdy nie podpinaj repo, które nie ma związku z zadaniem, tylko dlatego że
  padła jego nazwa w rozmowie.
- Nigdy nie proś o `access: "push"` domyślnie — tylko gdy zadanie tego
  faktycznie wymaga.
- To samodzielna, uniwersalna komenda pomocnicza — nie jest częścią żadnego
  z pipeline'ów (`autobiznes`, `autoodpowiedzi`, `autoc`) opisanych w
  `CLAUDE.md`; mogą jej używać wszystkie z nich, gdy subagent/orkiestrator
  potrzebuje dostępu do repo spoza bieżącego checkoutu.
