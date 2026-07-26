#!/usr/bin/env python3
"""Testy logiki wyboru ujęć bez dostępu do sieci.

Odpowiedzi API są podstawiane jako fixture o kształcie zgodnym z dokumentacją
Pexels Videos i Pixabay Videos. Sprawdzamy to, co najłatwiej zepsuć i co
najtrudniej zauważyć na oko: czy wybieramy PIONOWY klip w odpowiedniej
rozdzielczości, czy odrzucamy poziome, i czy nie powtarzamy klipu w jednym runie.

Uruchomienie: python3 content-pipeline/tests/test_stock.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib import stock

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  OK   {name}")
    else:
        print(f"  FAIL {name} — {detail}")
        FAILURES.append(name)


# --------------------------------------------------------------------------- #
# Fixtures — kształt zgodny z realnymi odpowiedziami API
# --------------------------------------------------------------------------- #
PEXELS_PAYLOAD = {
    "videos": [
        {   # poziomy 4K — powinien przegrać z pionowym
            "id": 1001, "duration": 20, "url": "https://pexels/1001",
            "user": {"name": "Poziomy Autor"},
            "video_files": [
                {"link": "https://cdn/1001-3840.mp4", "width": 3840,
                 "height": 2160, "file_type": "video/mp4"},
            ],
        },
        {   # pionowy 1080x1920, dłuższy niż scena — oczekiwany zwycięzca
            "id": 1002, "duration": 15, "url": "https://pexels/1002",
            "user": {"name": "Pionowy Autor"},
            "video_files": [
                {"link": "https://cdn/1002-540.mp4", "width": 540,
                 "height": 960, "file_type": "video/mp4"},
                {"link": "https://cdn/1002-1080.mp4", "width": 1080,
                 "height": 1920, "file_type": "video/mp4"},
            ],
        },
        {   # pionowy, ale krótszy niż potrzebna scena
            "id": 1003, "duration": 3, "url": "https://pexels/1003",
            "user": {"name": "Krotki Autor"},
            "video_files": [
                {"link": "https://cdn/1003-1080.mp4", "width": 1080,
                 "height": 1920, "file_type": "video/mp4"},
            ],
        },
    ]
}

PIXABAY_PAYLOAD = {
    "hits": [
        {
            "id": 2001, "duration": 12, "user": "PixAutor",
            "pageURL": "https://pixabay/2001",
            "videos": {
                "large": {"url": "https://cdn/2001-large.mp4",
                          "width": 1080, "height": 1920},
                "medium": {"url": "https://cdn/2001-medium.mp4",
                           "width": 540, "height": 960},
            },
        },
    ]
}


def fake_get_json(payload):
    return lambda url, headers=None, timeout=30: payload


# --------------------------------------------------------------------------- #
print("scoring")
check("pion bije poziom",
      stock._score(1080, 1920, 15, 8) > stock._score(3840, 2160, 15, 8),
      "poziome 4K nie może wygrać z pionowym 1080p")
check("wyższa rozdzielczość pionowa bije niższą",
      stock._score(1080, 1920, 15, 8) > stock._score(540, 960, 15, 8))
check("klip pokrywający scenę bije za krótki",
      stock._score(1080, 1920, 15, 8) > stock._score(1080, 1920, 3, 8))
check("brak wymiarów odrzucany",
      stock._score(0, 0, 10, 8) < 0)

print("\nPexels — parsowanie i wybór")
original = stock._get_json
try:
    stock._get_json = fake_get_json(PEXELS_PAYLOAD)
    results = stock.search_pexels("query", "KEY", needed_s=8.0)
    check("zwrócono wszystkie 3 pozycje", len(results) == 3, f"jest {len(results)}")
    best = max(results, key=lambda c: c["score"])
    check("wybrano pionowy 1080x1920 (id 1002)", best["id"] == 1002,
          f"wybrano {best['id']}")
    check("wybrano najlepszy wariant pliku (1080, nie 540)",
          best["url"].endswith("1002-1080.mp4"), best["url"])
    check("przepisano metadane autora", best["author"] == "Pionowy Autor")

    # find_clip z wykluczeniem zwycięzcy — musi zejść na kolejny pion
    stock._get_json = fake_get_json(PEXELS_PAYLOAD)
    clip = stock.find_clip("query", needed_s=8.0,
                           env_get=lambda k, d=None: "KEY" if k == "PEXELS_API_KEY" else None,
                           exclude_ids={"pexels:1002"})
    check("wykluczony klip nie wraca", clip and clip.get("id") != 1002,
          f"dostano {clip}")

    print("\nPixabay — parsowanie")
    stock._get_json = fake_get_json(PIXABAY_PAYLOAD)
    hits = stock.search_pixabay("query", "KEY", needed_s=8.0)
    check("zwrócono 1 pozycję", len(hits) == 1, f"jest {len(hits)}")
    check("wybrano wariant large 1080x1920",
          hits[0]["url"].endswith("2001-large.mp4"), hits[0]["url"])
    check("źródło oznaczone jako pixabay", hits[0]["source"] == "pixabay")

    print("\nbrak kluczy = brak wyników (degradacja do gradientu)")
    clip = stock.find_clip("query", needed_s=8.0, env_get=lambda k, d=None: None)
    check("bez kluczy find_clip zwraca None", clip is None, f"dostano {clip}")

    print("\nbłąd API nie wywala wyjątku, tylko raportuje")
    def boom(url, headers=None, timeout=30):
        raise stock.StockError("HTTP 401: zły klucz")
    stock._get_json = boom
    clip = stock.find_clip("query", needed_s=8.0,
                           env_get=lambda k, d=None: "KEY" if k == "PEXELS_API_KEY" else None)
    check("błąd zwrócony jako pole error", bool((clip or {}).get("error")),
          f"dostano {clip}")
finally:
    stock._get_json = original

print()
if FAILURES:
    print(f"NIEPOWODZENIA: {len(FAILURES)} → {FAILURES}")
    sys.exit(1)
print("Wszystkie testy przeszły.")
