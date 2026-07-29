# SiteAudit — architektura wersji self-serve

Produkt: **audyt strony WWW bez udziału człowieka**. User wkleja URL → silnik zbiera dane
(scraper + Lighthouse) → Claude analizuje UX/SEO/copy → panel wyników + PDF z listą poprawek
i wyceną wdrożenia. Płatność przez Stripe (BLIK / Przelewy24 / karta).

Wszystko żyje w istniejącej aplikacji InvoiceGuard (Next.js 15 + Prisma), pod własną
przestrzenią nazw `/audyt` i `/api/audit/*`, żeby nie mieszać się z panelem faktur.

---

## 1. Decyzje architektoniczne (i dlaczego)

| Decyzja | Wybór | Uzasadnienie |
|---|---|---|
| Gdzie mieszka produkt | Ta sama apka Next.js, prefix `/audyt` | Jedna baza, jeden deploy, zero dodatkowych kosztów. InvoiceGuard zostaje nietknięty. |
| Uwierzytelnianie | **Brak konta.** Dostęp do raportu przez sekretny token w URL | Największe tarcie w self-serve to rejestracja. Token (32 B losowe, base64url) jest wysyłany mailem i wystarcza. |
| Wykonanie audytu | **Kolejka w bazie + osobny worker** (`npm run audit:worker`) | Audyt trwa 40–150 s (Lighthouse + Claude). To nie mieści się w request/response ani w limitach serverless. Kolejka w DB = zero Redis, zero kosztów. |
| Lighthouse | **PageSpeed Insights API** (darmowe, bez klucza; klucz opcjonalny dla wyższego limitu), lokalny Lighthouse jako opcja | Nie wymaga Chrome na produkcji. `AUDIT_LIGHTHOUSE_PROVIDER=psi\|local\|off`. |
| Scraper | `fetch` + `cheerio` (bez headless browser) | Wystarcza do meta/nagłówków/copy/CTA/formularzy/linków. Strony SPA łapie i tak PSI (renderuje JS) — z tego bierzemy sygnał o pustym HTML. |
| Analiza AI | Claude `claude-opus-5`, structured outputs (`output_config.format` = json_schema) | Gwarantowany kształt JSON → można go bezpiecznie zapisać w bazie i wyrenderować. |
| PDF | `@react-pdf/renderer` + font Inter (WOFF, latin-ext) z npm | Czysty Node, bez Chromium → działa na Vercelu, Renderze, w Dockerze. Polskie znaki (ą/ć/ę/ł/ń/ó/ś/ź/ż) osadzone w pliku. |
| Płatności | Stripe Checkout, `mode=payment`, `price_data` inline | Zero produktów do klikania w panelu Stripe — cennik żyje w kodzie (`src/lib/audit/config.ts`). |
| E-mail | Resend, **opcjonalny** | Bez `RESEND_API_KEY` link do raportu i tak jest pokazany na ekranie i zapisany w bazie — produkt działa bez skrzynki. |

### Świadome ograniczenie
Baza to **SQLite** (`prisma/schema.prisma`, `provider = "sqlite"` — mimo tego, co mówi
`CLAUDE.md`). Kolejka jest napisana pod jednego workera (claim przez `updateMany` +
warunek na statusie). Przy większym ruchu: zmień provider na Postgres i podnieś liczbę
workerów — kod claimowania jest już atomowy i zadziała bez zmian.

---

## 2. Ścieżka użytkownika (funnel)

```
/audyt                     landing: obietnica + cennik + formularz
   │  URL + e-mail + pakiet + zgody
   ▼
POST /api/audit/orders
   ├── tier=free  → AuditRun(queued) od razu  ──────────────┐
   └── tier=basic|pro → Stripe Checkout                     │
                            │ BLIK / P24 / karta            │
                            ▼                               │
              POST /api/audit/stripe/webhook                │
              (checkout.session.completed)                  │
                            │ oznacz opłacone               │
                            ▼                               │
                    AuditRun(queued) ────────────────────────┤
                                                             ▼
                                                    WORKER (pętla)
                                                  1 fetch/scrape
                                                  2 lighthouse (PSI)
                                                  3 heurystyki + score
                                                  4 Claude (analiza)
                                                  5 wycena wdrożenia
                                                  6 zapis findings → done
                                                             │
                                                             ▼
/audyt/raport/<token>        panel: live progress → wyniki → PDF
   └── tier=free → teaser (3 znaleziska) + przycisk „Odblokuj"
```

Po powrocie ze Stripe `/audyt/dziekujemy?token=…&session_id=…` **sam potwierdza płatność**
przez API (`/api/audit/checkout/confirm`), żeby opóźniony webhook nie blokował klienta.
Obie ścieżki (webhook i confirm) są idempotentne.

---

## 3. Model danych

```
AuditOrder ─1:N─ AuditRun ─1:N─ AuditFinding
                     └───1:N─ AuditEvent   (timeline dla panelu live)
```

| Model | Rola | Kluczowe pola |
|---|---|---|
| `AuditOrder` | zamówienie + klient + płatność | `publicToken` (unikalny, dostęp do raportu), `url`, `email`, `tier`, `paymentStatus`, `stripeSessionId`, `amountGrosz` |
| `AuditRun` | jedno wykonanie silnika | `status` (queued/running/done/failed), `stage`, `progress`, `attempts`, `workerId`, `heartbeatAt`, `scores`, `scrapeData`, `lighthouseData`, `analysis` |
| `AuditFinding` | pojedyncza poprawka do wdrożenia | `area`, `severity`, `title`, `problem`, `recommendation`, `evidence`, `impact`, `effortHours`, `priceGrosz`, `isTeaser` |
| `AuditEvent` | log kroków (widoczny w panelu) | `stage`, `message`, `level` |

Upgrade pakietu (free → basic → pro) **nie nadpisuje historii**: powstaje nowy `AuditRun`,
a raport zawsze pokazuje najnowszy zakończony run danego zamówienia.

---

## 4. Silnik wykonawczy (`src/lib/audit/`)

| Plik | Odpowiedzialność |
|---|---|
| `config.ts` | cennik, definicje pakietów, stawka godzinowa, limity, ENV |
| `url.ts` | normalizacja URL + **ochrona przed SSRF** (blokada localhost, 10./172.16./192.168., 169.254.169.254, tylko http/https, limit przekierowań i rozmiaru) |
| `scraper.ts` | pobranie strony, `cheerio`, ekstrakcja ~40 sygnałów (title/meta/OG/H1-H3/obrazy bez alt/CTA/formularze/telefon/e-mail/RODO/social/waga HTML), crawl podstron wg pakietu |
| `lighthouse.ts` | PSI mobile+desktop → Core Web Vitals + 4 kategorie; provider `psi \| local \| off`, degraduje się miękko |
| `heuristics.ts` | ~30 deterministycznych reguł (te same wejścia = ten sam wynik) + score 6 kategorii |
| `analyzer.ts` | Claude `claude-opus-5`, structured JSON: streszczenie, znaleziska, quick wins, (pro) przepisane teksty + roadmapa 30/60/90 |
| `pricing.ts` | znalezisko → godziny → PLN; sumaryczna wycena wdrożenia + widełki |
| `engine.ts` | orkiestracja 6 etapów, zapis progresu i eventów, obsługa błędów |
| `queue.ts` | atomowy claim, heartbeat, retry z backoffem, odzyskiwanie zawieszonych runów |
| `report.ts` | DTO raportu + **bramka pakietu** (free = teaser) |
| `pdf.tsx` | dokument PDF (react-pdf) |
| `stripe.ts` | klient + sesje Checkout + mapowanie cennika |
| `mailer.ts` | Resend (opcjonalnie), szablon „raport gotowy" |

**Determinizm:** heurystyki liczą score, Claude **nie ustala punktacji** — dostaje policzone
fakty i pisze diagnozę + rekomendacje. Dzięki temu dwa audyty tej samej strony dają
porównywalne liczby, a nie losowe.

**Wycena:** każde znalezisko ma `effortHours` (Claude szacuje w widełkach zdefiniowanych
per typ) × `AUDIT_HOURLY_RATE_PLN` (domyślnie 180 zł/h) → cena pozycji. Suma = „wycena
wdrożenia" w PDF, z widełkami ±25 % i jasnym zastrzeżeniem, że to estymata.

---

## 5. Pakiety i cennik (`src/lib/audit/config.ts`)

| | **Free** (lead magnet) | **Basic — 99 zł** | **Pro — 299 zł** |
|---|---|---|---|
| Strony w analizie | 1 (strona główna) | do 3 | do 8 |
| Lighthouse | mobile | mobile + desktop | mobile + desktop |
| Znaleziska | 3 najważniejsze | wszystkie | wszystkie |
| Wycena wdrożenia | ❌ | ✅ | ✅ |
| PDF | ❌ | ✅ | ✅ |
| Gotowe teksty (copy) | ❌ | ❌ | ✅ |
| Roadmapa 30/60/90 | ❌ | ❌ | ✅ |

Ceny brutto w groszach w kodzie; zmiana ceny = zmiana jednej stałej.

---

## 6. Bezpieczeństwo i nadużycia

- **SSRF** — silnik pobiera URL podany przez obcą osobę. `url.ts` rozwiązuje DNS i odrzuca
  adresy prywatne/loopback/link-local przed każdym żądaniem, także po przekierowaniu.
- **Limity** — max 3 darmowe audyty / e-mail / 24 h i 10 / IP / 24 h (liczone w bazie).
- **Token raportu** — 32 losowe bajty; brak enumeracji, brak listowania cudzych raportów.
- **Webhook Stripe** — weryfikacja podpisu, `runtime = "nodejs"`, surowe body.
- **Sekrety** — wyłącznie ENV (`ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `PSI_API_KEY`, `AUDIT_WORKER_SECRET`).
- **Koszt AI** — jedno wywołanie Claude na run, wejście przycięte do ~40 kB faktów
  (nie surowy HTML), `max_tokens` ograniczony.

---

## 7. Uruchomienie

```bash
npm run db:push          # dołoży 4 nowe tabele
npm run dev              # aplikacja
npm run audit:worker     # silnik (osobny proces — musi działać, żeby audyty ruszyły)
```

Produkcja: `render.yaml` dostaje drugi serwis typu `worker` z komendą `npm run audit:worker`.
Szczegóły, pełna lista ENV i konfiguracja Stripe: `README.audyt.md`.
