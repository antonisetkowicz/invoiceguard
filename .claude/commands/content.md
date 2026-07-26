---
description: Autonomiczny pipeline wideo — od tematu do opublikowanego Reelsa (9:16, <90 s) z lektorem, napisami, muzyką i miniaturą. 10 kroków, checkpoint akceptacji przed publikacją.
argument-hint: [temat] albo [batch <n>] albo [approve|reject <powód>]
---

# /content — orkiestrator pipeline'u wideo

Jesteś ORKIESTRATOREM. Nie wykonujesz pracy agentów sam — przygotowujesz run,
odpalasz kroki 1→10 SEKWENCYJNIE i pilnujesz checkpointu z człowiekiem.

Argument użytkownika: `$ARGUMENTS`
- pusty → researcher sam wybiera temat na podstawie trendów i metryk poprzednich Reelsów
- `<temat>` → wymuszony temat/nisza
- `batch <n>` → tryb wsadowy: n Reelsów, JEDEN zbiorczy checkpoint na końcu
- `approve` / `reject <powód>` → decyzja o ostatnim runie czekającym na akceptację

Kroki 1 i 2 wykonują subagenci LLM (`Task`). Kroki 3–10 to skrypty Pythona
uruchamiane przez `Bash`. Wszystko komunikuje się przez pliki w `RUN_DIR`.

---

## Krok 0 — inicjalizacja

1. Jeśli `$ARGUMENTS` zaczyna się od `approve` lub `reject` → przeskocz do
   sekcji **Obsługa decyzji człowieka**.
2. Sprawdź środowisko:
   `python3 content-pipeline/preflight.py --json`
   - pozycja ze statusem `BRAK` → **STOP**, pokaż użytkownikowi listę napraw.
     Nie zaczynaj runu, który i tak padnie w połowie.
   - `UWAGA` → kontynuuj, ale zapamiętaj i wypisz w raporcie końcowym.
3. Ustal `TS` = timestamp UTC w formie `2026-07-26T14-30-00Z`.
   Ustaw `RUN_DIR=content-pipeline/logs/<TS>`. Utwórz go (`mkdir -p`).
4. Zapisz `RUN_DIR/state.json`:
   `{"run_id":"<TS>","started_at":"<ISO>","args":{"topic":"<temat lub null>"},"steps":{}}`
5. Zapamiętaj rozmiar/istnienie `HUMAN_ACTION_REQUIRED.md` PRZED startem, żeby
   wykryć dopisy.

---

## Kroki 1→8 — produkcja

| # | krok | jak uruchomić | produkuje |
|---|------|---------------|-----------|
| 1a | trendy | `python3 content-pipeline/agents/01_researcher.py --run-dir <RUN_DIR> --collect [--topic "<temat>"]` | `trends.json` |
| 1b | researcher | `Task` → subagent **content-researcher** | `brief.json` |
| 2 | scriptwriter | `Task` → subagent **content-scriptwriter** | `script.json` |
| 3 | lektor | `python3 content-pipeline/agents/03_voice_generator.py --run-dir <RUN_DIR>` | `voice.mp3`, `voice.json` |
| 4 | wizualizacje | `python3 content-pipeline/agents/04_visual_builder.py --run-dir <RUN_DIR>` | `visuals.mp4` |
| 5 | napisy | `python3 content-pipeline/agents/05_caption_burner.py --run-dir <RUN_DIR>` | `captioned.mp4` |
| 6 | miks audio | `python3 content-pipeline/agents/06_audio_mixer.py --run-dir <RUN_DIR>` | `final.mp4` |
| 7 | miniatura | `python3 content-pipeline/agents/07_thumbnail_generator.py --run-dir <RUN_DIR>` | `thumbnail.jpg` |
| 8 | QA | `python3 content-pipeline/agents/08_qa_checker.py --run-dir <RUN_DIR>` | `qa_report.json` + pliki w `output/` |

W promptach subagentów 1b i 2 podaj: `RUN_DIR=<ścieżka>`, temat od użytkownika
(jeśli był) i przypomnienie kontraktu I/O. Subagenty nie widzą siebie nawzajem.

### Po każdym kroku
1. Sprawdź, czy artefakt powstał i czy skrypt zwrócił `"status": "ok"`.
2. Błąd w krokach **1–6** → to są kroki krytyczne, bez nich nie ma pliku.
   Ponów RAZ, jeśli błąd wygląda na przejściowy (sieć, timeout). Jeśli dalej
   pada — **STOP**, pokaż użytkownikowi `error` i `hint` ze stdout.
3. Błąd w kroku **7** (miniatura) → nie blokuj, idź dalej, odnotuj degradację.
4. Krok 4 sam pobiera ujęcia z ludźmi dla scen `visual.kind == "footage"`
   (Pexels/Pixabay, darmowe klucze). Bez `PEXELS_API_KEY`/`PIXABAY_API_KEY`
   sceny degradują się do gradientów i powstaje wpis w
   `HUMAN_ACTION_REQUIRED.md` — **to nie jest błąd kroku**, ale zaraportuj to
   wprost, bo Reels bez ludzi wygląda jak prezentacja.
   Flagę `--images` (Pollinations.ai) dodaj tylko jeśli scenariusz faktycznie
   używa `visual.kind == "image"`.
5. Jeśli `HUMAN_ACTION_REQUIRED.md` urósł — zanotuj, ale **nie przerywaj**.

### Flagi opcjonalne
- `--no-music` (krok 6) — gdy `assets/music/` jest puste, skrypt i tak sobie
  poradzi i wyeskaluje; flagi używaj tylko na wyraźną prośbę użytkownika.
- `--engine edge-tts` (krok 5) — gdy Whisper nie jest zainstalowany
  (skrypt sam degraduje, ale to przyspiesza).

---

## STOP — checkpoint akceptacji (po kroku 8)

**Tu pipeline się ZATRZYMUJE.** Nie uruchamiaj kroków 9–10 bez zgody człowieka.

Wypisz użytkownikowi:
1. Temat, hook (dosłownie), pełny caption + hashtagi.
2. Statystyki z `qa_report.json`: długość, rozdzielczość, rozmiar, kodeki.
3. Wynik testów QA: co przeszło, co nie (`blocking_failures`, `warnings`).
4. **Ścieżki do plików** — `output/<TS>_<slug>.mp4` i `.jpg`. Powiedz wprost,
   że trzeba je otworzyć i obejrzeć; nie udawaj, że sam widziałeś wideo.
5. Pytanie: **publikujemy?** z dwiema opcjami:
   - `/content approve`
   - `/content reject <co poprawić>`

Jeśli `qa_report.status == "blocked"` — nie pytaj o akceptację. Powiedz, co
jest technicznie nie tak, i zaproponuj konkretną poprawkę.

---

## Obsługa decyzji człowieka

Ustal `RUN_DIR` ostatniego runu ze statusem `awaiting_approval`
(najnowszy katalog w `content-pipeline/logs/` z `qa_report.json`).

**`approve`:**
1. `python3 content-pipeline/agents/08_qa_checker.py --run-dir <RUN_DIR> --approve`
2. Krok 9: `python3 content-pipeline/agents/09_publisher.py --run-dir <RUN_DIR>`
3. Krok 10: `python3 content-pipeline/agents/10_analytics_tracker.py --run-dir <RUN_DIR>`
4. Raport końcowy.

**`reject <powód>`:**
1. `python3 content-pipeline/agents/08_qa_checker.py --run-dir <RUN_DIR> --reject "<powód>"`
2. Wróć do **kroku 2** — odpal subagenta **content-scriptwriter** z tym samym
   `RUN_DIR`; on przeczyta `feedback` z `qa_report.json` i napisze scenariusz
   od nowa.
3. Przejdź kroki 3→8 ponownie i znów zatrzymaj się na checkpoincie.

---

## Kroki 9→10 — publikacja i metryki

| # | krok | uruchomienie | produkuje |
|---|------|--------------|-----------|
| 9 | publisher | `python3 content-pipeline/agents/09_publisher.py --run-dir <RUN_DIR>` | `publish.json` |
| 10 | analytics | `python3 content-pipeline/agents/10_analytics_tracker.py --run-dir <RUN_DIR>` | `analytics.json` |

- Krok 9 odmawia publikacji bez `approved: true` — to celowe, nie obchodź tego
  flagą `--force`.
- Brak tokenu IG albo brak publicznego URL-a → publisher sam przechodzi w tryb
  `manual` i dopisuje instrukcję do `HUMAN_ACTION_REQUIRED.md`. To NIE jest
  błąd runu — zaraportuj to jako „opublikuj ręcznie".
- Krok 10 przy publikacji ręcznej zwróci `skipped` (nie ma `media_id`). Też OK.

---

## Tryb wsadowy — `/content batch <n>`

1. Wykonaj kroki 1→8 dla `n` runów, każdy w osobnym `RUN_DIR`.
   Nie zatrzymuj się po każdym — zbieraj wyniki.
2. Researcher dla runu k>1 dostaje w promcie listę tematów z runów 1..k-1
   z poleceniem: **nie powtarzaj tych tematów**.
3. Jeśli któryś run padnie w krokach 1–6 — nie przerywaj całego batcha.
   Odnotuj i leć dalej.
4. Po wszystkich runach wypisz JEDEN zbiorczy checkpoint: tabela
   `run_id | temat | hook | długość | status QA | ścieżka pliku`.
5. Poproś o decyzję per Reels, np. `/content approve 1,3` albo
   `/content reject 2 za wolne tempo`. Publikuj tylko zatwierdzone.
6. Publikując wiele naraz: między krokami 9 kolejnych runów rób odstęp
   (Meta limituje do 50 postów / 24 h, a seria pod rząd wygląda jak spam).

---

## RAPORT KOŃCOWY (zawsze — wypisz w czacie)

Na koniec KAŻDEGO wywołania `/content`, niezależnie od wyniku:

1. **Status** — opublikowany / czeka na akceptację / do publikacji ręcznej / zatrzymany.
2. **Link do posta** (`permalink` z `publish.json`), jeśli publikacja poszła.
3. **Tabela kroków 1→10** — co wyprodukował każdy krok i czy się udał.
4. **Pełne ścieżki plików**: `output/<TS>_<slug>.mp4`, `.jpg`, oraz artefakty
   runu (`brief.json`, `script.json`, `voice.mp3`, `visuals.mp4`,
   `captioned.mp4`, `final.mp4`, `qa_report.json`, `publish.json`,
   `analytics.json`, `log.md`).
5. **Metryki dnia 0** z `analytics.json` (albo powód, dla którego ich nie ma).
6. **Wymaga Ciebie** — pozycje dopisane do `HUMAN_ACTION_REQUIRED.md` w tym
   runie (albo „nic — wszystko poszło automatycznie").
7. **Ostrzeżenia preflight**, jeśli jakieś były.

---

## Zasady twarde
- **Tylko darmowe narzędzia.** edge-tts, Whisper, Remotion, ffmpeg, Instagram
  Graph API, Pexels/Pixabay Videos, Pollinations.ai — wszystko bez opłat i bez
  karty. Ayrshare NIE jest darmowe dla wideo; nie proponuj go jako ścieżki
  domyślnej. Awatary AI mówiące do kamery (HeyGen/Synthesia/D-ID) też są
  płatne — nie proponuj ich jako rozwiązania „z ludźmi".
- **Ujęcia z ludźmi to stock, nie użytkownik.** Nigdy nie sugeruj w scenariuszu
  ani w raporcie, że osoba w kadrze mówi te słowa, jest klientem albo poleca
  produkt — licencje Pexels/Pixabay tego zabraniają, a widz to wyczuwa.
- **Nigdy nie publikuj bez zgody człowieka.** Jedyne wyjście z kroku 8 to
  `--approve` wpisane przez użytkownika.
- Sekrety wyłącznie z `.env` (`IG_ACCESS_TOKEN`, `IG_USER_ID`) — nigdy nie
  wypisuj tokenu w czacie, logu ani artefaktach runu.
- Muzyka pochodzi wyłącznie z `assets/music/` (pobrana ręcznie z legalnego
  darmowego źródła). Nigdy nie pobieraj automatycznie ścieżek z internetu —
  licencja jest odpowiedzialnością człowieka.
- Nie twierdź, że obejrzałeś wideo. Możesz raportować metadane i wyniki testów;
  ocena wizualna należy do człowieka.
- `content-pipeline/logs/*`, `output/*`, `temp/*` i `data/*.db` są
  gitignorowane — nie commituj artefaktów runów.
