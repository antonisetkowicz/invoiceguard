"""Pobieranie plików zdjęć na dysk: ./images/{offer_id}/.

Używamy kontekstu HTTP Playwrighta (a nie osobnej sesji requests), żeby
zdjęcia leciały z tymi samymi ciasteczkami i nagłówkami co przeglądarka.
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import sqlite3
from pathlib import Path

import db
from config import Config
from models import Offer
from scraper import RateLimiter, safe_dir_name

log = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"}


def _extension(url: str, content_type: str | None) -> str:
    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if guessed in ALLOWED_EXTENSIONS:
            return ".jpg" if guessed == ".jpe" else guessed
    suffix = Path(url.split("?")[0]).suffix.lower()
    return suffix if suffix in ALLOWED_EXTENSIONS else ".jpg"


def _target_path(images_dir: Path, offer_id: str, position: int, url: str, ext: str) -> Path:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return images_dir / safe_dir_name(offer_id) / f"{position:03d}_{digest}{ext}"


def download_offer_images(
    request_context,
    conn: sqlite3.Connection,
    offer: Offer,
    cfg: Config,
    limiter: RateLimiter | None = None,
) -> int:
    """Pobiera brakujące zdjęcia oferty. Zwraca liczbę zapisanych plików."""
    if not cfg.download_images:
        return 0

    rows = db.pending_image_downloads(conn, offer.offer_id) if not cfg.overwrite_images else \
        conn.execute(
            "SELECT * FROM offer_images WHERE offer_id = ? ORDER BY position, id",
            (offer.offer_id,),
        ).fetchall()

    if cfg.max_images_per_offer:
        rows = rows[: cfg.max_images_per_offer]
    if not rows:
        return 0

    saved = 0
    for row in rows:
        url = row["url"]
        try:
            if limiter:
                limiter.wait()
            response = request_context.get(url, timeout=cfg.image_timeout_ms)
            if response.status != 200:
                log.warning("Zdjęcie %s: HTTP %s", url, response.status)
                continue
            body = response.body()
            if not body:
                continue

            ext = _extension(url, response.headers.get("content-type"))
            path = _target_path(cfg.images_dir, offer.offer_id, row["position"], url, ext)
            if path.exists() and not cfg.overwrite_images:
                db.mark_image_downloaded(conn, offer.offer_id, url, str(path), path.stat().st_size)
                continue

            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            db.mark_image_downloaded(conn, offer.offer_id, url, str(path), len(body))
            saved += 1
        except Exception as exc:  # pojedyncze zdjęcie nie może wywalić przebiegu
            log.warning("Nie udało się pobrać %s: %s", url, exc)

    if saved:
        log.debug("Oferta %s: zapisano %d zdjęć", offer.offer_id, saved)
    return saved


def download_all(
    request_context,
    conn: sqlite3.Connection,
    offers: list[Offer],
    cfg: Config,
    limiter: RateLimiter | None = None,
) -> int:
    total = 0
    for offer in offers:
        total += download_offer_images(request_context, conn, offer, cfg, limiter)
    return total
