"""Warstwa SQLite: schemat, zapis scrape'u i wykrywanie różnic (diff).

Cała logika "co się zmieniło od poprzedniego przebiegu" siedzi tutaj, żeby
scraper zajmował się wyłącznie pobieraniem danych.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from models import TRACKED_FIELDS, DiffResult, Offer, OfferChange

log = logging.getLogger(__name__)

SCHEMA_VERSION = 1

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS offers (
    offer_id        TEXT PRIMARY KEY,
    portal          TEXT NOT NULL DEFAULT 'otodom',
    url             TEXT NOT NULL,
    title           TEXT,
    price           INTEGER,          -- znormalizowana, w walucie `currency`
    price_raw       TEXT,             -- to, co dosłownie pokazał portal
    currency        TEXT,
    price_per_m2    INTEGER,
    location        TEXT,
    area            REAL,
    rooms           INTEGER,
    description     TEXT,
    date_created    TEXT,             -- data z portalu (ISO), jeśli dostępna
    date_modified   TEXT,
    image_count     INTEGER NOT NULL DEFAULT 0,
    content_hash    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',   -- active | removed
    missing_runs    INTEGER NOT NULL DEFAULT 0,       -- ile przebiegów z rzędu nie widziano oferty
    first_seen_at   TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL,
    last_changed_at TEXT,
    removed_at      TEXT,
    raw_json        TEXT
);

CREATE INDEX IF NOT EXISTS idx_offers_status    ON offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_last_seen ON offers(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_offers_portal    ON offers(portal);

CREATE TABLE IF NOT EXISTS offer_images (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id       TEXT NOT NULL REFERENCES offers(offer_id) ON DELETE CASCADE,
    url            TEXT NOT NULL,
    position       INTEGER NOT NULL DEFAULT 0,
    local_path     TEXT,
    bytes          INTEGER,
    downloaded_at  TEXT,
    UNIQUE(offer_id, url)
);

CREATE INDEX IF NOT EXISTS idx_images_offer ON offer_images(offer_id);

CREATE TABLE IF NOT EXISTS offer_changes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      INTEGER REFERENCES runs(id),
    offer_id    TEXT NOT NULL,
    changed_at  TEXT NOT NULL,
    change_type TEXT NOT NULL,        -- new | price | field | images | removed | restored
    field       TEXT,
    old_value   TEXT,
    new_value   TEXT
);

CREATE INDEX IF NOT EXISTS idx_changes_run   ON offer_changes(run_id);
CREATE INDEX IF NOT EXISTS idx_changes_offer ON offer_changes(offer_id);

CREATE TABLE IF NOT EXISTS runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    status         TEXT NOT NULL,     -- running | ok | blocked | error
    mode           TEXT,
    search_url     TEXT,
    complete       INTEGER NOT NULL DEFAULT 0,  -- czy objęto CAŁY zbiór wyników
    offers_seen    INTEGER NOT NULL DEFAULT 0,
    new_count      INTEGER NOT NULL DEFAULT 0,
    changed_count  INTEGER NOT NULL DEFAULT 0,
    removed_count  INTEGER NOT NULL DEFAULT 0,
    images_saved   INTEGER NOT NULL DEFAULT 0,
    error          TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(db_path: str | Path) -> sqlite3.Connection:
    """Otwiera bazę, zakłada schemat jeśli go nie ma."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()
    return conn


# --------------------------------------------------------------------------
# przebiegi (runs)
# --------------------------------------------------------------------------

def start_run(conn: sqlite3.Connection, mode: str, search_url: str) -> int:
    cur = conn.execute(
        "INSERT INTO runs(started_at, status, mode, search_url) VALUES(?, 'running', ?, ?)",
        (utcnow(), mode, search_url),
    )
    conn.commit()
    return int(cur.lastrowid)


def finish_run(
    conn: sqlite3.Connection,
    run_id: int,
    status: str,
    diff: DiffResult | None = None,
    offers_seen: int = 0,
    images_saved: int = 0,
    complete: bool = False,
    error: str | None = None,
) -> None:
    conn.execute(
        """
        UPDATE runs SET finished_at = ?, status = ?, complete = ?, offers_seen = ?,
                        new_count = ?, changed_count = ?, removed_count = ?,
                        images_saved = ?, error = ?
        WHERE id = ?
        """,
        (
            utcnow(),
            status,
            1 if complete else 0,
            offers_seen,
            len(diff.new) if diff else 0,
            len(diff.changed) if diff else 0,
            len(diff.removed) if diff else 0,
            images_saved,
            error,
            run_id,
        ),
    )
    conn.commit()


def last_run(conn: sqlite3.Connection, only_with_changes: bool = False) -> sqlite3.Row | None:
    sql = "SELECT * FROM runs WHERE finished_at IS NOT NULL"
    if only_with_changes:
        sql += " AND (new_count > 0 OR changed_count > 0 OR removed_count > 0)"
    sql += " ORDER BY id DESC LIMIT 1"
    return conn.execute(sql).fetchone()


# --------------------------------------------------------------------------
# odczyt ofert
# --------------------------------------------------------------------------

def get_offer(conn: sqlite3.Connection, offer_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM offers WHERE offer_id = ?", (offer_id,)).fetchone()


def active_offer_ids(conn: sqlite3.Connection, portal: str) -> set[str]:
    rows = conn.execute(
        "SELECT offer_id FROM offers WHERE status = 'active' AND portal = ?", (portal,)
    ).fetchall()
    return {r["offer_id"] for r in rows}


def offer_image_urls(conn: sqlite3.Connection, offer_id: str) -> list[str]:
    rows = conn.execute(
        "SELECT url FROM offer_images WHERE offer_id = ? ORDER BY position, id", (offer_id,)
    ).fetchall()
    return [r["url"] for r in rows]


def pending_image_downloads(conn: sqlite3.Connection, offer_id: str) -> list[sqlite3.Row]:
    """Zdjęcia, których pliku jeszcze nie mamy na dysku."""
    return conn.execute(
        "SELECT * FROM offer_images WHERE offer_id = ? AND local_path IS NULL ORDER BY position, id",
        (offer_id,),
    ).fetchall()


def mark_image_downloaded(
    conn: sqlite3.Connection, offer_id: str, url: str, local_path: str, size: int
) -> None:
    conn.execute(
        "UPDATE offer_images SET local_path = ?, bytes = ?, downloaded_at = ? "
        "WHERE offer_id = ? AND url = ?",
        (local_path, size, utcnow(), offer_id, url),
    )
    conn.commit()


# --------------------------------------------------------------------------
# zapis scrape'u + diff
# --------------------------------------------------------------------------

def _fmt(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str) and len(value) > 300:
        return value[:297] + "..."
    return str(value)


def _merge_with_existing(offer: Offer, row: sqlite3.Row) -> Offer:
    """Nie gubimy danych, których ten przebieg nie pobrał.

    Przykład: przebieg bez `fetch_details` nie ma opisu ani pełnej galerii —
    bez tego scalania każdy taki przebieg raportowałby fałszywą "zmianę opisu".
    """
    for name in ("title", "price", "price_raw", "currency", "price_per_m2",
                 "location", "area", "rooms", "description", "date_created", "date_modified"):
        if getattr(offer, name) is None and row[name] is not None:
            setattr(offer, name, row[name])
    return offer


def _diff_fields(offer: Offer, row: sqlite3.Row) -> list[OfferChange]:
    changes: list[OfferChange] = []
    for name in TRACKED_FIELDS:
        new_value = getattr(offer, name)
        old_value = row[name]
        if new_value is None and old_value is None:
            continue
        # SQLite oddaje REAL/INTEGER — porównujemy po normalizacji do tekstu,
        # żeby 120.0 vs 120 nie robiło fałszywej zmiany.
        if _fmt(new_value) == _fmt(old_value):
            continue
        changes.append(
            OfferChange(
                offer_id=offer.offer_id,
                change_type="price" if name == "price" else "field",
                field=name,
                old_value=_fmt(old_value),
                new_value=_fmt(new_value),
                title=offer.title,
                url=offer.url,
            )
        )
    return changes


def _upsert_images(conn: sqlite3.Connection, offer: Offer) -> None:
    if not offer.image_urls:
        return
    for position, url in enumerate(offer.image_urls):
        conn.execute(
            "INSERT INTO offer_images(offer_id, url, position) VALUES(?, ?, ?) "
            "ON CONFLICT(offer_id, url) DO UPDATE SET position = excluded.position",
            (offer.offer_id, url, position),
        )


def _write_offer(conn: sqlite3.Connection, offer: Offer, *, is_new: bool, changed: bool) -> None:
    now = utcnow()
    payload = {
        "offer_id": offer.offer_id,
        "portal": offer.portal,
        "url": offer.url,
        "title": offer.title,
        "price": offer.price,
        "price_raw": offer.price_raw,
        "currency": offer.currency,
        "price_per_m2": offer.price_per_m2,
        "location": offer.location,
        "area": offer.area,
        "rooms": offer.rooms,
        "description": offer.description,
        "date_created": offer.date_created,
        "date_modified": offer.date_modified,
        "image_count": len(offer.image_urls),
        "content_hash": offer.content_hash(),
        "raw_json": json.dumps(offer.raw, ensure_ascii=False) if offer.raw else None,
    }

    if is_new:
        payload.update(
            status="active", missing_runs=0, first_seen_at=now, last_seen_at=now,
            last_changed_at=now, removed_at=None,
        )
        columns = ", ".join(payload)
        placeholders = ", ".join(f":{k}" for k in payload)
        conn.execute(f"INSERT INTO offers({columns}) VALUES({placeholders})", payload)
    else:
        payload.update(status="active", missing_runs=0, last_seen_at=now, removed_at=None)
        assignments = ", ".join(f"{k} = :{k}" for k in payload if k != "offer_id")
        if changed:
            assignments += ", last_changed_at = :last_changed_at"
            payload["last_changed_at"] = now
        conn.execute(f"UPDATE offers SET {assignments} WHERE offer_id = :offer_id", payload)

    _upsert_images(conn, offer)


def _log_changes(
    conn: sqlite3.Connection, run_id: int | None, changes: Iterable[OfferChange]
) -> None:
    now = utcnow()
    conn.executemany(
        "INSERT INTO offer_changes(run_id, offer_id, changed_at, change_type, field, old_value, new_value) "
        "VALUES(?, ?, ?, ?, ?, ?, ?)",
        [
            (run_id, c.offer_id, now, c.change_type, c.field, c.old_value, c.new_value)
            for c in changes
        ],
    )


def record_scrape(
    conn: sqlite3.Connection,
    offers: list[Offer],
    *,
    run_id: int | None = None,
    portal: str = "otodom",
    detect_removals: bool = True,
    missing_runs_threshold: int = 2,
) -> DiffResult:
    """Zapisuje wynik scrape'u i zwraca różnice względem poprzedniego stanu.

    `detect_removals` musi być False, gdy przebieg NIE objął całego zbioru
    wyników (limit ofert, przerwany przebieg) — inaczej oznaczylibyśmy jako
    usunięte oferty, których po prostu nie zdążyliśmy zobaczyć.
    """
    diff = DiffResult(removal_detection_ran=detect_removals)
    seen_ids: set[str] = set()

    for offer in offers:
        if not offer.offer_id:
            log.warning("Pomijam ofertę bez ID: %s", offer.url)
            continue
        seen_ids.add(offer.offer_id)
        row = get_offer(conn, offer.offer_id)

        if row is None:
            _write_offer(conn, offer, is_new=True, changed=True)
            _log_changes(conn, run_id, [OfferChange(
                offer_id=offer.offer_id, change_type="new",
                new_value=offer.short(), title=offer.title, url=offer.url,
            )])
            diff.new.append(offer)
            continue

        offer = _merge_with_existing(offer, row)
        changes = _diff_fields(offer, row)

        old_images = set(offer_image_urls(conn, offer.offer_id))
        new_images = set(offer.image_urls)
        if new_images and new_images != old_images:
            added = len(new_images - old_images)
            gone = len(old_images - new_images)
            if added or gone:
                changes.append(OfferChange(
                    offer_id=offer.offer_id, change_type="images", field="images",
                    old_value=str(len(old_images)), new_value=str(len(new_images)),
                    title=offer.title, url=offer.url,
                ))
        elif not new_images:
            # Ten przebieg nie pobierał galerii — zachowujemy to, co już mamy.
            offer.image_urls = sorted(old_images)

        was_removed = row["status"] == "removed"
        _write_offer(conn, offer, is_new=False, changed=bool(changes))

        if was_removed:
            _log_changes(conn, run_id, [OfferChange(
                offer_id=offer.offer_id, change_type="restored",
                new_value=offer.short(), title=offer.title, url=offer.url,
            )])
            diff.restored.append(offer)
        if changes:
            _log_changes(conn, run_id, changes)
            diff.changed.append((offer, changes))
        elif not was_removed:
            diff.unchanged += 1

    if detect_removals:
        _detect_removals(conn, run_id, seen_ids, portal, missing_runs_threshold, diff)

    conn.commit()
    return diff


def _detect_removals(
    conn: sqlite3.Connection,
    run_id: int | None,
    seen_ids: set[str],
    portal: str,
    threshold: int,
    diff: DiffResult,
) -> None:
    """Oferta znika z wyników — ale dopiero po N przebiegach uznajemy ją za usuniętą.

    Jeden nieudany request albo chwilowa zmiana kolejności wyników nie powinna
    generować fałszywego "oferta usunięta".
    """
    now = utcnow()
    missing = [
        row for row in conn.execute(
            "SELECT * FROM offers WHERE status = 'active' AND portal = ?", (portal,)
        ).fetchall()
        if row["offer_id"] not in seen_ids
    ]

    for row in missing:
        streak = row["missing_runs"] + 1
        if streak >= threshold:
            conn.execute(
                "UPDATE offers SET status = 'removed', removed_at = ?, missing_runs = ?, "
                "last_changed_at = ? WHERE offer_id = ?",
                (now, streak, now, row["offer_id"]),
            )
            _log_changes(conn, run_id, [OfferChange(
                offer_id=row["offer_id"], change_type="removed",
                old_value=row["title"], title=row["title"], url=row["url"],
            )])
            diff.removed.append(dict(row))
        else:
            conn.execute(
                "UPDATE offers SET missing_runs = ? WHERE offer_id = ?",
                (streak, row["offer_id"]),
            )
            log.debug(
                "Oferta %s nieobecna (%d/%d przebiegów) — jeszcze nie oznaczam jako usuniętej",
                row["offer_id"], streak, threshold,
            )


def changes_for_run(conn: sqlite3.Connection, run_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT c.*, o.title, o.url, o.price, o.area, o.rooms, o.location
        FROM offer_changes c
        LEFT JOIN offers o ON o.offer_id = c.offer_id
        WHERE c.run_id = ?
        ORDER BY CASE c.change_type
                     WHEN 'new' THEN 0 WHEN 'price' THEN 1 WHEN 'field' THEN 2
                     WHEN 'images' THEN 3 WHEN 'restored' THEN 4 ELSE 5 END,
                 c.offer_id
        """,
        (run_id,),
    ).fetchall()


def stats(conn: sqlite3.Connection) -> dict[str, Any]:
    row = conn.execute(
        "SELECT COUNT(*) AS total, "
        "SUM(status = 'active') AS active, "
        "SUM(status = 'removed') AS removed FROM offers"
    ).fetchone()
    images = conn.execute(
        "SELECT COUNT(*) AS total, SUM(local_path IS NOT NULL) AS downloaded FROM offer_images"
    ).fetchone()
    return {
        "offers_total": row["total"] or 0,
        "offers_active": row["active"] or 0,
        "offers_removed": row["removed"] or 0,
        "images_total": images["total"] or 0,
        "images_downloaded": images["downloaded"] or 0,
    }
