#!/usr/bin/env python3
"""KROK 10 — analytics-tracker (darmowe metryki z Graph API).

Pobiera insights opublikowanego Reelsa tym samym tokenem co publisher (bez
dodatkowych kosztów) i zapisuje je do lokalnego SQLite. Ta baza jest wejściem
dla kroku 1 — researcher czyta `top_performers`, żeby kolejne scenariusze
opierać na tym, co realnie zadziałało.

Tryby:
  (domyślny)  metryki dla runu wskazanego przez --run-dir
  --refresh-all
              odświeża metryki dla WSZYSTKICH opublikowanych postów w bazie
              (do crona — Reels rośnie jeszcze wiele dni po publikacji)

Uwaga: metryki `impressions`, `plays` i `video_views` zostały wycofane przez
Metę w v22.0 — używamy `views`. Świeżo opublikowany post potrafi przez
kilkanaście minut zwracać puste wartości; to nie jest błąd.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib import db
from lib.ig_api import MEDIA_METRICS, InstagramClient, InstagramError
from lib.runio import (Run, base_parser, emit, env, fail, now_iso, read_json,
                       write_json)

STEP = "analytics_tracker"


def collect_for_media(client: InstagramClient, media_id: str) -> dict:
    insights = client.media_insights(media_id, MEDIA_METRICS)
    details = {}
    try:
        details = client.media_details(media_id)
    except InstagramError:
        pass
    engagement = sum(int(insights.get(k) or 0)
                     for k in ("likes", "comments", "shares", "saved"))
    views = int(insights.get("views") or 0)
    insights["engagement_total"] = engagement
    insights["engagement_rate"] = round(engagement / views, 4) if views else None
    insights["permalink"] = details.get("permalink")
    return insights


def main() -> None:
    parser = base_parser("Krok 10/10 — analytics-tracker (Instagram Insights)")
    parser.add_argument("--refresh-all", action="store_true",
                        help="odśwież metryki wszystkich opublikowanych postów")
    parser.add_argument("--media-id", default=None,
                        help="konkretne ID mediów (pomija publish.json)")
    args = parser.parse_args()

    run = Run(args.run_dir)
    token, ig_user = env("IG_ACCESS_TOKEN"), env("IG_USER_ID")
    conn = db.connect()

    if not token or not ig_user:
        note = ("Brak IG_ACCESS_TOKEN/IG_USER_ID — metryki nie zostaną pobrane. "
                "Reels mógł zostać opublikowany ręcznie; wpisz statystyki "
                "samodzielnie albo uzupełnij token w .env.")
        write_json(run.analytics, {"status": "skipped", "reason": note,
                                   "collected_at": now_iso()})
        run.step_skipped(STEP, note)
        run.log(STEP, note)
        emit({"status": "skipped", "step": STEP, "reason": note})
        return

    client = InstagramClient(token, ig_user)

    if args.refresh_all:
        posts = db.published_posts(conn)
        refreshed, failures = [], []
        for post in posts:
            media_id = post.get("ig_media_id")
            if not media_id:
                continue
            try:
                metrics = collect_for_media(client, media_id)
                db.insert_metrics(conn, post["run_id"], media_id, now_iso(), metrics)
                refreshed.append({"run_id": post["run_id"], "media_id": media_id,
                                  "views": metrics.get("views")})
            except InstagramError as exc:
                failures.append({"run_id": post["run_id"], "error": str(exc)})
        conn.close()
        emit({"status": "ok", "step": STEP, "mode": "refresh-all",
              "refreshed": refreshed, "failures": failures})
        return

    media_id = args.media_id
    if not media_id:
        if not run.publish.exists():
            fail(run, STEP, "Brak publish.json — krok 9 nie został wykonany.")
        media_id = read_json(run.publish).get("media_id")

    if not media_id:
        note = ("Post nie ma ID mediów (publikacja ręczna albo nieudana) — "
                "brak metryk do pobrania.")
        write_json(run.analytics, {"status": "skipped", "reason": note,
                                   "collected_at": now_iso()})
        run.step_skipped(STEP, note)
        run.log(STEP, note)
        emit({"status": "skipped", "step": STEP, "reason": note})
        conn.close()
        return

    try:
        metrics = collect_for_media(client, media_id)
    except InstagramError as exc:
        conn.close()
        fail(run, STEP, f"Nie udało się pobrać metryk: {exc}",
             hint="świeży post może przez chwilę nie mieć insights — spróbuj później")

    collected_at = now_iso()
    db.insert_metrics(conn, run.dir.name, media_id, collected_at, metrics)
    top = db.top_performers(conn, limit=5)
    conn.close()

    payload = {
        "status": "ok",
        "run_id": run.dir.name,
        "media_id": media_id,
        "collected_at": collected_at,
        "baseline": metrics,
        "note": ("To jest odczyt dnia 0. Reels rośnie jeszcze przez wiele dni — "
                 "uruchamiaj `--refresh-all` z crona, żeby mieć trend."),
        "top_performers_so_far": top,
    }
    write_json(run.analytics, payload)
    run.step_done(STEP, output="analytics.json", media_id=media_id,
                  views=metrics.get("views"))
    run.log(STEP, f"Metryki dnia 0: views={metrics.get('views')}, "
                  f"reach={metrics.get('reach')}, likes={metrics.get('likes')}, "
                  f"ER={metrics.get('engagement_rate')}")
    emit({"status": "ok", "step": STEP, "media_id": media_id, "metrics": metrics})


if __name__ == "__main__":
    main()
