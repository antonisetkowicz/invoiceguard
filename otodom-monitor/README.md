# Monitor ofert nieruchomości (Otodom)

Lokalne narzędzie w Pythonie, które cyklicznie sprawdza wyniki wyszukiwania na
Otodom.pl, zapisuje oferty do SQLite i raportuje **co się zmieniło od ostatniego
razu**: nowe ogłoszenia, obniżki cen, oferty które zniknęły.

Otodom renderuje wyniki JavaScriptem, więc pod spodem chodzi **Playwright
(headless Chromium)** — `requests` + `BeautifulSoup` zwróciłyby pustą stronę.

---

## Co to robi

- pobiera listę wyników z Twojego filtrowanego URL-a (lokalizacja, cena, metraż…),
- wchodzi na stronę każdej oferty po pełny opis i całą galerię,
- zapisuje pliki zdjęć na dysk (`images/{offer_id}/`), nie tylko linki,
- trzyma stan w SQLite i przy każdym przebiegu robi **diff** względem poprzedniego,
- generuje raport markdown i/lub wysyła go webhookiem (Slack, Discord, n8n…),
- trzyma losowe opóźnienie 2–5 s między wejściami na strony (max ~1 request / 2 s).

### Czego CELOWO nie robi

- **Nie omija zabezpieczeń anty-botowych.** Gdy trafi na captcha, Cloudflare czy
  HTTP 403/429, przerywa przebieg, wypisuje czytelny komunikat i kończy się
  **kodem wyjścia 2**. Nie ma tu rozwiązywania captcha, podmiany fingerprintu ani
  rotacji proxy.
- Nie loguje się na żadne konto i nie dotyka treści niepublicznych.

> **Uwaga prawna/regulaminowa (przeczytaj raz).** Narzędzie jest do prywatnego
> monitoringu ogłoszeń — tego samego, co robisz ręcznie odświeżając stronę, tylko
> automatycznie i wolniej niż człowiek. Regulamin Otodom ogranicza jednak
> automatyczne pobieranie treści, a opisy i zdjęcia ogłoszeń są cudzym utworem.
> Trzymaj to lokalnie, nie redystrybuuj pobranych zdjęć ani opisów i nie
> podkręcaj tempa. Ryzyko (blokada IP/konta) jest po Twojej stronie.

---

## Instalacja

Wymagany Python **3.10+**.

```bash
cd otodom-monitor

python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

pip install -r requirements.txt

# KONIECZNE — Playwright pobiera własną przeglądarkę:
playwright install chromium
```

Na Linuksie może być potrzebne jeszcze `playwright install-deps chromium`
(biblioteki systemowe Chromium).

Masz już Chrome/Chromium i nie chcesz drugiej kopii? Wskaż binarkę w
`config.yaml` → `scraping.executable_path`.

Szybkie sprawdzenie, że logika działa (bez sieci i bez przeglądarki):

```bash
python selftest.py      # 47 testów: parsery, diff w SQLite, raport
```

---

## Konfiguracja (`config.yaml`)

Minimum, które musisz ustawić — **`search.url`**:

1. Wejdź na Otodom, ustaw filtry (miasto, cena, metraż, liczba pokoi).
2. Skopiuj URL z paska adresu.
3. Wklej do `search.url`.

Reszta ma sensowne domyślne wartości. Najważniejsze pokrętła:

| Klucz | Znaczenie |
|---|---|
| `search.max_offers_per_run` | twardy limit ofert na przebieg (ochrona przed zalaniem portalu) |
| `search.max_pages` | ile stron wyników przejść |
| `search.fetch_details` | czy wchodzić na strony ofert po opis i pełną galerię |
| `scraping.min_delay_seconds` / `max_delay_seconds` | losowa przerwa między wejściami; **nie da się ustawić poniżej 1 s** |
| `scraping.headless` | `false` = zobaczysz okno przeglądarki (przydatne przy diagnozie) |
| `images.download` | pobierać pliki zdjęć czy tylko linki |
| `watch.mark_removed_after_missing_runs` | ile przebiegów z rzędu oferta musi zniknąć, zanim uznamy ją za usuniętą (domyślnie 2 — chroni przed fałszywym alarmem po chwilowym błędzie sieci) |
| `watch.webhook.*` | wysyłka raportu POST-em z JSON-em |

Ścieżki (`storage.*`) są liczone względem katalogu `config.yaml`.

---

## Uruchamianie

```bash
python main.py --scrape          # pobierz i zapisz do bazy (bez raportu)
python main.py --watch           # pobierz, porównaj z poprzednim stanem, zrób raport
python main.py --report          # odtwórz raport ostatniego przebiegu (bez wchodzenia na portal)
python main.py --stats           # co siedzi w bazie
```

Przydatne przełączniki:

```bash
python main.py --scrape --limit 5 --dry-run   # zobacz co by pobrał, nic nie zapisuj
python main.py --watch --no-images            # bez pobierania plików zdjęć
python main.py --scrape --headful             # z widocznym oknem przeglądarki
python main.py --report --run-id 7            # raport konkretnego przebiegu
python main.py --debug-dump                   # zrzut do poprawiania selektorów
```

### Kody wyjścia

| Kod | Znaczenie |
|---|---|
| `0` | OK |
| `1` | błąd (sieć, konfiguracja, przeglądarka) |
| `2` | **wykryto blokadę anty-botową** — przebieg przerwany |

---

## Cron (tryb watch)

Raport ma sens tylko cyklicznie. Przykład: **co 3 godziny, w godzinach 7–22**.

```bash
crontab -e
```

```cron
0 7-22/3 * * * cd /ŚCIEŻKA/DO/otodom-monitor && .venv/bin/python main.py --watch >> logs/cron.log 2>&1
```

Uwagi:

- `cron` ma ubogi `PATH` — dlatego pełna ścieżka do `.venv/bin/python`, a nie `python`.
- Załóż katalog na logi: `mkdir -p logs`.
- Nie ustawiaj tego częściej niż co godzinę. Ogłoszenia nieruchomości nie
  zmieniają się co 5 minut, a częste odpytywanie to najprostsza droga do blokady.

Powiadomienie na telefon po wykryciu blokady (kod 2):

```cron
0 7-22/3 * * * cd /ŚCIEŻKA/DO/otodom-monitor && .venv/bin/python main.py --watch >> logs/cron.log 2>&1 || echo "monitor: kod $? — sprawdź logs/cron.log" | mail -s "Monitor ofert" ty@example.com
```

Na macOS zamiast crona możesz użyć `launchd` — plist analogiczny do tego
z `README.autoc.md` w tym repo.

Raport ląduje w `reports/raport-<data>-run<N>.md`, a najnowszy zawsze także
w `reports/latest.md`.

---

## Struktura

```
otodom-monitor/
├── main.py          # CLI: --scrape / --watch / --report / --stats / --debug-dump
├── scraper.py       # Playwright: nawigacja, rate limiting, wykrywanie blokad
├── parsers.py       # surowe dane -> Offer (bez zależności od przeglądarki)
├── db.py            # SQLite: schemat, zapis, diff
├── images.py        # pobieranie plików zdjęć
├── report.py        # raport markdown + webhook
├── models.py        # Offer, OfferChange, DiffResult
├── config.py        # wczytywanie config.yaml
├── config.yaml      # ⬅ TU ustawiasz URL i selektory
├── selftest.py      # testy logiki bez sieci
├── data/offers.db   # baza (gitignorowana)
├── images/{id}/     # pobrane zdjęcia (gitignorowane)
└── reports/         # raporty markdown (gitignorowane)
```

### Baza (tabele)

| Tabela | Po co |
|---|---|
| `offers` | aktualny stan oferty + `content_hash`, `status`, `first_seen_at`, `last_changed_at` |
| `offer_images` | URL-e zdjęć i ścieżki pobranych plików |
| `offer_changes` | historia zmian (typ, pole, wartość stara/nowa, numer przebiegu) |
| `runs` | dziennik przebiegów: status, liczniki, błąd |

Raport buduje się z `offer_changes`, dlatego `--report` potrafi odtworzyć raport
dowolnego wcześniejszego przebiegu bez ponownego wchodzenia na portal.

---

## Gdy portal zmieni strukturę strony

Prędzej czy później to nastąpi. Objaw: „Strona nie zwróciła ofert" albo puste pola.

```bash
python main.py --debug-dump
```

Zrzuca do `debug/`:

- `page.html` — pełny wyrenderowany HTML,
- `next_data.json` — JSON osadzony w stronie (Otodom = Next.js),
- `next_data_paths.txt` — **spis ścieżek w tym JSON-ie**,
- `screenshot.png`.

Otwórz `next_data_paths.txt`, znajdź ścieżkę do listy ogłoszeń (szukaj wpisu
z `[lista: N]`, gdzie N ≈ liczba wyników na stronie) i wpisz ją w
`config.yaml` → `portals.otodom.next_data.list_paths`.

Warto wiedzieć: parser ma dwa zabezpieczenia. Gdy skonfigurowane ścieżki
przestaną pasować, sam szuka listy ofert **po kształcie danych** (i mówi o tym
w logu). Gdy zniknie cały JSON — przechodzi na selektory CSS z sekcji
`selectors`. Narzędzie zwykle nie przestaje działać z dnia na dzień, ale warto
wtedy poprawić config.

---

## Inny portal (Morizon, Gratka)

Cała wiedza o portalu siedzi w `config.yaml` w sekcji `portals`. W `config.yaml`
jest gotowy szkielet profilu `morizon` — uzupełnij selektory i przełącz:

```yaml
portal: morizon
```

Co trzeba wypełnić:

| Pole | Uwagi |
|---|---|
| `base_url`, `offer_url_template` | do budowania absolutnych linków |
| `offer_id_pattern` | regex wyciągający ID z URL-a; bez niego ID to skrót SHA-1 z URL-a (też działa) |
| `pagination_param` | nazwa parametru strony w URL-u (zwykle `page`) |
| `next_data.enabled` | `false` dla portali bez Next.js — wtedy liczą się tylko selektory |
| `selectors.*` | `list_item` + `list_link` to minimum, żeby cokolwiek zadziałało |
| `image_url_rules` | regex podmieniający miniaturę na pełną rozdzielczość |

Kod Pythona nie wymaga zmian — `parsers.py` i `scraper.py` są sterowane profilem.

---

## Diagnostyka

| Objaw | Co z tym zrobić |
|---|---|
| `Nie udało się uruchomić Chromium` | `playwright install chromium` (i `install-deps` na Linuksie) |
| Kod wyjścia `2`, „Wykryto zabezpieczenie anty-botowe" | odczekaj kilka godzin, **zwiększ** `min_delay_seconds`, zmniejsz `max_offers_per_run`. Nie obchodź tego. |
| „Strona nie zwróciła ofert" | `--debug-dump` i popraw ścieżki/selektory |
| Puste opisy | `search.fetch_details` musi być `true` |
| Za wolno | to jest cecha, nie usterka — 40 ofert × ~3 s to ~2–3 minuty |
| Same miniatury zamiast dużych zdjęć | popraw `image_url_rules` (Otodom trzyma rozmiar w URL-u jako `;s=SZERxWYS`) |
| Raport pokazuje „usunięte", choć oferty są | przebieg nie objął całego zbioru wyników — podnieś `max_pages`/`max_offers_per_run` albo `mark_removed_after_missing_runs` |

Wykrywanie usunięć jest wyłączane automatycznie, gdy przebieg nie objął całego
zbioru wyników (limit ofert lub stron) — raport mówi o tym wprost.
