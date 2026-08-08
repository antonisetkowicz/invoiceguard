# InfinityAI — grafiki reklamowe w stylu SaaS reel

Odtworzenie stylu reela referencyjnego (`@noahmgfx`, "How modern SaaS brands should market")
jako zestaw 6 plansz 1080×1920 pod Reels / Stories / TikTok.

## 1. Jakie programy są potrzebne

### Do statycznych plansz (to, co zrobione tutaj)
| Program | Rola | Koszt |
|---|---|---|
| **Figma** | Projekt UI, kart, mockupów, tokenów marki. Pełna kontrola nad pikselem. | darmowy (drafts) |
| **Canva** | Szybkie warianty tła/typografii z AI, gotowe szablony Reels. | darmowy plan |

### Do animacji (żeby powstał reel, nie tylko obrazki)
| Program | Rola | Koszt |
|---|---|---|
| **After Effects** | Neon glow (blur + Screen/Add), pulsujące pierścienie radaru, keyframe'y stosu powiadomień. | płatny (Adobe CC) |
| **Rotato** | Obrót 3D telefonu/kart z realistycznym cieniem — dokładnie efekt z klatek 1 i 5 reela. | płatny (jest trial) |
| **CapCut** | Montaż, cięcia w rytm bitu, auto-napisy słowo-po-słowie. | darmowy |
| **Trapcode Shine** (plugin AE) | Mocniejszy bloom/promienie na neonowym tekście. | płatny, opcjonalny |

### Darmowe zamienniki płatnych
- Rotato → **Mockuuups Studio** (free tier) albo szablony mockupów w Figmie.
- After Effects → **CapCut** (glow przez nakładanie warstw + blur) lub **Canva** animacje.
- Trapcode Shine → duplikat warstwy tekstu + Gaussian Blur w trybie Add.

**Minimalny darmowy stack:** Figma (projekt) → eksport PNG → CapCut (animacja + napisy + muzyka).

## 2. Tokeny marki InfinityAI

Kolekcja zmiennych `InfinityAI Brand` w pliku Figma:

| Token | HEX | Zastosowanie |
|---|---|---|
| `bg/ink` | `#0A0616` | ciemne tła |
| `bg/light` | `#EDF1F7` | jasne tła |
| `brand/violet` | `#7C3AED` | poświata, gradienty |
| `brand/cyan` | `#22D3EE` | akcent, CTA, neon |
| `accent/green` | `#22C55E` | powiadomienia, statusy |
| `text/on-dark` | `#FFFFFF` | tekst na ciemnym |
| `text/on-light` | `#0B0B10` | tekst na jasnym |
| `text/muted` | `#A1A3B5` | podpisy, wordmark |

Typografia: **Inter** — Black (nagłówki), Semi Bold (podnagłówki, CTA), Medium/Regular (treść).

## 3. Plansze (6 × 1080×1920)

| # | Nazwa | Technika | Odpowiednik w referencji |
|---|---|---|---|
| 01 | Glass Card — "Automatyzacja" | glassmorphism: biały fill 6% + stroke 24% + background blur 48 + gradientowy header | karta "Business / Leadership…" |
| 02 | Neon — "ZAWSZE AKTYWNE" | 2 kopie tekstu: tylna z Layer Blur 44, przednia z gradientem + Drop Shadow glow; orb z gradientem radialnym i 2 pierścieniami | neon "Available" + niebieski orb |
| 03 | Light Radar — "Utracony lead" | 5 współśrodkowych okręgów, stroke 2px, opacity 0.05–0.10 na jasnym tle | "Lost Customer" z pingiem radaru |
| 04 | Notification Stack — "Nieodpisane" | 5 białych kart, rotacja −5°…+6°, zielony Drop Shadow glow + cień pod spodem | stos powiadomień Lucy/Sara |
| 05 | Phone Mockup — "Klient dzwoni" | ramka telefonu 450×920 + ekran z gradientem, rotacja −13°, cień; nagłówek dwukolorowy przez `setRangeFills` | 3D telefon "Customer Calling" |
| 06 | End Card — CTA | glyph `∞` z gradientem + glow, pill CTA "Zamów demo →" | (dodane — domknięcie reklamy) |

### Pułapki, na które warto uważać
- `figma.createAutoLayout()` tworzy frame z **domyślnym białym tłem** — trzeba jawnie ustawić `fills = []`, inaczej zakryje ciemne tło.
- `rescale()` na węźle, który ma już ustawioną `rotation`, rozjeżdża pozycje dzieci. Buduj w docelowym rozmiarze, **rotację ustawiaj raz na końcu**.
- Po `rotation` bounding box rośnie i węzeł ucieka z kadru — pozycję poprawiaj przez `absoluteBoundingBox`, nie przez `x`/`y`.

## 4. Jak z tego zrobić reel

1. Eksport każdej planszy z Figmy jako PNG 2× (albo SVG dla tekstu).
2. Import do CapCut / After Effects, po ~1,5–2 s na planszę.
3. Animacje: zoom-punch na cięciu, fade-in glow na 02, skala+opacity pierścieni na 03, wjazd kart z góry na 04, obrót telefonu na 05.
4. Napisy: auto-captions w CapCut, styl słowo-po-słowie.
5. Muzyka: trending audio wybrane bezpośrednio w Instagramie (bezpieczne licencyjnie).
6. Kolejność narracyjna: 03 (problem) → 04 (skala problemu) → 05 (moment) → 01 (rozwiązanie) → 02 (obietnica) → 06 (CTA).
