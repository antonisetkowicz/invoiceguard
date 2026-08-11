# Monday — tygodniowy raport o okazjach biznesowych w AI

System, który **co tydzień** przegląda nowe filmy i strony o AI i biznesie,
wybiera z nich to, co realnie da się zrobić i sprzedać, i **wysyła raport na
Twoją skrzynkę**. W poniedziałek o 7:00 mail **sam otwiera się na Twoim
komputerze**.

Odbiorca raportu: adres z `MONDAY_REPORT_TO` w `.env`
(ustawiony docelowo na `antonisetkowicz25@gmail.com`).

---

## Jak to działa

```
/monday
  1. ai-video-scout      → run/<TS>/videos.json         (nowe filmy z 7 dni + co z nich wynika)
  2. ai-web-scout        → run/<TS>/articles.json       (premiery modeli, ceny, nisze, regulacje, dotacje)
  3. opportunity-analyst → run/<TS>/opportunities.json  (scoring + bramka realności + pierwszy krok)
  4. monday-reporter     → run/<TS>/monday/report.html  (mail: inline CSS, ≤ ~700 słów)
                           run/<TS>/monday/report.md
                           run/<TS>/monday/subject.txt
  5. monday-mailer       → wysyłka SMTP albo draft w Gmailu + etykieta `monday`
                           run/<TS>/monday/delivery.json
```

Subagenty są izolowane — komunikują się wyłącznie plikami w `run/<TS>/`
(ten sam wzorzec, co `/autobiznes`). Katalog `run/*` jest gitignorowany.

Plik `monday_seen.json` (root, gitignorowany) pamięta, co już było w
poprzednich raportach — dzięki temu ten sam film nie wraca co tydzień.

### Uruchomienie ręczne
```bash
/monday                                   # pełny przebieg + wysyłka
/monday --dry-run                         # raport powstaje, NIC nie wychodzi na skrzynkę
/monday zakres: 14d, tematy: agenci AI dla biur rachunkowych
/monday do: inny@adres.pl
```

---

## Konfiguracja (jednorazowo)

### 1. Adres i wysyłka — `.env` w root repo
```bash
MONDAY_REPORT_TO=antonisetkowicz25@gmail.com
MONDAY_SMTP_USER=antonisetkowicz25@gmail.com
MONDAY_SMTP_PASS=xxxx xxxx xxxx xxxx      # HASŁO APLIKACJI Google, nie hasło do konta
# opcjonalne:
MONDAY_SMTP_HOST=smtp.gmail.com
MONDAY_SMTP_PORT=465
MONDAY_FROM_NAME=Monday
```

**Hasło aplikacji** (2 minuty, wymaga włączonej weryfikacji dwuetapowej):
<https://myaccount.google.com/apppasswords> → nazwa „Monday” → skopiuj
16-znakowy kod do `MONDAY_SMTP_PASS`.

Bez `MONDAY_SMTP_*` system **nadal działa** — raport ląduje jako **wersja
robocza w Gmailu** z etykietą `monday`, a Ty klikasz „Wyślij”/czytasz go
w draftach. To jedyna różnica.

Test konfiguracji bez wysyłki:
```bash
python3 scripts/monday/send_report.py --html run/<TS>/monday/report.html \
        --subject-file run/<TS>/monday/subject.txt --dry-run
```

### 2. Etykieta `monday` w Gmailu (opcjonalna, wygoda)
Gmail → Ustawienia → Filtry → *Utwórz nowy filtr*:
- **Temat**: `[Monday]`
- akcja: *Zastosuj etykietę* → `monday`, *Nigdy nie oznaczaj jako spam*,
  *Zawsze oznaczaj jako ważne*.

Skrypt otwierający szuka po **temacie**, nie po etykiecie — więc działa
nawet bez filtra.

### 3. Automatyczne otwieranie maila w poniedziałek o 7:00

**macOS** (launchd):
```bash
bash scripts/monday/install-macos.sh
```
Instaluje dwa zadania: otwieranie raportu (pon. 07:00) i — jeśli masz CLI
`claude` w `PATH` — generowanie raportu (pon. 05:30). Żeby Mac sam się
obudził przed siódmą:
```bash
sudo pmset repeat wakeorpoweron M 06:55:00
```

**Windows** (Harmonogram zadań):
```powershell
powershell -ExecutionPolicy Bypass -File scripts\monday\install-windows.ps1
```

**Linux** (cron użytkownika):
```bash
bash scripts/monday/install-linux.sh
```

Test bez czekania do poniedziałku:
```bash
bash scripts/monday/open-monday.sh            # macOS/Linux
powershell -File scripts\monday\open-monday.ps1   # Windows
```
Otwiera Gmaila na wyszukiwaniu `subject:"[Monday]" newer_than:8d`, czyli
na najnowszym raporcie. Jeśli raport powstał na tym samym komputerze,
otwiera też lokalną kopię `report.html`.

---

## Kto generuje raport co tydzień — trzy opcje

| Opcja | Kiedy działa | Zaleta | Wada |
|---|---|---|---|
| **Routine w chmurze** (Claude Code on the web) | zawsze, komputer może być wyłączony | nic nie musi chodzić lokalnie | wymaga zmiennych środowiskowych SMTP (patrz niżej) |
| **launchd/cron lokalnie** (pon. 05:30) | gdy komputer jest włączony/wybudzony | pełna kontrola, `.env` już masz | Mac musi wstać przed 5:30 |
| **ręcznie** `/monday` | kiedy chcesz | zero harmonogramu | trzeba pamiętać |

### Routine w chmurze — jedno „ale"

Utworzona Routine `Monday — tygodniowy raport AI`
(`trig_01VAvHScE2V2vwEioN7apuKe`) odpala się **w poniedziałki 05:30 czasu
polskiego** (`30 3 * * 1` UTC — zimą wypada 04:30 lokalnie).

Sesja z harmonogramu startuje ze **świeżego klona repo**, więc:
- **nie ma pliku `.env`** (jest gitignorowany — i dobrze),
- **nie ma konektora Gmail**, czyli nie ma fallbacku „draft".

Żeby raport z chmury realnie wychodził, ustaw w **Environment variables**
tego środowiska (panel Claude Code on the web → Environments):
`MONDAY_REPORT_TO`, `MONDAY_SMTP_USER`, `MONDAY_SMTP_PASS`.
`send_report.py` czyta zmienne środowiskowe **przed** `.env`, więc to
wystarczy — nic w kodzie nie trzeba zmieniać.

Dopóki tych zmiennych nie ma, Routine wygeneruje raport i **jawnie napisze,
że nie miała czym go wysłać** (nie udaje wysyłki). Jeśli wolisz nie trzymać
hasła aplikacji w chmurze — wyłącz Routine i zostaw generowanie lokalne
(launchd/cron), gdzie `.env` już działa.

Otwieranie maila o 7:00 jest **niezależne** od tego, kto raport wygenerował —
skrypt po prostu otwiera skrzynkę.

### Wyłączenie
```bash
bash scripts/monday/install-macos.sh --uninstall     # macOS
bash scripts/monday/install-linux.sh --uninstall     # Linux
powershell -File scripts\monday\install-windows.ps1 -Odinstaluj   # Windows
```
Routine w chmurze: powiedz w sesji „usuń Routine Monday” albo wyłącz ją
w panelu zadań.

---

## Co jest w raporcie

1. **⚡ Zrób to w tym tygodniu** — 3 konkretne kroki po ≤2 h (to jest sens
   całego raportu).
2. **Okazje** — dla kogo, jak zarabia (widełki PLN), czas do pierwszej
   złotówki, ocena, źródła.
3. **Z filmów** — co pokazano i co z tego wynika.
4. **Z sieci** — nowe modele/API, ceny, produkty, regulacje (AI Act, RODO),
   dotacje (PARP/NCBR/KPO).
5. **Na radarze** i **Odrzucone i dlaczego** — żeby nie wracać co tydzień do
   tych samych ślepych uliczek.

Zasady jakości wymuszone na agentach: każda liczba ma źródło, brak źródła =
brak liczby, niepewne rzeczy oznaczone jako „niepotwierdzone”, chudy tydzień
opisany wprost zamiast dopychany wypełniaczem.

---

## Rozwiązywanie problemów

| Objaw | Przyczyna / co zrobić |
|---|---|
| Mail nie przyszedł, jest draft w Gmailu | brak `MONDAY_SMTP_USER`/`MONDAY_SMTP_PASS` w `.env` — to zachowanie zamierzone (fallback) |
| `BŁĄD UWIERZYTELNIENIA` przy wysyłce | użyto zwykłego hasła zamiast **hasła aplikacji** Google |
| Przeglądarka nie otworzyła się w poniedziałek | komputer spał (launchd odpali po wybudzeniu; cron nie nadrabia) — ustaw `pmset repeat wakeorpoweron` |
| Otworzyło się złe konto Gmail | brak `MONDAY_REPORT_TO` w `.env` → skrypt użył `u/0`; ustaw adres albo podaj argumentem |
| Raport pusty / bardzo krótki | chudy tydzień — to celowe, nie błąd; sprawdź `run/<TS>/log.md`, co odrzucono |
| Logi otwierania | `~/.monday-open.log`, `~/.monday-run.out.log` |

---

## Pliki

```
.claude/commands/monday.md          orkiestrator (komenda /monday)
.claude/agents/ai-video-scout.md    krok 1 — filmy
.claude/agents/ai-web-scout.md      krok 2 — strony
.claude/agents/opportunity-analyst.md krok 3 — wybór okazji
.claude/agents/monday-reporter.md   krok 4 — HTML/MD raportu
.claude/agents/monday-mailer.md     krok 5 — doręczenie + etykieta
scripts/monday/send_report.py       wysyłka SMTP (bez zależności zewnętrznych)
scripts/monday/open-monday.sh|.ps1  otwieranie raportu na komputerze
scripts/monday/install-*.sh|.ps1    harmonogram: macOS / Windows / Linux
monday_seen.json                    pamięć znalezisk (gitignorowany)
```
