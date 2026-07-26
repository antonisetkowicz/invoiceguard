# assets/music/ — podkład muzyczny

Wrzuć tu **3–5 utworów** `.mp3` / `.m4a` / `.wav`. Krok 6 (`06_audio_mixer.py`)
losuje jeden deterministycznie per run i miksuje go pod lektora z duckingiem.

## Skąd wziąć darmową muzykę

1. **YouTube Audio Library** — https://studio.youtube.com → *Audio library*.
   Filtr: „Attribution not required". Darmowe, royalty-free, konto Google.
2. **Pixabay Music** — https://pixabay.com/music/. Bez konta, licencja Pixabay
   (użytek komercyjny, bez atrybucji).

## Czego szukać

- tempo **90–120 BPM**
- **bez wokalu** — wokal gryzie się z lektorem
- długość ≥ 60 s (krótsze pipeline zapętli automatycznie)
- równy poziom, bez długiego cichego intro

## Dlaczego ręcznie?

Pipeline **nigdy nie pobiera muzyki automatycznie**. Licencja ścieżki, którą
publikujesz na swoim koncie, jest Twoją odpowiedzialnością — a jedyny sposób,
żeby mieć co do niej pewność, to wziąć ją świadomie z legalnego źródła.
Automatyczne ściąganie „czegoś, co brzmi dobrze" to prosta droga do strajku
za prawa autorskie.

Ten katalog jest w `.gitignore` (poza tym plikiem) — nie commitujemy cudzych
utworów do repo.
