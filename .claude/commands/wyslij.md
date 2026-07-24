---
description: "Automatyczna WYSYŁKA cold-maili (nie draft) przez MailerLite — jedyny darmowy konektor z realną wysyłką. Wywołanie: /wyslij (czasem zapisywane /wyślij). ⚠️ Ryzyko: MailerLite jest ESP dla list opt-in; wysyłka do zeskrapowanych kontaktów B2B narusza jego regulamin (ToS) — świadoma decyzja właściciela, na jego odpowiedzialność."
argument-hint: "leady: <ścieżka do CSV z /coldmail lub run/.../marketing/leads*.csv>, temat: <...>, oferta: <opcjonalnie>"
---

# /wyslij — automatyczna wysyłka cold-maili (MailerLite)

## ⚠️ Przeczytaj, zanim uruchomisz

To NIE jest tryb „draft" jak `/coldmail`. Ta komenda **faktycznie wysyła**
e-maile, bez kliknięcia człowieka na każdy z osobna. Techniczne i prawne fakty:

- **Gmail nie ma narzędzia do wysyłki** (tylko `create_draft`) — dlatego
  używamy **MailerLite** (darmowy tier, realne `schedule_campaign`).
- **MailerLite (jak każdy ESP) zabrania w regulaminie** wysyłki do
  kontaktów, które nie wyraziły zgody (opt-in) — a leady z `/coldmail` to
  publiczne adresy firmowe, NIE subskrybenci. Użycie MailerLite w ten sposób
  **łamie Acceptable Use Policy** dostawcy i grozi zawieszeniem konta.
- To świadoma decyzja właściciela repo, podjęta po jawnym ostrzeżeniu —
  wykonywana na jego odpowiedzialność. Nie escaluj tego ponownie do
  `HUMAN_ACTION_REQUIRED.md` jako blokera; to już jest zaakceptowane ryzyko.
- Cold B2B e-mail z opt-outem jest legalny (uzasadniony interes, RODO) —
  ryzykiem NIE jest prawo, tylko regulamin platformy ESP.

## Bramka bezpieczeństwa (zamiast pytania za każdym razem)
Rzeczywista wysyłka (`schedule_campaign(delivery:"instant")`) wykonuje się
**TYLKO gdy `AUTOBIZNES_AUTOSEND=true`** w `.env` (ta sama flaga, co w reszcie
systemu — patrz `CLAUDE.md`). Jeśli flaga nie jest ustawiona:
- utwórz kampanię w MailerLite (stan „draft", nie zaplanowana),
- NIE wywołuj `schedule_campaign`,
- dopisz do `HUMAN_ACTION_REQUIRED.md`: link do kampanii w dashboardzie +
  instrukcja ręcznego wysłania albo ustawienia `AUTOBIZNES_AUTOSEND=true`.

## Argument
`$ARGUMENTS` — parsuj: `leady` (ścieżka do CSV z kolumnami minimum
`email,firma,haczyk`, np. z `/coldmail` lub `run/*/marketing/leads*.csv`),
`temat` (subject), `oferta` (opcjonalnie — inaczej weź z najnowszego
`run/*/copy.json`). Brak `leady` → dopytaj JEDNYM pytaniem o ścieżkę pliku.

## Procedura

### Krok 1 — Sprawdź konto MailerLite
`mcp__MailerLite__get_auth_status` — potwierdź, że jest zweryfikowany
nadawca (domena/adres). Brak weryfikacji → to JEST blokada wymagająca
człowieka (weryfikacja domeny w MailerLite to jednorazowa akcja w panelu) →
dopisz do `HUMAN_ACTION_REQUIRED.md` z linkiem do Settings > Domains i STOP.

### Krok 2 — Grupa i pola personalizacji
1. `mcp__MailerLite__create_group` — nazwa np. `coldmail-<data>-<slug oferty>`.
2. `mcp__MailerLite__create_field` dla `firma` i `haczyk` (typ text), jeśli
   jeszcze nie istnieją (sprawdź `list_fields` najpierw).

### Krok 3 — Import leadów jako subskrybentów
Dla każdego wiersza CSV: `mcp__MailerLite__add_subscriber` (lub
`import_subscribers_to_group` batchowo) z `email` + custom fields
`firma`/`haczyk`, przypisany do grupy z kroku 2.
- Pomijaj wiersze bez poprawnego adresu e-mail.
- Nie dodawaj duplikatów (sprawdzaj po e-mailu, jeśli narzędzie na to
  pozwala).

### Krok 4 — Treść kampanii z personalizacją
Zbuduj `content` (HTML) używający merge tagów MailerLite, np.:
```
Dzień dobry,

widzę, że {$firma} {$haczyk}.

<2–3 zdania oferty z $ARGUMENTS lub copy.json>

Pozdrawiam,
<nadawca>
```
Merge tagi wypełnią się per-subskrybent wartościami z kroku 3 — to jest
odpowiednik personalizacji 1:1, którą robiliśmy ręcznie w draftach Gmail.

### Krok 5 — Utwórz kampanię
`mcp__MailerLite__create_campaign`: `name`, `type: "regular"`, `subject`,
`from`/`from_name` (zweryfikowany nadawca z kroku 1), `groups: [group_id z
kroku 2]`, `content`.

### Krok 6 — Wysyłka (bramka `AUTOBIZNES_AUTOSEND`)
- `AUTOBIZNES_AUTOSEND=true` → `mcp__MailerLite__schedule_campaign`
  z `delivery: "instant"`. To JEST realna wysyłka do wszystkich w grupie.
- inaczej → zostaw jako draft w MailerLite, eskaluj wg sekcji „Bramka
  bezpieczeństwa" powyżej.

### Krok 7 — Zapis i raport
`run/<TS>/coldmail/sent_log.json`: `{ campaign_id, group_id, liczba_leadow,
wyslano: true|false, dashboard_url, timestamp }`. W czacie: ile wysłano/ile
czeka, link do MailerLite dashboard (`get_dashboard_link`), przypomnienie o
ryzyku ToS i że MailerLite dołącza automatycznie link do wypisu (wymagany
prawnie i pomaga w zgodności).

## Twarde reguły
- Nigdy nie wywołuj `schedule_campaign` bez sprawdzenia `AUTOBIZNES_AUTOSEND`.
- Nigdy nie usuwaj automatycznej stopki/linku wypisu z treści kampanii.
- Sekrety/klucze MailerLite są przez połączony konektor — nie wpisuj niczego
  do plików repo.
- To komenda samodzielna — NIE wpinaj jej automatycznie w krok 6 pipeline'u
  `/autobiznes` (tam zostaje bezpieczna ścieżka: drafty Gmail). `/wyslij`
  odpalasz świadomie, osobno.

## Definicja sukcesu
Kampania w MailerLite istnieje z poprawną personalizacją; jeśli
`AUTOBIZNES_AUTOSEND=true` — realnie wysłana (`schedule_campaign` zwrócił
sukces); inaczej — czeka jako draft z jasną instrukcją w
`HUMAN_ACTION_REQUIRED.md`. `sent_log.json` zapisany.
