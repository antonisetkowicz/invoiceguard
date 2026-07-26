#!/usr/bin/env python3
"""KROK 4 — visual-builder (Remotion, open source).

Buduje props z script.json + rzeczywistej długości lektora i renderuje
visuals.mp4 1080x1920 przez `npx remotion render`.

Dwa źródła obrazu:
1. **Ujęcia stockowe z ludźmi** (`visual.kind == "footage"`) — pobierane z
   Pexels/Pixabay Videos. Darmowe, klucz API bez karty. To domyślny wygląd
   Reelsa: prawdziwi ludzie w tle, lektor i napisy na wierzchu.
2. **Sceny rysowane kodem** (`text`, `list`, `counter`, `quote`, `shapes`,
   `gradient`) — gradienty i typografia, zero zależności zewnętrznych.

Opcjonalnie (--images) tła z Pollinations.ai — darmowe, bez klucza.

Każde zewnętrzne źródło jest DODATKIEM: brak klucza, brak sieci albo brak
trafienia w wyszukiwaniu degraduje scenę do gradientu i pipeline leci dalej.
Pliki mediów lądują w `remotion/public/<run-id>/` i są podawane do kompozycji
przez `staticFile()` — Remotion nie serwuje plików spoza `public/`.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib import stock
from lib.ffmpeg import duration_s, video_stream
from lib.runio import (ROOT, Run, base_parser, emit, env, escalate, fail,
                       load_config, read_json, write_json)

STEP = "visual_builder"
REMOTION_DIR = ROOT / "remotion"
PUBLIC_DIR = REMOTION_DIR / "public"
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


def public_run_dir(run: Run) -> Path:
    """Katalog na media tego runu wewnątrz remotion/public/.

    Remotion serwuje wyłącznie zawartość `public/`, więc pobrane klipy muszą
    tu trafić — `staticFile()` przyjmuje ścieżkę względną do tego katalogu.
    """
    target = PUBLIC_DIR / run.dir.name
    target.mkdir(parents=True, exist_ok=True)
    return target


def cleanup_old_public(keep: str, max_keep: int = 3) -> None:
    """Klipy stockowe potrafią ważyć setki MB — trzymamy tylko ostatnie runy."""
    if not PUBLIC_DIR.exists():
        return
    runs = sorted((d for d in PUBLIC_DIR.iterdir() if d.is_dir() and d.name != keep))
    for stale in runs[:-max_keep] if len(runs) > max_keep else []:
        shutil.rmtree(stale, ignore_errors=True)


def attach_footage(visual: dict, scene_text: str, needed_s: float, index: int,
                   run: Run, media_dir: Path, used_ids: set,
                   credits: list) -> dict:
    """Pobiera ujęcie z ludźmi dla sceny. Przy jakimkolwiek problemie
    degraduje scenę do gradientu — brak stocku nie może zatrzymać runu."""
    query = (visual.get("query") or visual.get("headline") or scene_text)[:120].strip()
    if not query:
        visual["kind"] = "gradient"
        return visual

    clip = stock.find_clip(query, needed_s=needed_s, env_get=env,
                           exclude_ids=used_ids)
    if not clip or clip.get("error") or not clip.get("url"):
        reason = (clip or {}).get("error") or f"brak trafień dla „{query}”"
        run.log(STEP, f"Scena {index+1}: {reason} — degraduję do gradientu.")
        visual["kind"] = "gradient"
        visual.pop("clip", None)
        return visual

    filename = f"clip_{index:02d}.mp4"
    try:
        clip_path = stock.download(clip, media_dir / filename)
    except stock.StockError as exc:
        run.log(STEP, f"Scena {index+1}: {exc} — degraduję do gradientu.")
        visual["kind"] = "gradient"
        visual.pop("clip", None)
        return visual

    used_ids.add(f"{clip['source']}:{clip['id']}")
    visual["clip"] = f"{run.dir.name}/{filename}"
    # Realna długość z pliku, nie z metadanych API — banki czasem podają
    # zaokrąglone sekundy, a Remotion potrzebuje tego do zapętlenia klipu
    # krótszego niż scena (inaczej ostatnie klatki byłyby czarne).
    try:
        visual["clipDurationS"] = round(duration_s(clip_path), 3)
    except Exception:  # noqa: BLE001 - metadane to nie powód do przerwania runu
        visual["clipDurationS"] = clip["duration_s"] or None
    credits.append({
        "scene": index + 1, "source": clip["source"], "id": clip["id"],
        "author": clip.get("author"), "page": clip.get("page"),
        "resolution": f"{clip['width']}x{clip['height']}",
        "duration_s": clip["duration_s"], "query": query,
    })
    run.log(STEP, f"Scena {index+1}: ujęcie {clip['source']}#{clip['id']} "
                  f"({clip['width']}x{clip['height']}, {clip['duration_s']}s) "
                  f"dla „{query}”")
    return visual


def build_props(script: dict, cfg: dict, audio_s: float, *,
                with_images: bool, with_footage: bool, run: Run) -> tuple[dict, list]:
    scenes = []
    credits: list = []
    used_ids: set = set()
    media_dir = public_run_dir(run)

    planned_total = sum(float(s.get("duration_s") or 0)
                        for s in script.get("scenes", [])) or 1.0
    scale = (audio_s or planned_total) / planned_total

    for index, scene in enumerate(script.get("scenes", [])):
        visual = dict(scene.get("visual") or {})
        planned_s = float(scene.get("duration_s") or 0)
        needed_s = planned_s * scale        # realna długość sceny po dopasowaniu do lektora

        if visual.get("kind") == "footage":
            if visual.get("clip"):
                # klip wskazany jawnie (ręczne nadpisanie albo ponowny render
                # tego samego runu) — nie ruszamy i nie pobieramy nic ponownie
                run.log(STEP, f"Scena {index+1}: używam wskazanego klipu "
                              f"{visual['clip']}.")
            elif with_footage:
                visual = attach_footage(visual, scene.get("text", ""), needed_s,
                                        index, run, media_dir, used_ids, credits)
            else:
                visual["kind"] = "gradient"
                run.log(STEP, f"Scena {index+1}: stock niedostępny/wyłączony — "
                              f"gradient.")

        if with_images and visual.get("kind") == "image" and not visual.get("src"):
            prompt = visual.get("prompt") or visual.get("headline") or scene.get("text", "")
            image_path = fetch_pollinations(
                f"{prompt}, cinematic, vertical, high contrast, no text",
                media_dir / f"bg_{index:02d}.jpg")
            if image_path:
                visual["src"] = f"{run.dir.name}/bg_{index:02d}.jpg"
            else:
                visual["kind"] = "gradient"
                run.log(STEP, f"Scena {index+1}: Pollinations.ai nie odpowiedział — "
                              f"degraduję do gradientu.")
        elif visual.get("kind") == "image" and not visual.get("src"):
            visual["kind"] = "gradient"

        scenes.append({
            "text": scene.get("text", ""),
            "duration_s": planned_s,
            "visual": visual,
        })

    props = {
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
    return props, credits


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
    parser.add_argument("--no-footage", dest="footage", action="store_false",
                        default=True,
                        help="pomiń ujęcia stockowe z ludźmi (same gradienty)")
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

    wants_footage = any((s.get("visual") or {}).get("kind") == "footage"
                        for s in script.get("scenes", []))
    has_stock_key = bool(env("PEXELS_API_KEY") or env("PIXABAY_API_KEY"))
    if wants_footage and args.footage and not has_stock_key:
        escalate(
            "Brak klucza do banku wideo — Reels bez ujęć z ludźmi",
            "Scenariusz przewidywał ujęcia z prawdziwymi ludźmi, ale nie ma "
            "żadnego klucza API, więc sceny wyszły jako gradienty.\n\n"
            "Jednorazowa akcja (2 minuty, **darmowa, bez karty**):\n"
            "1. Pexels: https://www.pexels.com/api/ → *Get Started* → skopiuj klucz.\n"
            "2. (opcjonalnie) Pixabay: https://pixabay.com/api/docs/ → klucz jest "
            "widoczny po zalogowaniu.\n"
            "3. Dopisz do `.env` w katalogu repo:\n\n"
            "```\nPEXELS_API_KEY=...\nPIXABAY_API_KEY=...\n```\n\n"
            "Kolejne runy zaciągną ujęcia automatycznie.",
        )
        run.log(STEP, "Brak PEXELS_API_KEY/PIXABAY_API_KEY — sceny footage "
                      "degradują do gradientów, eskalacja zapisana.")

    props, credits = build_props(script, cfg, audio_s, with_images=args.images,
                                 with_footage=args.footage and has_stock_key,
                                 run=run)
    props_path = run.temp("remotion_props.json")
    write_json(props_path, props)
    if credits:
        write_json(run.dir / "footage_credits.json",
                   {"note": "Pexels/Pixabay nie wymagają atrybucji, ale warto "
                            "wiedzieć, czyje ujęcia poszły w świat.",
                    "clips": credits})
    cleanup_old_public(run.dir.name)

    try:
        render(props_path, run.visuals, cfg, concurrency=args.concurrency)
    except RuntimeError as exc:
        fail(run, STEP, str(exc), hint="uruchom `npm install` w content-pipeline/remotion")

    stream = video_stream(run.visuals) or {}
    footage_scenes = sum(1 for s in props["scenes"]
                         if s["visual"].get("kind") == "footage")
    result = {
        "path": str(run.visuals),
        "width": stream.get("width"),
        "height": stream.get("height"),
        "duration_s": round(duration_s(run.visuals), 3),
        "scenes": len(props["scenes"]),
        "footage_scenes": footage_scenes,
        "footage_clips": len(credits),
        "images_used": args.images,
    }
    run.step_done(STEP, output="visuals.mp4", **result)
    run.log(STEP, f"Wyrenderowano {result['width']}x{result['height']}, "
                  f"{result['duration_s']}s, {result['scenes']} scen "
                  f"({footage_scenes} z ujęciami z ludźmi, audio: {audio_s:.2f}s).")
    emit({"status": "ok", "step": STEP, **result})


if __name__ == "__main__":
    main()
