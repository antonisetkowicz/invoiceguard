# SiteAudit — self-serve audyt strony WWW

Sprzedaż audytu strony bez Twojego udziału: klient wkleja adres → silnik zbiera dane
(scraper + Lighthouse) → Claude pisze diagnozę → panel wyników i PDF z listą poprawek
i wyceną wdrożenia. Płatność Stripe (BLIK / Przelewy24 / karta).

Architektura i uzasadnienie decyzji: **[ARCHITECTURE.audyt.md](./ARCHITECTURE.audyt.md)**.

---

## Szybki start (lokalnie)

```bash
npm install
npm run db:push          # dołoży 4 tabele audytu do istniejącej bazy
npm run audit:smoke      # test silnika bez sieci — powinno być 40× ✓

# dwa procesy, dwa terminale:
npm run dev              # aplikacja        → http://localhost:3000/audyt
npm run audit:worker     # silnik audytów
```

**Bez działającego workera audyty zostają w kolejce i nic się nie dzieje.** Panel wyników
pokaże „W kolejce" i będzie tak stał. To najczęstsza pomyłka przy pierwszym uruchomieniu.

---

## Zmienne środowiskowe

Dopisz do `.env` (i do `.env.example`, jeśli chcesz mieć komplet w repo).

### Wymagane, żeby cokolwiek działało

| Zmienna | Do czego |
|---|---|
| `DATABASE_URL` | Baza (już istnieje w projekcie). |
| `ANTHROPIC_API_KEY` | Analiza Claude. Bez tego każdy audyt kończy się błędem na etapie „analyze". |
| `NEXT_PUBLIC_APP_URL` | Adres publiczny aplikacji — buduje linki do raportów i `success_url` Stripe'a. Lokalnie `http://localhost:3000`. |

### Płatności (bez nich działa tylko darmowy skan)

| Zmienna | Do czego |
|---|---|
| `STRIPE_SECRET_KEY` | Klucz sekretny (`sk_live_…` / `sk_test_…`). |
| `STRIPE_WEBHOOK_SECRET` | Sekret podpisu webhooka (`whsec_…`). |

### Opcjonalne

| Zmienna | Domyślnie | Do czego |
|---|---|---|
| `RESEND_API_KEY` + `AUDIT_FROM_EMAIL` | brak | E-mail „raport gotowy". Bez nich link i tak jest na ekranie. |
| `PSI_API_KEY` | brak | Klucz PageSpeed Insights. Bez klucza też działa, tylko z niższym limitem zapytań. |
| `AUDIT_LIGHTHOUSE_PROVIDER` | `psi` | `psi` (chmura Google), `local` (własny Lighthouse + Chrome), `off`. |
| `AUDIT_MODEL` | `claude-opus-5` | Model analizy. |
| `AUDIT_HOURLY_RATE_PLN` | `180` | Stawka godzinowa w wycenie wdrożenia. |
| `AUDIT_FREE_LIMIT_EMAIL` | `3` | Limit darmowych skanów na e-mail / dobę. |
| `AUDIT_FREE_LIMIT_IP` | `10` | Limit darmowych skanów na IP / dobę. |
| `AUDIT_WORKER_IDLE_MS` | `4000` | Odstęp między sprawdzeniami kolejki, gdy nic nie ma. |

---

## Konfiguracja Stripe (10 minut, raz)

1. **Włącz metody płatności** — panel Stripe → *Settings → Payment methods*: `card`, `blik`, `p24`.
   BLIK i Przelewy24 wymagają waluty PLN (cennik jest w PLN, więc jest OK).
2. **Webhook** — *Developers → Webhooks → Add endpoint*:
   - URL: `https://twoja-domena.pl/api/audit/stripe/webhook`
   - zdarzenia: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`
   - skopiuj `whsec_…` do `STRIPE_WEBHOOK_SECRET`
3. **Lokalny test webhooka**:
   ```bash
   stripe listen --forward-to localhost:3000/api/audit/stripe/webhook
   ```
4. **Test płatności** — karta `4242 4242 4242 4242`, dowolna przyszła data i CVC.

Nie musisz zakładać produktów ani cen w panelu Stripe. Cennik żyje w
`src/lib/audit/config.ts` i jest wysyłany jako `price_data` przy każdej sesji.

> **BLIK i Przelewy24 potwierdzają się asynchronicznie.** Dlatego strona `/audyt/dziekujemy`
> sama dopytuje backend, a ten pyta Stripe wprost — klient nie utknie, jeśli webhook
> się spóźni. Obie ścieżki są idempotentne i nie zdublują audytu.

---

## Zmiana cennika i pakietów

Wszystko w jednym miejscu: `src/lib/audit/config.ts`.

```ts
basic: {
  priceGrosz: 9900,          // ← 99 zł. Grosze, nie złote.
  maxPages: 3,               // ile podstron analizujemy
  maxVisibleFindings: null,  // null = wszystkie; liczba = teaser
  pdf: true, quote: true, copyRewrites: false, roadmap: false,
  features: [ /* lista na landingu */ ],
}
```

Zmiana ceny działa od razu — landing, formularz, Stripe i panel biorą ją z tego pliku.

Stawkę wyceny zmienisz zmienną `AUDIT_HOURLY_RATE_PLN` (bez zmian w kodzie).

---

## Wdrożenie

### Baza: Postgres wszędzie (rozstrzygnięte)

Kolejka audytów żyje w bazie, więc **aplikacja i worker muszą widzieć tę samą bazę.**
Na dwóch kontenerach (Render, Railway, Fly…) SQLite nie zadziała, bo każdy kontener ma
własny dysk — dlatego `prisma/schema.prisma` używa teraz `provider = "postgresql"`,
zgodnie z tym, co od początku zakładał `render.yaml` (`fromDatabase … connectionString`).

Lokalnie potrzebujesz więc Postgresa zamiast pliku SQLite, np.:

```bash
docker run --name invoiceguard-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=invoiceguard -p 5432:5432 -d postgres:16
```

i w `.env`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/invoiceguard"
```

Potem `npm run db:push`. Kod claimowania zadań jest już atomowy — na Postgresie możesz
też uruchomić kilka workerów naraz.

### Render

`render.yaml` zawiera już dwie usługi: `invoiceguard` (web) i
`invoiceguard-audit-worker` (silnik, obraz `Dockerfile.worker`). Po `render blueprint launch`
uzupełnij w panelu sekrety oznaczone `sync: false`.

Worker musi chodzić stale — plan `free` na Renderze usypia usługi, dlatego w blueprincie
ma `plan: starter`.

### Vercel

Aplikacja wjedzie bez problemu (PDF renderuje się w czystym Node, bez Chromium).
Workera trzeba postawić gdzie indziej — dowolna maszyna z `npm run audit:worker`
i dostępem do tej samej bazy.

---

## Jak to działa w środku

```
/audyt  →  POST /api/audit/orders  →  AuditOrder + (Stripe Checkout)
                                            ↓
                                     AuditRun (queued)
                                            ↓
                             worker: claim → 6 etapów → done
                                            ↓
                     /audyt/raport/<token>  (polling co 2,5 s)
```

Sześć etapów silnika: `scrape` → `lighthouse` → `heuristics` → `analyze` → `pricing` → `report`.
Postęp i log każdego etapu lądują w bazie, więc panel pokazuje pracę na żywo, a nie
kręcące się kółko.

**Punktację liczą reguły, nie model.** `heuristics.ts` zawiera ~30 deterministycznych
reguł — te same wejścia zawsze dają ten sam wynik. Claude dostaje policzone fakty i pisze
diagnozę oraz rekomendacje. Dzięki temu dwa audyty tej samej strony są porównywalne.

---

## Testowanie

```bash
npm run audit:smoke
```

Sprawdza deterministycznie: normalizację adresu, ekstrakcję ~40 sygnałów ze strony,
reguły i punktację, wycenę, bramkę pakietu (free vs opłacony — w tym to, że zablokowana
treść nie wycieka do API) i render PDF-a z osadzonymi polskimi znakami.

**Czego ten test nie sprawdza**, bo wymaga sieci i kluczy: wywołania Claude'a,
PageSpeed Insights i Stripe'a. Pierwszy prawdziwy audyt zrób ręcznie na własnej stronie,
z workerem w drugim terminalie.

---

## Bezpieczeństwo

- **SSRF** — silnik pobiera adres podany przez obcą osobę, więc `src/lib/audit/url.ts`
  rozwiązuje DNS i odrzuca adresy prywatne, loopback i link-local (w tym `169.254.169.254`,
  czyli metadane chmur) — **przy każdym przekierowaniu z osobna**, nie tylko na wejściu.
- **Limity** darmowych skanów per e-mail i per IP, liczone w bazie.
- **Token raportu** — 24 losowe bajty (base64url). Brak listowania cudzych raportów,
  strona raportu ma `noindex`.
- **Webhook Stripe** — weryfikacja podpisu na surowym body, przed jakimkolwiek parsowaniem.
- **Potwierdzenie płatności** sprawdza, czy sesja Stripe należy do tego zamówienia —
  cudzy `session_id` nie odblokuje raportu.
- **Sekrety** wyłącznie przez ENV.

---

## Znane ograniczenia

- **Strony renderowane wyłącznie JavaScriptem** widzimy tak, jak robot Google: jeśli
  w HTML nie ma treści, zgłaszamy to jako osobny poważny problem (`ux.jsOnly`), ale
  nie ocenimy treści, której nie ma w kodzie. Doklejenie headless browsera do scrapera
  to naturalny następny krok.
- **Wycena jest estymatą**, nie ofertą — i jest tak opisana w panelu i w PDF-ie.
- **Jeden worker** przetwarza audyty po kolei. Przy większym ruchu: Postgres + kilka
  instancji workera (kod już to obsługuje).
- **Brak panelu administracyjnego.** Zamówienia i runy oglądasz przez `npx prisma studio`.
