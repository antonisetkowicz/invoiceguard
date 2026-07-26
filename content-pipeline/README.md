# /content — autonomiczny pipeline Instagram Reels

Od tematu do opublikowanego Reelsa: research → scenariusz → lektor → animacje →
napisy → muzyka → miniatura → QA → publikacja → metryki.

**Zero płatnych subskrypcji, zero kart kredytowych.** Każdy krok stoi na
narzędziach darmowych albo open source. Jedyny „sekret" w `.env` to token
Instagram Graph API — bezpłatny, wymaga jednorazowej konfiguracji.

```bash
/content                                  # temat wybiera researcher
/content jak oszczędzać na fakturach B2B  # temat narzucony
/content batch 5                          # 5 Reelsów, jeden checkpoint na końcu
/content approve                          # publikuj to, co czeka na akceptację
/content reject za wolne tempo hooka      # wróć do scenariusza z feedbackiem
```

---

## 1. Instalacja (jednorazowo, ~10 minut)

### Wymagania systemowe

| Narzędzie | Po co | Instalacja |
|---|---|---|
| Python 3.10+ | agenci 1–10 | preinstalowany na macOS/Linux |
| Node.js 18+ | Remotion (animacje) | https://nodejs.org — LTS, darmowe |
| ffmpeg | napisy, miks audio, muksowanie | `brew install ffmpeg` / `apt install ffmpeg` |

ffmpeg **nie jest twardym wymogiem systemowym** — jeśli go nie masz, pipeline
użyje statycznej binarki z pakietu `imageio-ffmpeg` (instalowanej pip-em).
Wersja systemowa jest jednak szybsza i dokłada `ffprobe`.

### Pakiety

```bash
pip install -r content-pipeline/requirements.txt
cd content-pipeline/remotion && npm install && cd ../..
```

Albo jednym poleceniem — skrypt sam doinstaluje, czego brakuje:

```bash
python3 content-pipeline/preflight.py --install
```

### Sprawdzenie gotowości

```bash
python3 content-pipeline/preflight.py
```

```
✅ Python ≥ 3.10                    3.11.15
✅ Node.js ≥ 18 (Remotion)          v22.22.2
✅ ffmpeg                           /usr/bin/ffmpeg (ass + sidechaincompress OK)
✅ pip: edge-tts                    TTS — lektor (krok 3)
⚠️  Muzyka (assets/music/)           pusto — Reels bez podkładu
⚠️  Instagram Graph API              brak IG_ACCESS_TOKEN — publikacja trybem ręcznym
```

`⚠️` nie blokuje runu — pipeline zdegraduje się gracefully. `❌` blokuje.

---

## 2. Muzyka — pobierz raz, ręcznie

Pipeline **nigdy nie pobiera muzyki automatycznie**. To celowe: licencja
ścieżki, którą publikujesz, jest Twoją odpowiedzialnością, a jedyny sposób, by
mieć co do niej pewność, to wziąć ją świadomie z legalnego źródła.

Dwa w 100% darmowe, royalty-free źródła:

1. **YouTube Audio Library** — https://studio.youtube.com → menu boczne →
   *Audio library*. Filtruj po „Attribution not required". Wymaga konta Google,
   nie wymaga płatności.
2. **Pixabay Music** — https://pixabay.com/music/. Bez konta, licencja Pixabay
   (użytek komercyjny bez atrybucji).

Pobierz **3–5 utworów**, tempo 90–120 BPM, bez wokalu (wokal gryzie się z
lektorem) i wrzuć do:

```
content-pipeline/assets/music/
```

Pipeline losuje utwór deterministycznie per run — ten sam run zawsze dostanie
ten sam podkład. Konkretny utwór wymusisz flagą:

```bash
python3 content-pipeline/agents/06_audio_mixer.py --run-dir <RUN_DIR> --track nazwa.mp3
```

Bez muzyki Reels i tak powstanie — dostaniesz wpis w `HUMAN_ACTION_REQUIRED.md`.

---

## 3. Token Instagram Graph API — krok po kroku

To jedyna część, której nie da się zautomatyzować: wymaga logowania, 2FA i
klikania w panelu Meta. Zrobisz to raz, token odnawiasz co ~60 dni.

**Publikowanie przez Graph API jest darmowe** dla własnego konta. Meta nie
pobiera opłat za Content Publishing API — jedyne ograniczenie to **50 postów
na 24 h**, czego przy Reelsach nie dotkniesz.

### 3.1. Konto musi być Business albo Creator
Instagram → Ustawienia → Typ konta → *Przełącz na konto profesjonalne*.
Konto prywatne **nie zadziała** z API.

### 3.2. Połącz Instagram ze stroną na Facebooku
API wymaga strony FB jako pośrednika.
1. Utwórz stronę na https://facebook.com/pages/create (darmowe, może być pusta).
2. Instagram → Ustawienia → *Udostępnianie w innych aplikacjach* → Facebook →
   połącz ze stroną.

### 3.3. Utwórz aplikację w Meta for Developers
1. https://developers.facebook.com → *My Apps* → *Create App*.
2. Typ: **Business**.
3. W panelu aplikacji dodaj produkt **Instagram** → *API setup with Instagram
   login* (albo *Instagram Graph API*, zależnie od wariantu panelu).

### 3.4. Wygeneruj token z właściwymi uprawnieniami
W *Graph API Explorer* (https://developers.facebook.com/tools/explorer):
1. Wybierz swoją aplikację.
2. Uprawnienia (zaznacz wszystkie):
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
   - `instagram_manage_insights` — potrzebne do kroku 10 (metryki)
3. *Generate Access Token* → zaloguj się i zaakceptuj.

To jest token **krótkotrwały (1 h)**. Wymień go na długotrwały (60 dni):

```bash
curl -s "https://graph.facebook.com/v23.0/oauth/access_token\
?grant_type=fb_exchange_token\
&client_id=<APP_ID>\
&client_secret=<APP_SECRET>\
&fb_exchange_token=<KROTKI_TOKEN>"
```

### 3.5. Znajdź swoje IG_USER_ID

```bash
# 1) ID strony FB
curl -s "https://graph.facebook.com/v23.0/me/accounts?access_token=<DLUGI_TOKEN>"

# 2) powiązane konto Instagram
curl -s "https://graph.facebook.com/v23.0/<PAGE_ID>\
?fields=instagram_business_account&access_token=<DLUGI_TOKEN>"
```

Wartość `instagram_business_account.id` to Twoje `IG_USER_ID`.

### 3.6. Wpisz do `.env` w katalogu głównym repo

```bash
IG_ACCESS_TOKEN=EAAG...        # długotrwały token (60 dni)
IG_USER_ID=17841400000000000   # ID konta Business
```

Sprawdź:

```bash
python3 content-pipeline/preflight.py
# ✅ Instagram Graph API   @twoj_profil (BUSINESS)
```

> **Token wygasa po 60 dniach.** Kiedy krok 9 zacznie zwracać błąd
> uwierzytelnienia, powtórz punkt 3.4 (wymiana na długotrwały) i podmień
> wartość w `.env`.

---

## 4. Hosting wideo — brakujący element układanki

Instagram Graph API **nie przyjmuje pliku**. Przyjmuje `video_url` i pobiera
plik sam, więc gotowy `.mp4` musi być pod publicznym adresem HTTPS.

Pipeline próbuje po kolei trzech darmowych backendów (`lib/hosting.py`):

| Backend | Konfiguracja w `.env` | Uwagi |
|---|---|---|
| `public_base_url` | `PUBLIC_BASE_URL`, `PUBLIC_UPLOAD_DIR` | Masz własny hosting statyczny (Vercel, GitHub Pages, VPS). Najczystsze. |
| `github_release` | `CONTENT_ASSETS_REPO=user/repo` (+ `gh` CLI zalogowany) | Plik ląduje jako asset Release'u. Limit 2 GB. |
| `catbox` | `CONTENT_ALLOW_CATBOX=false` żeby wyłączyć | Anonimowy hosting, limit 200 MB, bez konta. Usługa zewnętrzna bez SLA. |

Opcjonalnie: `CONTENT_ASSETS_TAG` (domyślnie `content-assets`).

**Świadomość ryzyka:** każdy z tych wariantów oznacza, że plik jest publicznie
dostępny dla każdego, kto zna URL — inaczej Instagram go nie pobierze. To
wymóg API, nie wybór pipeline'u. Jeśli Ci to nie odpowiada, ustaw
`"provider": "manual"` w `config.json` i wrzucaj Reelsy z telefonu.

Gdy żaden backend nie zadziała, publisher **sam** przechodzi w tryb ręczny i
dopisuje do `HUMAN_ACTION_REQUIRED.md` ścieżkę pliku plus gotowy caption.

---

## 5. Uruchomienie

Normalnie odpalasz `/content` w Claude Code i orkiestrator robi resztę.
Każdy krok da się jednak uruchomić samodzielnie — przydaje się przy debugowaniu:

```bash
RUN=content-pipeline/logs/$(date -u +%Y-%m-%dT%H-%M-%SZ)
mkdir -p $RUN

python3 content-pipeline/agents/01_researcher.py --run-dir $RUN --collect
#   → tu subagent LLM content-researcher zapisuje brief.json
python3 content-pipeline/agents/01_researcher.py --run-dir $RUN --validate
#   → tu subagent LLM content-scriptwriter zapisuje script.json
python3 content-pipeline/agents/02_scriptwriter.py  --run-dir $RUN
python3 content-pipeline/agents/03_voice_generator.py --run-dir $RUN
python3 content-pipeline/agents/04_visual_builder.py --run-dir $RUN
python3 content-pipeline/agents/05_caption_burner.py --run-dir $RUN
python3 content-pipeline/agents/06_audio_mixer.py   --run-dir $RUN
python3 content-pipeline/agents/07_thumbnail_generator.py --run-dir $RUN
python3 content-pipeline/agents/08_qa_checker.py    --run-dir $RUN

# ↑ STOP — obejrzyj output/<TS>_<slug>.mp4, potem:
python3 content-pipeline/agents/08_qa_checker.py --run-dir $RUN --approve
python3 content-pipeline/agents/09_publisher.py  --run-dir $RUN
python3 content-pipeline/agents/10_analytics_tracker.py --run-dir $RUN
```

Każdy agent wypisuje na stdout **jeden obiekt JSON** — łatwo wpiąć w skrypt.

---

## 6. Architektura

```
.claude/commands/content.md            # orkiestrator (slash command)
.claude/agents/content-researcher.md   # krok 1 — LLM + WebSearch
.claude/agents/content-scriptwriter.md # krok 2 — LLM

content-pipeline/
├── preflight.py            # kontrola środowiska
├── config.example.json     # → skopiuj do config.json
├── requirements.txt
├── lib/
│   ├── runio.py            # RUN_DIR, state.json, log, .env, eskalacje
│   ├── ffmpeg.py           # binarki + probe (z fallbackiem bez ffprobe)
│   ├── ig_api.py           # Instagram Graph API
│   ├── hosting.py          # publiczny URL dla video_url
│   └── db.py               # SQLite: posts + metrics
├── agents/                 # 01…10, każdy: --run-dir, JSON na stdout
├── remotion/               # projekt Remotion (odseparowany od Next.js w root)
├── assets/music/           # muzyka pobrana ręcznie
├── output/                 # gotowe .mp4 + .jpg
├── logs/<TS>/              # artefakty runu
└── data/content.db         # baza postów i metryk
```

Podział jest celowy: **kroki 1–2 są kreatywne** (LLM, potrzebują WebSearch i
osądu), **kroki 3–10 są deterministyczne** (czysty Python — powtarzalne,
testowalne, uruchamialne z crona bez modelu).

### Kroki

| # | Agent | Narzędzie | Wejście → wyjście |
|---|---|---|---|
| 1 | researcher | Google Trends RSS + WebSearch | `trends.json` → `brief.json` |
| 2 | scriptwriter | LLM + walidator | `brief.json` → `script.json` |
| 3 | voice-generator | edge-tts → Piper → espeak-ng | `script.json` → `voice.mp3` + timestampy |
| 4 | visual-builder | Remotion | `script.json` → `visuals.mp4` 1080×1920 |
| 5 | caption-burner | faster-whisper + ffmpeg/libass | → `captioned.mp4` |
| 6 | audio-mixer | ffmpeg sidechaincompress | → `final.mp4` |
| 7 | thumbnail-generator | Remotion Still | → `thumbnail.jpg` |
| 8 | qa-checker | ffprobe + **człowiek** | → `qa_report.json` |
| 9 | publisher | Instagram Graph API | → `publish.json` |
| 10 | analytics-tracker | Instagram Insights | → `analytics.json` + SQLite |

### Pętla uczenia się
Krok 10 zapisuje metryki do `data/content.db`. Krok 1 czyta z niej
`top_performers` i przekazuje researcherowi, które hooki realnie dowoziły
zasięg. Im więcej opublikowanych Reelsów, tym lepszy research.

---

## 7. Konfiguracja

```bash
cp content-pipeline/config.example.json content-pipeline/config.json
```

Najczęściej zmieniane:

| Pole | Domyślnie | Uwagi |
|---|---|---|
| `voice` | `pl-PL-MarekNeural` | `pl-PL-ZofiaNeural` = głos żeński. Pełna lista: `03_voice_generator.py --list-voices` |
| `voice_rate` | `+8%` | szybciej = dynamiczniej, ale mniej zrozumiale |
| `captions.font` | `DejaVu Sans` | **musi być zainstalowana w systemie** (`fc-list`). macOS: `Helvetica Neue` |
| `captions.font_size` | `92` | dla 1080 px szerokości |
| `captions.margin_v` | `420` | odstęp od dołu — trzyma napisy nad UI Instagrama |
| `captions.words_per_cue` | `3` | ile słów naraz na ekranie |
| `audio.music_gain_db` | `-16` | głośność podkładu |
| `handle` | — | znak wodny `@twoj_profil` w rogu |

Kolory napisów są w formacie ASS `&HAABBGGRR` — **odwrotnie niż HTML**.
`&H0000E5FF` to amber `#FFE500`.

---

## 8. Cron — codzienny Reels

Kroki 1–8 da się zautomatyzować; publikacja świadomie zostaje przy człowieku.

```cron
# codziennie 7:00 — wyprodukuj Reelsa i zatrzymaj się na akceptacji
0 7 * * * cd /sciezka/do/invoiceguard && claude -p "/content" --dangerously-skip-permissions >> content-pipeline/logs/cron.log 2>&1

# co 6 h — odśwież metryki opublikowanych Reelsów (Reels rośnie kilka dni)
0 */6 * * * cd /sciezka/do/invoiceguard && python3 content-pipeline/agents/10_analytics_tracker.py --run-dir content-pipeline/logs/_cron --refresh-all >> content-pipeline/logs/analytics.log 2>&1
```

---

## 9. Rozwiązywanie problemów

| Objaw | Przyczyna | Naprawa |
|---|---|---|
| `Nie znaleziono ffmpeg` | brak binarki | `brew install ffmpeg` albo `pip install imageio-ffmpeg` |
| Napisy się nie pojawiły | ffmpeg bez libass | `ffmpeg -filters \| grep " ass "` — jeśli pusto, zainstaluj pełny build |
| Napisy w złej czcionce | `captions.font` nie istnieje w systemie | sprawdź `fc-list : family`, wpisz istniejącą nazwę |
| `edge-tts` pada | brak internetu albo proxy blokujące WebSocket | zainstaluj `piper-tts` + model głosu; ostatecznie zadziała `espeak-ng` (jakość podglądowa) |
| Lektor brzmi robotycznie | zadziałał fallback `espeak-ng` | sprawdź `quality` w `voice.json` — `placeholder` = nie publikuj, napraw edge-tts/Piper |
| Napisy lekko się rozjeżdżają | brak Whispera → czasy szacowane | sprawdź `timing_quality` w `captions.json`; `pip install faster-whisper` |
| Krok 4 pada na `npm install` | brak Node 18+ | zainstaluj Node LTS |
| Whisper mieli w nieskończoność | model `small` na słabym CPU | `"whisper_model": "tiny"` w `config.json` |
| `Graph API 190` | token wygasł | powtórz punkt 3.4 |
| `Graph API 9004` | `video_url` niedostępny publicznie | sprawdź backend hostingu (rozdział 4) |
| Kontener utknął na `IN_PROGRESS` | Meta przetwarza wideo | to normalne, do kilku minut; timeout to 7 min |
| Publikacja przechodzi w `manual` | brak tokenu albo hostingu | przeczytaj `reasons` w `publish.json` |

---

## 10. Czego ten pipeline NIE robi

Uczciwa lista ograniczeń:

- **Nie ocenia, czy wideo dobrze wygląda.** Krok 8 sprawdza metadane
  (proporcje, długość, kodeki, rozmiar) — nie treść obrazu. Obejrzenie pliku
  przed akceptacją należy do Ciebie.
- **Nie gwarantuje zasięgu.** Żaden pipeline tego nie robi.
- **Ayrshare nie jest tu darmową opcją.** Darmowy plan Ayrshare obejmuje
  wyłącznie pojedyncze zdjęcia; publikowanie wideo zaczyna się od planu
  płatnego, a stary plan Basic (20 postów/mies.) jest zamknięty dla nowych
  kont. Kod integracji jest w `09_publisher.py` za flagą `--provider ayrshare`,
  ale ścieżką domyślną jest Graph API, a zapasową — publikacja ręczna.
- **Token IG wygasa co 60 dni** i musisz go odnowić ręcznie. Automatyczne
  odświeżanie wymagałoby przechowywania `APP_SECRET`, czego świadomie unikamy.
- **Pollinations.ai jest dodatkiem, nie fundamentem.** Darmowe API bez SLA —
  gdy nie odpowie, scena degraduje się do gradientu i pipeline leci dalej.
- **Muzyka nie jest pobierana automatycznie** — patrz rozdział 2.
- **Fallbacki degradują jakość i mówią o tym wprost.** Gdy edge-tts i Piper są
  niedostępne, lektora robi `espeak-ng` (`voice.json` → `quality:
  "placeholder"`). Gdy nie ma Whispera ani znaczników z TTS, czasy napisów są
  szacowane z długości audio (`captions.json` → `timing_quality: "estimated"`).
  Oba tryby są po to, żeby dało się przejść pipeline bez sieci i obejrzeć
  montaż — **nie do publikacji**. Sprawdzaj te pola przed akceptacją w kroku 8.
