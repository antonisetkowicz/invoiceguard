# autoodpowiedzi — automatyczne reagowanie na wiadomości

System uruchamiany komendą `/autoodpowiedzi`, który czyta nowe wiadomości
(e-mail + WhatsApp), klasyfikuje je i **odpowiada automatycznie tylko na
rutynowe, jednoznaczne przypadki** z jasno zdefiniowanej białej listy
(`whitelist.json`). Wszystko inne trafia jako gotowy draft do Twojej
akceptacji. To asystent, nie autopilot — priorytetem jest nie wysłać
niczego głupiego/niewłaściwego w Twoim imieniu, nawet kosztem tego, że
część wiadomości poczeka na Ciebie.

## Ograniczenie techniczne — przeczytaj to najpierw

**Gmail MCP dostępny w tej sesji nie ma narzędzia do wysyłki wiadomości** —
tylko `create_draft` / `update_draft`. Oznacza to, że **auto-send dla
e-maila nie jest dziś technicznie możliwy**, nawet dla wiadomości ze 100%
dopasowaniem do whitelisty. System honestly to sygnalizuje: e-maile zawsze
lądują jako draft w Gmailu — te z `whitelist_match: true` i
`sensitivity: low` dostają dodatkowo etykietę
`auto-odpowiedzi/gotowe-do-wyslania` (one-click send), reszta to zwykły
draft do przemyślenia. Gdy w przyszłości podłączysz connector/scope z
realną wysyłką (np. Gmail API `users.messages.send`), rozszerz logikę w
`.claude/agents/auto-sender.md`.

Dla **WhatsApp** realna auto-wysyłka JEST możliwa (przez Twilio) — ale
wyłącznie dla wiadomości spełniających whitelistę.

## Architektura

```
.claude/
├── commands/autoodpowiedzi.md   # ORKIESTRATOR — wywołuje 6 subagentów 1→6
├── agents/
│   ├── email-watcher.md         # 1 → new_emails.json
│   ├── whatsapp-watcher.md      # 2 → new_whatsapp.json
│   ├── classifier.md            # 3 → classified_messages.json (krok krytyczny)
│   ├── draft-responder.md       # 4 → drafts.json
│   ├── auto-sender.md           # 5 → send_report.json
│   └── escalation-notifier.md   # 6 → notifications_log.json
└── settings.json                # globalne uprawnienia (dzielone z autobiznes)

run/<ISO-timestamp>/              # persystencja stanu jednego runu (gitignorowane)
├── state.json / log.md / SUMMARY.md
└── new_emails.json … notifications_log.json

whitelist.json                    # wzorce dopuszczone do auto-send — edytujesz ręcznie
message_log.json                  # trwała historia wiadomości (gitignorowane — dane prywatne)
HUMAN_ACTION_REQUIRED.md          # eskalacje — powstaje tylko gdy potrzebna Twoja akcja
```

- **Orkiestrator**: leci na najsilniejszym dostępnym modelu — to krok, gdzie
  błąd klasyfikacji kosztuje najwięcej.
- **Subagenty izolowane** — komunikują się WYŁĄCZNIE przez pliki w
  `./run/<timestamp>/`.
- **Uprawnienia per-agent** w YAML frontmatter `.claude/agents/*.md` — np.
  `classifier` i `draft-responder` nie mają żadnych narzędzi zewnętrznych
  (czyste rozumowanie), tylko `auto-sender` ma prawo do realnej wysyłki.

## Whitelist — jak dopisać kategorię

`whitelist.json` startuje **pusty** (`[]`). Dopóki jest pusty, system działa
w trybie "wszystko to draft" — żadna wiadomość nie zostanie wysłana
automatycznie, niezależnie jak rutynowa wygląda.

Po zobaczeniu kilku runów i tego, jak `classifier` sobie radzi, dopisz ręcznie
wzorce, na które świadomie pozwalasz na auto-send (tylko email
`draft_whitelisted`/WhatsApp `sent` — patrz ograniczenie wyżej):

```json
[
  "potwierdzenie otrzymania wiadomości bez wymaganej akcji",
  "prośba o standardowe informacje, które już mam gotowe (cennik, godziny pracy, link do kalendarza)",
  "automatyczne 'dziękuję' na wiadomość niewymagającą treściwej odpowiedzi"
]
```

Zasady:
- Dopasowanie musi być jednoznaczne i wysokiej pewności — `classifier` w
  razie wątpliwości ZAWSZE wybiera draft, nigdy nie zgaduje w stronę
  auto-send.
- `sensitivity: medium/high` (pieniądze/prawo/zdrowie/relacje osobiste/
  nieznany nadawca z niejasną intencją) **zawsze** wyklucza auto-send,
  niezależnie od dopasowania do whitelisty.
- Whitelistę edytujesz TYLKO Ty ręcznie — żaden agent nigdy do niej nie
  dopisuje sam.

## Wybór integracji WhatsApp

Sterowana `WHATSAPP_INTEGRATION` w `.env`:

### Opcja A — Twilio WhatsApp Business API (domyślna, zalecana)
Bezpieczniejsza, oficjalna, stabilna. Wymaga numeru zarejestrowanego jako
WhatsApp Business Sender w Twilio (może nie być tym samym numerem co Twój
prywatny WhatsApp).

```
WHATSAPP_INTEGRATION="twilio"
TWILIO_ACCOUNT_SID="..."
TWILIO_AUTH_TOKEN="..."
TWILIO_WHATSAPP_NUMBER="whatsapp:+48XXXXXXXXX"
```

`whatsapp-watcher` polluje Twilio Messages API (`GET .../Messages.json`) po
wiadomości przychodzące. Dla produkcji rozważ webhook zamiast pollingu
(Twilio Status Callback) — nie jest to wymagane do działania systemu.

### Opcja B — lokalny most (whatsapp-web.js / Baileys)
Działa na prawdziwym koncie prywatnym przez sesję zalogowaną QR-kodem.
Nieoficjalne — ryzyko zbanowania numeru przy zbyt agresywnej automatyzacji,
wymaga utrzymania działającego procesu Node lokalnie (nie tylko wywołania
API).

1. Uruchom osobno lokalny proces Node (biblioteka whatsapp-web.js lub
   Baileys), zaloguj QR-kodem, wystaw lokalny HTTP endpoint z trasami:
   - `GET /messages/new?since=<ISO>` — nowe wiadomości przychodzące,
   - `POST /messages/send` — wysyłka (wywoływane TYLKO przez `auto-sender`
     dla wiadomości z whitelisty).
2. W `.env`:
   ```
   WHATSAPP_INTEGRATION="local"
   WHATSAPP_LOCAL_BRIDGE_URL="http://localhost:3900"
   ```
3. Pilnuj limitów wysyłki (auto-sender ogranicza do max 10 auto-send na run)
   — ryzyko zbanowania numeru jest wysokie i nieodwracalne.

**W obu przypadkach system nigdy nie wysyła automatycznie na WhatsApp poza
wzorcami z whitelisty.**

## Uruchomienie ręczne

```
/autoodpowiedzi            # pełny przebieg, oba kanały
/autoodpowiedzi email      # tylko e-mail
/autoodpowiedzi whatsapp   # tylko WhatsApp
```

Po runie zajrzyj do `run/<timestamp>/SUMMARY.md` oraz — jeśli istnieje — do
`HUMAN_ACTION_REQUIRED.md`.

## Jak przejrzeć message_log.json

`message_log.json` (root repo, gitignorowany — zawiera treści prywatne) to
trwała historia: co przyszło, jak sklasyfikowane, co zrobiono. Każdy wpis:

```json
{
  "message_id": "...",
  "channel": "email|whatsapp",
  "sender": "...",
  "received_at": "...",
  "processed_at": "...",
  "run_id": "...",
  "kategoria": "...",
  "sensitivity": "low|medium|high",
  "whitelist_match": true,
  "action_status": "sent|draft_whitelisted|draft|escalated|skipped_spam"
}
```

Otwórz plik dowolnym edytorem/`jq`, np. żeby zobaczyć wszystko co poszło
`sent`:
```
jq '.[] | select(.action_status=="sent")' message_log.json
```
Dzięki temu logowi ta sama wiadomość nigdy nie jest przetwarzana dwa razy.

## Cron (macOS)

Uruchamianie co 15–30 minut, żeby draft/eskalacja czekały na Ciebie krótko.
Natychmiastowy alert Telegram niezależnie od harmonogramu, gdy pojawi się
wiadomość `sensitivity: high` (robi to `escalation-notifier` w ramach
samego runu — cron tylko go wyzwala częściej).

```bash
# ── autoodpowiedzi: co 20 minut ────────────────────────────────────────
*/20 * * * * cd /Users/TWOJ_USER/invoiceguard && \
  /usr/bin/env -S bash -lc '\
    source .env 2>/dev/null; \
    TS=$(date +\%Y-\%m-\%dT\%H-\%M-\%SZ); \
    LOG="run/cron-autoodpowiedzi-$TS.log"; \
    claude -p "/autoodpowiedzi" --dangerously-skip-permissions >"$LOG" 2>&1; \
    if [ -s HUMAN_ACTION_REQUIRED.md ]; then \
      curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
        --data-urlencode chat_id="$TELEGRAM_CHAT_ID" \
        --data-urlencode text="autoodpowiedzi: run $TS wymaga Twojej akcji — sprawdź HUMAN_ACTION_REQUIRED.md"; \
    fi'
```

> Podmień `TWOJ_USER` i ścieżkę. Flaga `--dangerously-skip-permissions` jest
> potrzebna, by cron szedł bez pytań — używaj tylko w zaufanym środowisku, i
> tylko gdy `whitelist.json` zawiera wyłącznie wzorce, które świadomie
> zaakceptowałeś do auto-send.

## Zmienne środowiskowe (.env)

| Zmienna | Do czego | Wymagane |
|---|---|---|
| Gmail (auth przez connector MCP) | odczyt/drafty maili | tak (do kanału email) |
| `WHATSAPP_INTEGRATION` | `twilio` (domyślnie) lub `local` | tak (do kanału WhatsApp) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_NUMBER` | opcja A | jeśli `twilio` |
| `WHATSAPP_LOCAL_BRIDGE_URL` | opcja B | jeśli `local` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | alert natychmiastowy (współdzielone z autobiznes) | opcjonalne, zalecane |

## Bezpieczeństwo — zasady nienaruszalne

- `whitelist.json` startuje pusty i jest edytowany WYŁĄCZNIE ręcznie przez
  Ciebie.
- `sensitivity: medium/high` zawsze wyklucza auto-send, niezależnie od
  dopasowania do whitelisty.
- Auto-send dla e-maila jest dziś niemożliwy technicznie (brak narzędzia
  `send` w Gmail MCP) — wszystko ląduje jako draft.
- Auto-send dla WhatsApp tylko dla whitelisty, z limitem na run i bez
  webhooków/agresywnej automatyzacji, która mogłaby zbanować numer.
- Sekrety wyłącznie przez `.env`, nigdy hardcodowane w artefaktach runu.
