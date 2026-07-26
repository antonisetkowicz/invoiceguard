#!/usr/bin/env python3
"""KROK 7 — thumbnail-generator (Remotion Still, darmowo).

Miniatura 1080x1920: hook na gradiencie + plakietka z obietnicą
(`thumbnail_badge` / słowo kluczowe / CTA ze scenariusza).
Opcjonalnie (--image) tło z Pollinations.ai — darmowe, bez klucza.

Fallback, jeśli Remotion nie chce się wyrenderować: klatka z gotowego wideo
przez ffmpeg. Miniatura nigdy nie może zatrzymać pipeline'u.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.ffmpeg import run_ffmpeg
from lib.runio import (ROOT, Run, base_parser, emit, fail, load_config,
                       read_json, write_json)

STEP = "thumbnail_generator"
REMOTION_DIR = ROOT / "remotion"


def derive_subline(script: dict) -> str:
    """Plakietka pod hookiem — musi być czytelną frazą, nie ozdobnikiem.

    Kolejność: jawny `thumbnail_badge` ze scenariusza → pierwsze słowo
    kluczowe → krótkie CTA. Świadomie NIE robimy plakietki z samej liczby
    wyciągniętej z hooka: bez rzeczownika („3 sposoby") wychodzi bełkot.
    """
    badge = (script.get("thumbnail_badge") or "").strip()
    if badge:
        return badge[:28]
    keywords = [str(k).strip() for k in (script.get("keywords") or []) if str(k).strip()]
    if keywords:
        return keywords[0][:28]
    cta = (script.get("cta") or "").strip()
    return cta[:28] if 0 < len(cta) <= 28 else ""


def render_still(props_path: Path, out_path: Path, cfg: dict) -> None:
    cmd = ["npx", "--yes", "remotion", "still", "src/index.ts", "Thumbnail",
           str(out_path), f"--props={props_path}",
           f"--width={cfg['video']['width']}",
           f"--height={cfg['video']['height']}",
           "--image-format=jpeg", "--jpeg-quality=92",
           "--log=error", "--overwrite"]
    proc = subprocess.run(cmd, cwd=REMOTION_DIR, capture_output=True, text=True)
    if proc.returncode != 0 or not out_path.exists():
        raise RuntimeError((proc.stderr or proc.stdout).strip()[-1200:])


def fallback_frame(run: Run, at_s: float = 1.2) -> None:
    source = run.final if run.final.exists() else run.captioned
    run_ffmpeg(["-ss", f"{at_s}", "-i", str(source), "-frames:v", "1",
                "-q:v", "3", str(run.thumbnail)])


def main() -> None:
    parser = base_parser("Krok 7/10 — thumbnail-generator (Remotion Still)")
    parser.add_argument("--image", action="store_true",
                        help="tło z Pollinations.ai (darmowe, opcjonalne)")
    args = parser.parse_args()

    run = Run(args.run_dir)
    cfg = load_config()

    if not run.script.exists():
        fail(run, STEP, f"Brak {run.script} — najpierw krok 2.")

    script = read_json(run.script)
    hook = (script.get("hook") or
            (script.get("scenes") or [{}])[0].get("text") or "").strip()

    image_src = None
    if args.image:
        sys.path.insert(0, str(ROOT / "agents"))
        from importlib import import_module
        visual_builder = import_module("04_visual_builder")
        path = visual_builder.fetch_pollinations(
            f"{hook}, cinematic vertical background, high contrast, no text",
            run.temp("thumb_bg.jpg"))
        image_src = f"file://{path}" if path else None
        if image_src is None:
            run.log(STEP, "Pollinations.ai niedostępny — miniatura na samym gradiencie.")

    props = {
        "hook": hook[:110],
        "subline": derive_subline(script),
        "imageSrc": image_src,
        "theme": cfg.get("theme") or {
            "palette": [["#0f172a", "#3b0764"], ["#111827", "#065f46"],
                        ["#1e1b4b", "#831843"], ["#0c4a6e", "#0f172a"],
                        ["#18181b", "#7c2d12"]],
            "accent": "#fbbf24",
            "textColor": "#ffffff",
            "fontFamily": '"Inter", "Helvetica Neue", "Segoe UI", "DejaVu Sans", system-ui, sans-serif',
        },
    }
    props_path = run.temp("thumbnail_props.json")
    write_json(props_path, props)

    source = "remotion"
    try:
        render_still(props_path, run.thumbnail, cfg)
    except Exception as exc:  # noqa: BLE001
        run.log(STEP, f"Remotion Still nie zadziałał ({exc}) — biorę klatkę z wideo.")
        try:
            fallback_frame(run)
            source = "ffmpeg-frame"
        except Exception as fallback_exc:  # noqa: BLE001
            fail(run, STEP, f"Miniatura nie powstała: {exc} | {fallback_exc}")

    run.step_done(STEP, output="thumbnail.jpg", source=source)
    run.log(STEP, f"Miniatura gotowa ({source}): {run.thumbnail}")
    emit({"status": "ok", "step": STEP, "output": str(run.thumbnail),
          "source": source, "hook": props["hook"]})


if __name__ == "__main__":
    main()
