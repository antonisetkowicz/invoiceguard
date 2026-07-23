---
description: Pozyskiwanie klientów cold-mailem — namierza leady (Google Maps + Panorama Firm + strony firm), wyciąga PUBLICZNE adresy e-mail i tworzy spersonalizowane wersje robocze w Gmailu pod konkretny adres. NIGDY nie wysyła. Darmowe narzędzia.
argument-hint: "branża: <np. agencje marketingowe>, miasto: <np. Warszawa>, liczba: <n=30>, oferta: <opcjonalnie>"
---

# /coldmail — silnik pozyskiwania klientów (cold-email, DRAFTY)

Robisz dokładnie to: znajdujesz realne firmy pasujące do ICP, wyciągasz ich
PUBLICZNE adresy kontaktowe, piszesz spersonalizowany mail 1:1 pod każdą i
tworzysz z niego WERSJĘ ROBOCZĄ w Gmailu adresowaną na ten konkretny adres.
Wysyłkę wykonuje człowiek — pipeline NIGDY nie wysyła.

Argument: `$ARGUMENTS` (parsuj pola: `branża`, `miasto`, `liczba` [domyślnie 30],
`oferta`). Jeśli `branża`/`miasto` brak — dopytaj użytkownika JEDNYM pytaniem.

## Skąd bierzesz ofertę (co promujesz)
Kolejność źródeł:
1. `oferta:` z argumentu, jeśli podana.
2. Najnowszy `run/*/copy.json` → `cold_email` + `brand` (jeśli istnieje).
3. Dopytaj użytkownika o 1-zdaniową ofertę + link (jeśli jest strona).

## Krok 1 — Namierzanie leadów (DARMOWE, tylko publiczne dane)
Cel: `liczba` firm z `branża` w `miasto`. Źródła:
- **Google Maps** — `WebSearch`/`WebFetch` na listing map/wizytówek dla frazy
  „<branża> <miasto>” (nazwa firmy + strona www z wizytówki).
- **Panorama Firm** (panoramafirm.pl) — `WebSearch`/`WebFetch` katalogu dla
  „<branża> <miasto>” (nazwa, strona, czasem telefon/adres).
- **Strony firm** — wejdź na stronę/`/kontakt`/politykę prywatności, żeby
  pobrać FAKTYCZNIE opublikowany adres.
Zbieraj: `firma`, `www`, `email` (publiczny), `zrodlo` (skąd adres), `haczyk`.

### Twarde reguły pozyskiwania adresów
- Bierzesz TYLKO adres opublikowany przez firmę (wizytówka/strona/polityka):
  `kontakt@`, `biuro@`, `hello@`, `info@`, `get@`, imienny jeśli jawny.
- NIGDY nie zgadujesz adresu z wzorca (`imie@firma.pl`) i nie podajesz
  zgadniętego jako „zweryfikowany”. Jeśli firma ma tylko formularz → pomiń ją.
- Adresy z agregatorów (RocketReach/Lusha/prospeo itp.) traktuj jako
  niepewne — użyj tylko gdy potwierdzone na własnej stronie firmy.
- Nie ma darmowej rzetelnej weryfikacji SMTP → w raporcie pisz „publiczny,
  niezweryfikowany SMTP”. Jeśli firm z publicznym adresem jest mniej niż
  `liczba` — dostarcz tyle, ile realnie jest (nie dobijaj zgadywaniem).
- Respektuj ToS źródeł i RODO: to firmowe adresy kontaktowe B2B (uzasadniony
  interes); w mailu ma być łatwy opt-out.

## Krok 2 — Personalizacja 1:1
Dla każdej firmy zbuduj `haczyk` z realnego kontekstu (co robią) i złóż mail
otwierający z oferty. Ton dopasuj do ICP — nie tłumacz ekspertowi jego
dziedziny. Schemat maila (dostosuj do oferty):

```
Dzień dobry,

widzę, że {firma} {haczyk}. {jedno zdanie łączące ich kontekst z ofertą}.

{2–3 zdania oferty + konkretna korzyść}.

{miękkie CTA — pytanie}. {link, jeśli jest}

Pozdrawiam,
{nadawca}
```
Temat: krótki, konkretny, z nazwą firmy lub korzyścią (≤55 znaków).

## Krok 3 — Wersje robocze w Gmailu (NIE wysyłka)
Dla każdego leada: `mcp__Gmail__create_draft` z `to=[realny publiczny adres]`,
tematem i treścią. Zapisz zwrócone `draft_id`. Twórz drafty batchami.
- **Auto-wysyłka jest ZAKAZANA.** Nie istnieje krok „send”. Człowiek przegląda
  Wersje robocze i wysyła sam.
- Jeśli oferta ma link za ochroną (np. Vercel 403) — ostrzeż w raporcie, że
  link nie zadziała publicznie dopóki ochrona jest włączona.

## Krok 4 — Zapis i raport
- `run/<TS>/coldmail/leads.csv`: `lp,firma,email,typ,haczyk,zrodlo,draft_id`.
- Raport w czacie: ile firm namierzono, ile draftów utworzono (z listą
  firma→adres), źródła adresów, uczciwa uwaga o weryfikacji + RODO, i jasne
  „nic nie wysłano — wyślij ręcznie z Wersji roboczych”.

## Definicja sukcesu
Drafty spersonalizowane pod realne, publiczne adresy istnieją w Gmailu;
`leads.csv` z źródłami zapisany; zero automatycznej wysyłki; uczciwe
zastrzeżenia w raporcie.
