"""Lokalna baza SQLite — opublikowane Reelsy + metryki w czasie.

Zasilana przez 09_publisher.py, czytana przez 10_analytics_tracker.py
i 01_researcher.py (uczenie się, co działa). Zero usług zewnętrznych.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "content.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS posts (
    run_id        TEXT PRIMARY KEY,
    ig_media_id   TEXT,
    permalink     TEXT,
    topic         TEXT,
    hook          TEXT,
    caption       TEXT,
    hashtags      TEXT,
    duration_s    REAL,
    video_path    TEXT,
    published_at  TEXT,
    provider      TEXT,
    status        TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS metrics (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id        TEXT NOT NULL,
    ig_media_id   TEXT,
    collected_at  TEXT NOT NULL,
    views         INTEGER,
    reach         INTEGER,
    likes         INTEGER,
    comments      INTEGER,
    shares        INTEGER,
    saved         INTEGER,
    raw           TEXT,
    FOREIGN KEY (run_id) REFERENCES posts(run_id)
);

CREATE INDEX IF NOT EXISTS idx_metrics_run ON metrics(run_id);
"""


def connect(db_path: Path | str = DB_PATH) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert_post(conn: sqlite3.Connection, post: dict[str, Any]) -> None:
    cols = ["run_id", "ig_media_id", "permalink", "topic", "hook", "caption",
            "hashtags", "duration_s", "video_path", "published_at", "provider", "status"]
    values = {c: post.get(c) for c in cols}
    if isinstance(values["hashtags"], list):
        values["hashtags"] = " ".join(values["hashtags"])
    placeholders = ", ".join("?" for _ in cols)
    updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c != "run_id")
    conn.execute(
        f"INSERT INTO posts ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(run_id) DO UPDATE SET {updates}",
        [values[c] for c in cols],
    )
    conn.commit()


def insert_metrics(conn: sqlite3.Connection, run_id: str, ig_media_id: str | None,
                   collected_at: str, metrics: dict[str, Any]) -> None:
    conn.execute(
        "INSERT INTO metrics (run_id, ig_media_id, collected_at, views, reach, "
        "likes, comments, shares, saved, raw) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (run_id, ig_media_id, collected_at,
         metrics.get("views"), metrics.get("reach"), metrics.get("likes"),
         metrics.get("comments"), metrics.get("shares"), metrics.get("saved"),
         json.dumps(metrics, ensure_ascii=False)),
    )
    conn.commit()


def published_posts(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC"
    ).fetchall()
    return [dict(r) for r in rows]


def top_performers(conn: sqlite3.Connection, limit: int = 10) -> list[dict]:
    """Najlepsze posty wg ostatniego odczytu views — wejście dla researchera."""
    rows = conn.execute(
        """
        SELECT p.run_id, p.topic, p.hook, p.hashtags, p.permalink,
               m.views, m.reach, m.likes, m.comments, m.shares, m.saved,
               m.collected_at
        FROM posts p
        JOIN metrics m ON m.id = (
            SELECT id FROM metrics WHERE run_id = p.run_id
            ORDER BY collected_at DESC LIMIT 1
        )
        WHERE p.status = 'published'
        ORDER BY COALESCE(m.views, 0) DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]
