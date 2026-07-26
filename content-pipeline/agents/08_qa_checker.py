#!/usr/bin/env python3
"""KROK 8 — qa-checker (CHECKPOINT Z CZŁOWIEKIEM).

Trzy tryby:
  (domyślny)  waliduje final.mp4 technicznie pod kątem wymagań Reelsów,
              kopiuje wideo + miniaturę do output/ i wystawia qa_report.json
              ze `status: awaiting_approval`. TU PIPELINE SIĘ ZATRZYMUJE.
  --approve   zapisuje zgodę człowieka → krok 9 może publikować.
  --reject "powód"
              zapisuje feedback → orkiestrator wraca do kroku 2 (scriptwriter).

Krok 9 odmawia publikacji, jeśli w qa_report.json nie ma `approved: true`.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.ffmpeg import duration_s, has_audio, probe
from lib.runio import (ROOT, Run, base_parser, emit, fail, load_config, now_iso,
                       read_json, slugify, write_json)

STEP = "qa_checker"
OUTPUT_DIR = ROOT / "output"

# Wymagania Instagram Reels przez Content Publishing API
MIN_DURATION_S = 3.0
MAX_DURATION_S = 90.0
RECOMMENDED_MIN_S = 5.0     # poniżej 5 s Reels nie trafia do zakładki Reels
MAX_FILESIZE_MB = 1000.0
TARGET_ASPECT = 9 / 16


def technical_checks(video: Path, cfg: dict) -> tuple[list[dict], dict]:
    info = probe(video)
    vstream = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    astream = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    width = int(vstream["width"]) if vstream else 0
    height = int(vstream["height"]) if vstream else 0
    dur = duration_s(video)
    size_mb = video.stat().st_size / (1024 * 1024)
    aspect = (width / height) if height else 0

    checks: list[dict] = []

    def check(name: str, ok: bool, detail: str, blocking: bool = True) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail,
                       "blocking": blocking})

    check("strumień wideo", vstream is not None, "brak strumienia wideo" if not vstream
          else f"{vstream.get('codec_name')} {width}x{height}")
    check("kodek wideo", (vstream or {}).get("codec_name") in {"h264", "hevc"},
          f"kodek: {(vstream or {}).get('codec_name')} (wymagany H.264/HEVC)")
    check("proporcje 9:16", abs(aspect - TARGET_ASPECT) < 0.02,
          f"{width}x{height} → {aspect:.4f} (oczekiwane {TARGET_ASPECT:.4f})")
    check("rozdzielczość", width >= 720 and height >= 1280,
          f"{width}x{height} (minimum 720x1280, zalecane 1080x1920)")
    check("długość < 90 s", MIN_DURATION_S <= dur <= MAX_DURATION_S,
          f"{dur:.2f}s (dozwolone {MIN_DURATION_S:.0f}–{MAX_DURATION_S:.0f}s)")
    check("długość ≥ 5 s (zakładka Reels)", dur >= RECOMMENDED_MIN_S,
          f"{dur:.2f}s", blocking=False)
    check("ścieżka audio", astream is not None,
          f"kodek: {(astream or {}).get('codec_name')}" if astream else "brak audio")
    check("kodek audio AAC", (astream or {}).get("codec_name") == "aac",
          f"kodek: {(astream or {}).get('codec_name')}", blocking=False)
    check("rozmiar pliku", size_mb <= MAX_FILESIZE_MB,
          f"{size_mb:.1f} MB (limit {MAX_FILESIZE_MB:.0f} MB)")

    stats = {
        "width": width, "height": height, "aspect": round(aspect, 4),
        "duration_s": round(dur, 2), "size_mb": round(size_mb, 2),
        "video_codec": (vstream or {}).get("codec_name"),
        "audio_codec": (astream or {}).get("codec_name"),
        "has_audio": has_audio(video),
    }
    return checks, stats


def main() -> None:
    parser = base_parser("Krok 8/10 — qa-checker (walidacja + checkpoint człowieka)")
    parser.add_argument("--approve", action="store_true", help="zatwierdź publikację")
    parser.add_argument("--reject", default=None, metavar="POWÓD",
                        help="odrzuć z feedbackiem dla scriptwritera")
    args = parser.parse_args()

    run = Run(args.run_dir)
    cfg = load_config()

    # --- decyzja człowieka ------------------------------------------------- #
    if args.approve or args.reject:
        if not run.qa_report.exists():
            fail(run, STEP, "Brak qa_report.json — najpierw uruchom krok 8 bez flag.")
        report = read_json(run.qa_report)
        if args.reject:
            report.update({"status": "rejected", "approved": False,
                           "feedback": args.reject, "decided_at": now_iso()})
            write_json(run.qa_report, report)
            run.merge_state({STEP: {"status": "rejected", "feedback": args.reject}})
            run.log(STEP, f"CZŁOWIEK ODRZUCIŁ: {args.reject}")
            emit({"status": "rejected", "step": STEP, "feedback": args.reject,
                  "next": "wróć do kroku 2 (scriptwriter) z tym feedbackiem"})
            return

        blocking_failures = [c for c in report.get("checks", [])
                             if c["blocking"] and not c["ok"]]
        if blocking_failures:
            fail(run, STEP,
                 "Nie można zatwierdzić — nierozwiązane błędy techniczne: "
                 + "; ".join(c["name"] for c in blocking_failures))
        report.update({"status": "approved", "approved": True,
                       "decided_at": now_iso()})
        write_json(run.qa_report, report)
        run.merge_state({STEP: {"status": "approved", "at": now_iso()}})
        run.log(STEP, "CZŁOWIEK ZATWIERDZIŁ publikację.")
        emit({"status": "approved", "step": STEP, "next": "krok 9 — publisher"})
        return

    # --- walidacja + wystawienie do akceptacji ------------------------------ #
    if not run.final.exists():
        fail(run, STEP, f"Brak {run.final} — najpierw krok 6.")

    script = read_json(run.script, default={})
    checks, stats = technical_checks(run.final, cfg)
    blocking_failures = [c for c in checks if c["blocking"] and not c["ok"]]
    warnings = [c for c in checks if not c["blocking"] and not c["ok"]]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    slug = slugify(script.get("topic") or script.get("hook") or run.dir.name)
    stem = f"{run.dir.name}_{slug}"
    out_video = OUTPUT_DIR / f"{stem}.mp4"
    out_thumb = OUTPUT_DIR / f"{stem}.jpg"
    shutil.copy2(run.final, out_video)
    if run.thumbnail.exists():
        shutil.copy2(run.thumbnail, out_thumb)

    report = {
        "run_id": run.dir.name,
        "generated_at": now_iso(),
        "status": "blocked" if blocking_failures else "awaiting_approval",
        "approved": False,
        "video": str(out_video),
        "thumbnail": str(out_thumb) if out_thumb.exists() else None,
        "stats": stats,
        "checks": checks,
        "blocking_failures": [c["name"] for c in blocking_failures],
        "warnings": [c["name"] for c in warnings],
        "preview": {
            "topic": script.get("topic"),
            "hook": script.get("hook") or
                    (script.get("scenes") or [{}])[0].get("text"),
            "caption": script.get("caption"),
            "hashtags": script.get("hashtags", []),
            "narration": script.get("narration"),
        },
        "how_to_approve": (
            f"python3 content-pipeline/agents/08_qa_checker.py "
            f"--run-dir {run.dir} --approve"),
        "how_to_reject": (
            f"python3 content-pipeline/agents/08_qa_checker.py "
            f"--run-dir {run.dir} --reject \"co poprawić\""),
    }
    write_json(run.qa_report, report)

    run.merge_state({STEP: {"status": report["status"], "at": now_iso(),
                            "video": str(out_video),
                            "blocking_failures": report["blocking_failures"]}})
    run.log(STEP, f"QA: {report['status']}. {len(checks)} testów, "
                  f"{len(blocking_failures)} blokujących, {len(warnings)} ostrzeżeń. "
                  f"Plik: {out_video}")

    emit({"status": report["status"], "step": STEP, "video": str(out_video),
          "thumbnail": report["thumbnail"], "stats": stats,
          "blocking_failures": report["blocking_failures"],
          "warnings": report["warnings"],
          "next": ("popraw i przerenderuj" if blocking_failures
                   else "czekam na akceptację człowieka (--approve / --reject)")})


if __name__ == "__main__":
    main()
