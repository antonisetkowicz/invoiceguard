"""Darmowe ujęcia wideo z ludźmi — Pexels Videos + Pixabay Videos.

Oba API są BEZPŁATNE i nie wymagają karty — tylko darmowego klucza:
  * Pexels:  https://www.pexels.com/api/  → PEXELS_API_KEY
  * Pixabay: https://pixabay.com/api/docs/ → PIXABAY_API_KEY

Licencje (stan na 2026-07): Pexels License i Pixabay Content License pozwalają
na użytek komercyjny bez atrybucji i bez opłat. Obie ZABRANIAJĄ jednak
przedstawiania osób z ujęć w sposób obraźliwy lub sugerujący, że coś reklamują
albo popierają. Przy Reelsach edukacyjnych to bez znaczenia, ale przy treściach
o oszustwach/długach/chorobach dobierz ujęcia ostrożnie — twarz z ujęcia nie
może wyglądać na „oszusta z historii".

Bez kluczy moduł zwraca po prostu brak wyników, a krok 4 degraduje scenę do
gradientu — pipeline nigdy nie zatrzymuje się na braku stocku.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PEXELS_SEARCH = "https://api.pexels.com/videos/search"
PIXABAY_SEARCH = "https://pixabay.com/api/videos/"

TARGET_W, TARGET_H = 1080, 1920
TARGET_RATIO = TARGET_W / TARGET_H


class StockError(RuntimeError):
    pass


def _get_json(url: str, headers: dict | None = None, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "content-pipeline/1.0",
                                               **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:300]
        raise StockError(f"HTTP {exc.code} z {urllib.parse.urlparse(url).netloc}: {body}") from exc
    except urllib.error.URLError as exc:
        raise StockError(f"Sieć: {exc.reason}") from exc


def _score(width: int, height: int, duration: float, needed_s: float) -> float:
    """Im wyżej, tym lepiej. Premiujemy pion, rozdzielczość ≥1080 i to,
    żeby klip pokrył całą scenę bez zapętlania."""
    if not width or not height:
        return -1.0
    ratio = width / height
    score = 0.0
    score += 40.0 if height > width else -25.0          # pion to wymóg Reelsa
    score -= abs(ratio - TARGET_RATIO) * 30.0           # im bliżej 9:16, tym mniej dokadrowania
    score += 12.0 if width >= 1080 else -8.0
    score -= max(0, 2160 - width) / 2000.0              # lekka premia za 4K
    if duration:
        score += 15.0 if duration >= needed_s else -(needed_s - duration) * 1.5
        score -= max(0.0, duration - needed_s - 20) * 0.1   # bardzo długie = duży plik
    return score


# --------------------------------------------------------------------------- #
# Pexels
# --------------------------------------------------------------------------- #
def search_pexels(query: str, api_key: str, needed_s: float,
                  per_page: int = 15) -> list[dict]:
    params = urllib.parse.urlencode({"query": query, "orientation": "portrait",
                                     "per_page": per_page})
    data = _get_json(f"{PEXELS_SEARCH}?{params}", {"Authorization": api_key})
    results: list[dict] = []
    for video in data.get("videos", []):
        duration = float(video.get("duration") or 0)
        best = None
        for f in video.get("video_files", []):
            if f.get("file_type") not in (None, "video/mp4"):
                continue
            width, height = int(f.get("width") or 0), int(f.get("height") or 0)
            candidate = {"url": f.get("link"), "width": width, "height": height}
            if best is None or _score(width, height, duration, needed_s) > \
                    _score(best["width"], best["height"], duration, needed_s):
                best = candidate
        if not best or not best["url"]:
            continue
        results.append({
            "source": "pexels",
            "id": video.get("id"),
            "url": best["url"],
            "width": best["width"],
            "height": best["height"],
            "duration_s": duration,
            "author": (video.get("user") or {}).get("name"),
            "page": video.get("url"),
            "score": _score(best["width"], best["height"], duration, needed_s),
        })
    return results


# --------------------------------------------------------------------------- #
# Pixabay
# --------------------------------------------------------------------------- #
def search_pixabay(query: str, api_key: str, needed_s: float,
                   per_page: int = 20) -> list[dict]:
    params = urllib.parse.urlencode({"key": api_key, "q": query,
                                     "video_type": "film", "per_page": per_page,
                                     "safesearch": "true"})
    data = _get_json(f"{PIXABAY_SEARCH}?{params}")
    results: list[dict] = []
    for hit in data.get("hits", []):
        duration = float(hit.get("duration") or 0)
        best = None
        for name in ("large", "medium", "small"):
            variant = (hit.get("videos") or {}).get(name)
            if not variant or not variant.get("url"):
                continue
            width, height = int(variant.get("width") or 0), int(variant.get("height") or 0)
            candidate = {"url": variant["url"], "width": width, "height": height}
            if best is None or _score(width, height, duration, needed_s) > \
                    _score(best["width"], best["height"], duration, needed_s):
                best = candidate
        if not best:
            continue
        results.append({
            "source": "pixabay",
            "id": hit.get("id"),
            "url": best["url"],
            "width": best["width"],
            "height": best["height"],
            "duration_s": duration,
            "author": hit.get("user"),
            "page": hit.get("pageURL"),
            "score": _score(best["width"], best["height"], duration, needed_s),
        })
    return results


# --------------------------------------------------------------------------- #
def find_clip(query: str, *, needed_s: float, env_get,
              exclude_ids: set | None = None) -> dict | None:
    """Najlepsze dostępne ujęcie dla zapytania. None = brak (scena → gradient)."""
    exclude_ids = exclude_ids or set()
    candidates: list[dict] = []
    errors: list[str] = []

    pexels_key = env_get("PEXELS_API_KEY")
    if pexels_key:
        try:
            candidates += search_pexels(query, pexels_key, needed_s)
        except StockError as exc:
            errors.append(f"pexels: {exc}")

    pixabay_key = env_get("PIXABAY_API_KEY")
    if pixabay_key:
        try:
            candidates += search_pixabay(query, pixabay_key, needed_s)
        except StockError as exc:
            errors.append(f"pixabay: {exc}")

    usable = [c for c in candidates
              if f"{c['source']}:{c['id']}" not in exclude_ids and c["score"] > 0]
    if not usable:
        return {"error": "; ".join(errors)} if errors else None
    return max(usable, key=lambda c: c["score"])


def download(clip: dict, dest: Path, timeout: int = 180) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(clip["url"],
                                 headers={"User-Agent": "content-pipeline/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp, dest.open("wb") as fh:
            while chunk := resp.read(1 << 20):
                fh.write(chunk)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        dest.unlink(missing_ok=True)
        raise StockError(f"Pobieranie ujęcia nie powiodło się: {exc}") from exc
    if dest.stat().st_size < 50_000:
        dest.unlink(missing_ok=True)
        raise StockError("Pobrany plik jest podejrzanie mały — pomijam.")
    return dest
