#!/usr/bin/env python3
"""KROK 4 — visual-builder (Remotion, open source).

Buduje props z script.json + rzeczywistej długości lektora i renderuje
visuals.mp4 1080x1920 przez `npx remotion render`. Wszystko rysowane kodem —
gradienty, typografia, kształty, licznik, lista. Zero płatnych API.

Opcjonalnie (--images) dokłada tła z Pollinations.ai — darmowe, bez klucza.
To DODATEK: jeśli generowanie obrazu padnie, scena wraca do gradientu i
pipeline leci dalej.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.ffmpeg import duration_s, video_stream
from lib.runio import (ROOT, Run, base_parser, emit, fail, load_config,
                       read_json, write_json)

STEP = "visual_builder"
REMOTION_DIR = ROOT / "remotion"
POLLINATIONS = "https://image.pollinations.ai/prompt/{prompt}?width=1080&height=1920&nologo=true"


def ensure_remotion_installed() -> None:
    if (REMOTION_DIR / "node_modules" / "remotion").exists():
        return
    if not shutil.which("npm"):
        raise RuntimeError("Brak `npm` — zainstaluj Node.js 18+ (darmowe).")
    proc = subprocess.run(["npm", "install", "--no-audit", "--no-fund"],
                          cwd=REMOTION_DIR, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError("npm install w content-pipeline/remotion nie powiódł się:\n"
                           + proc.stderr.strip()[-1500:])


def fetch_pollinations(prompt: str, out_path: Path, timeout: int = 90) -> Path | None:
    """Darmowy generator obrazów, bez klucza. Zwraca None przy jakimkolwiek błędzie."""
    url = POLLINATIONS.format(prompt=urllib.parse.quote(prompt[:300]))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "content-pipeline/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        if len(data) < 5000:
            return None
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        return out_path
    except Exception:  # noqa: BLE001 - obrazy są opcjonalne z założenia
        return None


def build_props(script: dict, cfg: dict, audio_s: float, *,
                with_images: bool, run: Run) -> dict:
    scenes = []
    for index, scene in enumerate(script.get("scenes", [])):
        visual = dict(scene.get("visual") or {})
        if with_images and visual.get("kind") == "image" and not visual.get("src"):
            prompt = visual.get("prompt") or visual.get("headline") or scene.get("text", "")
            image_path = fetch_pollinations(
                f"{prompt}, cinematic, vertical, high contrast, no text",
                run.temp(f"bg_{index:02d}.jpg"))
            if image_path:
                visual["src"] = f"file://{image_path}"
            else:
                visual["kind"] = "gradient"
                run.log(STEP, f"Scena {index+1}: Pollinations.ai nie odpowiedział — "
                              f"degraduję do gradientu.")
        scenes.append({
            "text": scene.get("text", ""),
            "duration_s": float(scene.get("duration_s") or 0),
            "visual": visual,
        })

    return {
        "scenes": scenes,
        "fps": cfg["video"]["fps"],
        "audioDurationS": round(audio_s, 3),
        "handle": cfg.get("handle", ""),
        "theme": cfg.get("theme") or {
            "palette": [["#0f172a", "#3b0764"], ["#111827", "#065f46"],
                        ["#1e1b4b", "#831843"], ["#0c4a6e", "#0f172a"],
                        ["#18181b", "#7c2d12"]],
            "accent": "#fbbf24",
            "textColor": "#ffffff",
            "fontFamily": '"Inter", "Helvetica Neue", "Segoe UI", "DejaVu Sans", system-ui, sans-serif',
        },
    }


def render(props_path: Path, out_path: Path, cfg: dict, *, concurrency: str | None) -> None:
    cmd = ["npx", "--yes", "remotion", "render", "src/index.ts", "Reel",
           str(out_path),
           f"--props={props_path}",
           f"--width={cfg['video']['width']}",
           f"--height={cfg['video']['height']}",
           "--codec=h264",
           "--log=error",
           "--overwrite"]
    if concurrency:
        cmd.append(f"--concurrency={concurrency}")
    proc = subprocess.run(cmd, cwd=REMOTION_DIR, capture_output=True, text=True)
    if proc.returncode != 0 or not out_path.exists():
        raise RuntimeError("Render Remotion nie powiódł się:\n"
                           + (proc.stderr or proc.stdout).strip()[-2000:])


def main() -> None:
    parser = base_parser("Krok 4/10 — visual-builder (Remotion → 1080x1920)")
    parser.add_argument("--images", action="store_true",
                        help="dociągnij tła z Pollinations.ai (darmowe, opcjonalne)")
    parser.add_argument("--concurrency", default=None,
                        help="liczba równoległych workerów Remotion")
    args = parser.parse_args()

    run = Run(args.run_dir)
    cfg = load_config()

    if not run.script.exists():
        fail(run, STEP, f"Brak {run.script} — najpierw krok 2.")
    if not run.voice.exists():
        fail(run, STEP, f"Brak {run.voice} — najpierw krok 3 (lektor wyznacza długość).")

    script = read_json(run.script)
    audio_s = duration_s(run.voice)

    try:
        ensure_remotion_installed()
    except RuntimeError as exc:
        fail(run, STEP, str(exc))

    props = build_props(script, cfg, audio_s, with_images=args.images, run=run)
    props_path = run.temp("remotion_props.json")
    write_json(props_path, props)

    try:
        render(props_path, run.visuals, cfg, concurrency=args.concurrency)
    except RuntimeError as exc:
        fail(run, STEP, str(exc), hint="uruchom `npm install` w content-pipeline/remotion")

    stream = video_stream(run.visuals) or {}
    result = {
        "path": str(run.visuals),
        "width": stream.get("width"),
        "height": stream.get("height"),
        "duration_s": round(duration_s(run.visuals), 3),
        "scenes": len(props["scenes"]),
        "images_used": args.images,
    }
    run.step_done(STEP, output="visuals.mp4", **result)
    run.log(STEP, f"Wyrenderowano {result['width']}x{result['height']}, "
                  f"{result['duration_s']}s, {result['scenes']} scen "
                  f"(audio: {audio_s:.2f}s).")
    emit({"status": "ok", "step": STEP, **result})


if __name__ == "__main__":
    main()
