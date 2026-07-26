#!/usr/bin/env python3
"""KROK 9 — publisher (DARMOWA publikacja na Instagramie).

Ścieżka główna: **Instagram Graph API** (Meta for Developers) — dla własnego
konta Business/Creator publikowanie jest bezpłatne, bez limitu miesięcznego
(Meta stosuje tylko limit 50 postów / 24 h). Jednorazowa konfiguracja tokenu
jest opisana w content-pipeline/README.md.

Ścieżka zapasowa: **manual** — plik i caption zostają w output/, dostajesz
gotową instrukcję wrzucenia z telefonu. Używana automatycznie, gdy brakuje
tokenu albo nie da się wystawić publicznego URL-a.

Ayrshare (`--provider ayrshare`) jest zaimplementowany, ale NIE jest darmową
opcją dla Reelsów: darmowy plan obejmuje wyłącznie pojedyncze zdjęcia, wideo
zaczyna się od planu płatnego. Dlatego wymaga jawnej flagi i ostrzega.

Publikacja jest ZABLOKOWANA, dopóki krok 8 nie zapisze `approved: true`.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib import db, hosting
from lib.ig_api import InstagramClient, InstagramError
from lib.runio import (Run, base_parser, emit, env, escalate, fail, load_config,
                       now_iso, read_json, write_json)

STEP = "publisher"
AYRSHARE_ENDPOINT = "https://app.ayrshare.com/api/post"


def build_caption(script: dict) -> str:
    caption = (script.get("caption") or "").strip()
    hashtags = script.get("hashtags") or []
    tags = " ".join(str(h) for h in hashtags if str(h).startswith("#"))
    full = f"{caption}\n\n{tags}".strip() if tags else caption
    return full[:2200]


def publish_manual(run: Run, video: Path, caption: str, reasons: list[str]) -> dict:
    escalate(
        "Reels gotowy do ręcznej publikacji",
        f"Automatyczna publikacja nie była możliwa:\n"
        + "".join(f"- {r}\n" for r in reasons)
        + f"\n**Plik:** `{video}`\n"
        f"**Miniatura:** `{run.qa_report.parent}` → patrz qa_report.json\n\n"
        f"**Caption do wklejenia:**\n\n```\n{caption}\n```\n\n"
        "Wrzuć plik na telefon (AirDrop / Dysk Google) → Instagram → Reels → "
        "wklej caption → opublikuj.\n\n"
        "Żeby kolejne runy publikowały się same, uzupełnij `IG_ACCESS_TOKEN` "
        "i `IG_USER_ID` w `.env` — instrukcja krok po kroku jest w "
        "`content-pipeline/README.md`.",
    )
    return {"provider": "manual", "status": "manual_required", "reasons": reasons}


def publish_ayrshare(video_url: str, caption: str, api_key: str) -> dict:
    payload = json.dumps({
        "post": caption,
        "platforms": ["instagram"],
        "mediaUrls": [video_url],
        "isVideo": True,
        "instagramOptions": {"reels": True, "shareReelsFeed": True},
    }).encode()
    req = urllib.request.Request(
        AYRSHARE_ENDPOINT, data=payload,
        headers={"Authorization": f"Bearer {api_key}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            f"Ayrshare {exc.code}: {exc.read().decode('utf-8', 'replace')[:400]}"
        ) from exc


def main() -> None:
    parser = base_parser("Krok 9/10 — publisher (Instagram Graph API)")
    parser.add_argument("--provider", default=None,
                        choices=["instagram_graph", "manual", "ayrshare"])
    parser.add_argument("--hosting", default=None,
                        choices=["auto", "public_base_url", "github_release", "catbox"])
    parser.add_argument("--dry-run", action="store_true",
                        help="wystaw publiczny URL, ale NIE publikuj")
    parser.add_argument("--force", action="store_true",
                        help="publikuj mimo braku akceptacji z kroku 8 (odradzane)")
    args = parser.parse_args()

    run = Run(args.run_dir)
    cfg = load_config()
    provider = args.provider or cfg["publish"]["provider"]
    hosting_mode = args.hosting or cfg["publish"]["hosting"]

    # --- bramka akceptacji -------------------------------------------------- #
    if not run.qa_report.exists():
        fail(run, STEP, "Brak qa_report.json — krok 8 (QA) nie został wykonany.")
    qa = read_json(run.qa_report)
    if not qa.get("approved") and not args.force:
        fail(run, STEP,
             f"Brak akceptacji człowieka (qa_report.status={qa.get('status')}). "
             f"Zatwierdź: {qa.get('how_to_approve')}",
             hint="publikacja bez akceptacji jest zablokowana z premedytacją")

    video = Path(qa["video"])
    if not video.exists():
        fail(run, STEP, f"Plik wideo z QA nie istnieje: {video}")

    script = read_json(run.script, default={})
    caption = build_caption(script)
    conn = db.connect()
    db.upsert_post(conn, {
        "run_id": run.dir.name,
        "topic": script.get("topic"),
        "hook": script.get("hook") or (script.get("scenes") or [{}])[0].get("text"),
        "caption": caption,
        "hashtags": script.get("hashtags", []),
        "duration_s": qa.get("stats", {}).get("duration_s"),
        "video_path": str(video),
        "provider": provider,
        "status": "pending",
    })

    reasons: list[str] = []
    result: dict

    if provider == "manual":
        reasons.append("wymuszony tryb ręczny (--provider manual)")
        result = publish_manual(run, video, caption, reasons)
    else:
        # 1) publiczny URL — Graph API pobiera plik samo, nie da się wysłać bajtów
        upload = hosting.upload(video, mode=hosting_mode, env_get=env)
        video_url = upload["url"]
        if not video_url:
            reasons.append("nie udało się wystawić publicznego URL-a wideo: "
                           + "; ".join(upload["errors"]))
            result = publish_manual(run, video, caption, reasons)
        elif args.dry_run:
            result = {"provider": provider, "status": "dry_run",
                      "video_url": video_url, "hosting_backend": upload["backend"],
                      "caption": caption}
        elif provider == "ayrshare":
            api_key = env("AYRSHARE_API_KEY")
            if not api_key:
                reasons.append("brak AYRSHARE_API_KEY")
                result = publish_manual(run, video, caption, reasons)
            else:
                run.log(STEP, "UWAGA: Ayrshare nie publikuje wideo na darmowym "
                              "planie — ten krok może się nie powieść bez subskrypcji.")
                try:
                    response = publish_ayrshare(video_url, caption, api_key)
                    result = {"provider": "ayrshare", "status": "published",
                              "video_url": video_url, "response": response}
                except RuntimeError as exc:
                    reasons.append(f"Ayrshare odrzucił publikację: {exc}")
                    result = publish_manual(run, video, caption, reasons)
        else:
            token, ig_user = env("IG_ACCESS_TOKEN"), env("IG_USER_ID")
            if not token or not ig_user:
                reasons.append("brak IG_ACCESS_TOKEN / IG_USER_ID w .env")
                result = publish_manual(run, video, caption, reasons)
            else:
                try:
                    client = InstagramClient(token, ig_user)
                    run.log(STEP, f"Publikuję przez Graph API "
                                  f"(hosting: {upload['backend']}, url: {video_url})")
                    published = client.publish_reel(
                        video_url, caption,
                        share_to_feed=cfg["publish"]["share_to_feed"],
                        on_poll=lambda code, _s: run.log(
                            STEP, f"status kontenera: {code}"))
                    result = {"provider": "instagram_graph", "status": "published",
                              "video_url": video_url,
                              "hosting_backend": upload["backend"],
                              "media_id": published.get("media_id"),
                              "permalink": published.get("permalink"),
                              "container_id": published.get("container_id")}
                except InstagramError as exc:
                    reasons.append(f"Instagram Graph API: {exc}")
                    result = publish_manual(run, video, caption, reasons)
                    result["error_payload"] = exc.payload

    result.update({"run_id": run.dir.name, "published_at": now_iso(),
                   "caption": caption, "video": str(video)})
    write_json(run.publish, result)

    db.upsert_post(conn, {
        "run_id": run.dir.name,
        "ig_media_id": result.get("media_id"),
        "permalink": result.get("permalink"),
        "topic": script.get("topic"),
        "hook": script.get("hook") or (script.get("scenes") or [{}])[0].get("text"),
        "caption": caption,
        "hashtags": script.get("hashtags", []),
        "duration_s": qa.get("stats", {}).get("duration_s"),
        "video_path": str(video),
        "published_at": result["published_at"],
        "provider": result["provider"],
        "status": "published" if result["status"] == "published" else result["status"],
    })
    conn.close()

    run.merge_state({STEP: {"status": result["status"], "at": now_iso(),
                            "provider": result["provider"],
                            "media_id": result.get("media_id"),
                            "permalink": result.get("permalink")}})
    run.log(STEP, f"Publikacja: {result['status']} ({result['provider']}). "
                  f"{result.get('permalink') or ''}")
    emit({"step": STEP, **result})


if __name__ == "__main__":
    main()
