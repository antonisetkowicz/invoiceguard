---
description: Automatyczne reagowanie na przychodzące wiadomości (e-mail + WhatsApp) — klasyfikuje i odpowiada automatycznie TYLKO na rutynowe, jednoznaczne przypadki z whitelist.json; wszystko inne trafia jako draft do akceptacji. Uruchamia 6 subagentów sekwencyjnie (email-watcher → escalation-notifier).
argument-hint: '[opcjonalnie "email" lub "whatsapp" dla pojedynczego kanału]'
---

# /autoodpowiedzi — orkiestrator pipeline'u

Jesteś ORKIESTRATOREM. Leci na najsilniejszym dostępnym modelu — to krok, w
którym błąd klasyfikacji kosztuje najwięcej (może skończyć się wysyłką
czegoś niewłaściwego w imieniu użytkownika), więc nie oszczędzaj tu na
jakości wywołań. Nie wykonujesz pracy subagentów samodzielnie — przygotowujesz
run, wywołujesz subagenty 1→6 SEKWENCYJNIE przez tool `Task`/`Agent`
(`subagent_type` = nazwa z `.claude/agents/`), przekazujesz `RUN_DIR` i
pilnujesz kontraktu plikowego oraz human-in-the-loop.

Argument użytkownika (opcjonalny): `$ARGUMENTS`
- Pusty → pełny przebieg, oba kanały.
- `email` → tylko krok 1 (pomiń krok 2, `new_whatsapp.json` = pusta lista).
- `whatsapp` → tylko krok 2 (pomiń krok 1, `new_emails.json` = pusta lista).

## Krok 0 — inicjalizacja runu
1. Ustal `TS` = bieżący timestamp ISO bezpieczny dla ścieżki (np.
   `2026-07-23T10-00-00Z`). Ustaw `RUN_DIR=./run/<TS>/`.
2. Utwórz `RUN_DIR` (mkdir -p).
3. Jeśli `./message_log.json` (root repo) nie istnieje — utwórz go jako
   pustą listę `[]`. NIGDY go nie nadpisuj jeśli już istnieje.
4. Jeśli `./whitelist.json` (root repo) nie istnieje — utwórz go jako pustą
   listę `[]` (system domyślnie startuje w trybie "wszystko to draft").
5. Zapisz `RUN_DIR/state.json`:
   ```json
   { "run_id": "<TS>", "started_at": "<ISO>", "args": { "kanal": "<email|whatsapp|null>" }, "steps": {} }
   ```
6. Utwórz pusty `RUN_DIR/log.md` z nagłówkiem `# Log decyzji — run <TS>`.
7. NIE twórz z góry `HUMAN_ACTION_REQUIRED.md` — powstaje tylko gdy agent go
   potrzebuje. Zapamiętaj jego stan (mtime/rozmiar lub brak) PRZED pierwszym
   krokiem.

## Kroki 1→6 — sekwencyjne wywołania subagentów

| # | subagent | wymaga wejścia | produkuje | pomiń gdy |
|---|---|---|---|---|
| 1 | email-watcher | `message_log.json` | `new_emails.json` | `$ARGUMENTS == "whatsapp"` |
| 2 | whatsapp-watcher | `message_log.json` | `new_whatsapp.json` | `$ARGUMENTS == "email"` |
| 3 | classifier | `new_emails.json`, `new_whatsapp.json`, `whitelist.json` | `classified_messages.json` | nigdy |
| 4 | draft-responder | `classified_messages.json` | `drafts.json` | nigdy |
| 5 | auto-sender | `drafts.json`, `classified_messages.json` | `send_report.json` | nigdy |
| 6 | escalation-notifier | `send_report.json`, `classified_messages.json` | `notifications_log.json` | nigdy |

Gdy krok jest "pomiń" — sam zapisz do `RUN_DIR` odpowiedni plik z pustą
listą (`{"generated_at": "<ISO>", "count": 0, "messages": []}`) zamiast
wywoływać agenta, i zanotuj to w `log.md`.

### Po KAŻDYM kroku
1. Sprawdź, czy oczekiwany artefakt powstał w `RUN_DIR`. Brak artefaktu →
   zapisz przyczynę w `log.md`; dla kroków 1-2 kontynuuj z pustą listą
   (nie blokuj reszty pipeline'u), dla kroków 3-6 to błąd krytyczny → STOP,
   przejdź do SUMMARY.
2. Sprawdź, czy `HUMAN_ACTION_REQUIRED.md` urósł/powstał od ostatniego
   kroku. Jeśli tak — zanotuj, ale **kontynuuj pipeline**.
3. `retry`: błąd przejściowy (sieć/timeout) → ponów maksymalnie 1×. Błąd
   merytoryczny → nie ponawiaj, zaloguj.

## Krok końcowy — aktualizacja message_log.json i SUMMARY

1. Wczytaj `RUN_DIR/classified_messages.json` i `RUN_DIR/send_report.json`.
   Dla KAŻDEJ przetworzonej wiadomości dopisz (APPEND, nigdy nadpisanie)
   wpis do trwałego `./message_log.json`:
   ```json
   {
     "message_id": "",
     "channel": "email|whatsapp",
     "sender": "",
     "received_at": "",
     "processed_at": "<ISO teraz>",
     "run_id": "<TS>",
     "kategoria": "",
     "sensitivity": "",
     "whitelist_match": false,
     "action_status": "sent|draft_whitelisted|draft|escalated|skipped_spam"
   }
   ```
2. Wygeneruj `RUN_DIR/SUMMARY.md`:
   - Ile wiadomości przetworzono per kanał (email/WhatsApp).
   - Ile wysłano automatycznie realnie (`status: "sent"` — w praktyce
     dziś tylko WhatsApp, patrz uwaga w `auto-sender.md` o braku narzędzia
     wysyłki w Gmail MCP) i jakie kategorie/wzorce whitelisty.
   - Ile e-maili trafiło jako `draft_whitelisted` (gotowe do jednego
     kliknięcia) vs zwykły `draft`.
   - Ile czeka jako eskalacja w `HUMAN_ACTION_REQUIRED.md`.
   - **Sekcja „Wymaga Ciebie"** — pełna treść wszystkich dopisów do
     `HUMAN_ACTION_REQUIRED.md` z tego runu (albo „nic — wszystko poszło
     automatycznie lub jako zwykły draft do przejrzenia").
   - Czy był wysłany alert Telegram (`notifications_log.json`).

Na końcu wypisz użytkownikowi zwięzłe podsumowanie + ścieżkę do
`SUMMARY.md` i wyraźną informację, czy `HUMAN_ACTION_REQUIRED.md` jest
niepusty.

## Zasady twarde
- Sekrety tylko z `.env` — nigdy nie wpisuj kluczy do artefaktów runu.
- `whitelist.json` jest edytowany WYŁĄCZNIE ręcznie przez użytkownika —
  żaden subagent ani orkiestrator nigdy nie dopisuje do niego wzorców
  automatycznie.
- `message_log.json` — tylko append, nigdy nadpisanie całości.
- Subagenty nie komunikują się między sobą — tylko przez pliki w `RUN_DIR`.
- W razie wątpliwości klasyfikacji → zawsze draft/eskalacja, nigdy auto-send.
