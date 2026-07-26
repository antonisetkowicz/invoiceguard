#!/usr/bin/env python3
"""Sprawdza, czy środowisko udźwignie pipeline /content. Nic nie instaluje bez
`--install`. Uruchamiaj przed pierwszym runem i po zmianie maszyny.

    python3 content-pipeline/preflight.py
    python3 content-pipeline/preflight.py --install   # doinstaluje pakiety pip/npm
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.runio import ROOT, env

PY_PACKAGES = [
    ("edge_tts", "edge-tts", True, "TTS — lektor (krok 3)"),
    ("faster_whisper", "faster-whisper", False,
     "transkrypcja do napisów (krok 5); bez niej fallback na czasy z edge-tts"),
    ("imageio_ffmpeg", "imageio-ffmpeg", False,
     "statyczny ffmpeg, jeśli nie masz systemowego"),
]

OK, WARN, ERR = "OK", "UWAGA", "BRAK"


def check_python() -> dict:
    version = sys.version_info
    ok = version >= (3, 10)
    return {"name": "Python ≥ 3.10", "status": OK if ok else ERR,
            "detail": f"{version.major}.{version.minor}.{version.micro}",
            "fix": "zainstaluj Pythona 3.10+"}


def check_node() -> dict:
    node = shutil.which("node")
    if not node:
        return {"name": "Node.js ≥ 18 (Remotion)", "status": ERR, "detail": "brak",
                "fix": "https://nodejs.org — LTS, darmowe"}
    version = subprocess.run([node, "--version"], capture_output=True,
                             text=True).stdout.strip()
    major = int(version.lstrip("v").split(".")[0] or 0)
    return {"name": "Node.js ≥ 18 (Remotion)", "status": OK if major >= 18 else WARN,
            "detail": version, "fix": "zaktualizuj Node do LTS"}


def check_ffmpeg() -> dict:
    from lib.ffmpeg import FFmpegMissing, ffmpeg_bin
    try:
        binary = ffmpeg_bin()
    except FFmpegMissing as exc:
        return {"name": "ffmpeg", "status": ERR, "detail": str(exc),
                "fix": "brew install ffmpeg  |  apt install ffmpeg  |  pip install imageio-ffmpeg"}
    filters = subprocess.run([binary, "-hide_banner", "-filters"],
                             capture_output=True, text=True).stdout
    missing = [f for f in ("ass", "sidechaincompress") if f" {f} " not in filters]
    detail = binary + (f" — brakuje filtrów: {missing}" if missing else " (ass + sidechaincompress OK)")
    return {"name": "ffmpeg", "status": WARN if missing else OK, "detail": detail,
            "fix": "zainstaluj pełny ffmpeg z libass, jeśli brakuje filtra `ass`"}


def check_ffprobe() -> dict:
    from lib.ffmpeg import ffprobe_bin
    binary = ffprobe_bin()
    if binary:
        return {"name": "ffprobe", "status": OK, "detail": binary, "fix": ""}
    return {"name": "ffprobe", "status": WARN,
            "detail": "brak — metadane czytane z `ffmpeg -i` (fallback, wystarcza)",
            "fix": "opcjonalnie: brew install ffmpeg / apt install ffmpeg"}


def check_py_packages() -> list[dict]:
    results = []
    for module, package, required, purpose in PY_PACKAGES:
        found = importlib.util.find_spec(module) is not None
        results.append({
            "name": f"pip: {package}",
            "status": OK if found else (ERR if required else WARN),
            "detail": purpose,
            "fix": f"pip install {package}",
        })
    return results


def check_remotion() -> dict:
    installed = (ROOT / "remotion" / "node_modules" / "remotion").exists()
    return {"name": "Remotion (node_modules)", "status": OK if installed else WARN,
            "detail": "zainstalowane" if installed else "brak — krok 4 zainstaluje sam",
            "fix": "cd content-pipeline/remotion && npm install"}


def check_music() -> dict:
    music_dir = ROOT / "assets" / "music"
    tracks = [p for p in music_dir.glob("*") if p.suffix.lower() in
              {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"}] if music_dir.exists() else []
    return {"name": "Muzyka (assets/music/)", "status": OK if tracks else WARN,
            "detail": f"{len(tracks)} utworów" if tracks else "pusto — Reels bez podkładu",
            "fix": "pobierz 3–5 utworów z YouTube Audio Library lub pixabay.com/music (darmowe)"}


def check_stock_footage() -> dict:
    """Ujęcia z ludźmi — bez klucza sceny `footage` degradują do gradientów."""
    available = [name for name, key in
                 (("Pexels", "PEXELS_API_KEY"), ("Pixabay", "PIXABAY_API_KEY"))
                 if env(key)]
    if available:
        return {"name": "Ujęcia z ludźmi (stock wideo)", "status": OK,
                "detail": " + ".join(available), "fix": ""}
    return {"name": "Ujęcia z ludźmi (stock wideo)", "status": WARN,
            "detail": "brak PEXELS_API_KEY/PIXABAY_API_KEY — Reels wyjdzie na "
                      "samych gradientach, bez ludzi",
            "fix": "darmowy klucz bez karty: https://www.pexels.com/api/ "
                   "(+ opcjonalnie https://pixabay.com/api/docs/)"}


def check_instagram() -> dict:
    token, user = env("IG_ACCESS_TOKEN"), env("IG_USER_ID")
    if not token or not user:
        return {"name": "Instagram Graph API", "status": WARN,
                "detail": "brak IG_ACCESS_TOKEN/IG_USER_ID — publikacja pójdzie trybem ręcznym",
                "fix": "instrukcja krok po kroku: content-pipeline/README.md"}
    try:
        from lib.ig_api import InstagramClient
        me = InstagramClient(token, user).me()
        return {"name": "Instagram Graph API", "status": OK,
                "detail": f"@{me.get('username')} ({me.get('account_type')})", "fix": ""}
    except Exception as exc:  # noqa: BLE001
        return {"name": "Instagram Graph API", "status": WARN,
                "detail": f"token nie przeszedł weryfikacji: {exc}",
                "fix": "odśwież long-lived token (ważny 60 dni) — patrz README"}


def check_hosting() -> dict:
    options = []
    if env("PUBLIC_BASE_URL") and env("PUBLIC_UPLOAD_DIR"):
        options.append("public_base_url")
    if env("CONTENT_ASSETS_REPO") and shutil.which("gh"):
        options.append("github_release")
    if (env("CONTENT_ALLOW_CATBOX", "true") or "true").lower() == "true":
        options.append("catbox")
    return {"name": "Hosting wideo (video_url dla IG)",
            "status": OK if options else ERR,
            "detail": ", ".join(options) if options else "brak żadnego backendu",
            "fix": "ustaw PUBLIC_BASE_URL+PUBLIC_UPLOAD_DIR albo CONTENT_ASSETS_REPO (+gh CLI)"}


def install_missing() -> None:
    packages = [pkg for module, pkg, *_ in PY_PACKAGES
                if importlib.util.find_spec(module) is None]
    if packages:
        print(f"→ pip install {' '.join(packages)}")
        subprocess.run([sys.executable, "-m", "pip", "install", *packages], check=False)
    remotion_dir = ROOT / "remotion"
    if not (remotion_dir / "node_modules" / "remotion").exists() and shutil.which("npm"):
        print("→ npm install (content-pipeline/remotion)")
        subprocess.run(["npm", "install", "--no-audit", "--no-fund"],
                       cwd=remotion_dir, check=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Preflight pipeline'u /content")
    parser.add_argument("--install", action="store_true",
                        help="doinstaluj brakujące pakiety pip/npm")
    parser.add_argument("--json", action="store_true", help="wynik jako JSON")
    args = parser.parse_args()

    if args.install:
        install_missing()

    checks = [check_python(), check_node(), check_ffmpeg(), check_ffprobe(),
              *check_py_packages(), check_remotion(), check_stock_footage(),
              check_music(), check_instagram(), check_hosting()]

    blocking = [c for c in checks if c["status"] == ERR]
    if args.json:
        print(json.dumps({"checks": checks, "ready": not blocking},
                         ensure_ascii=False, indent=2))
    else:
        symbol = {OK: "✅", WARN: "⚠️ ", ERR: "❌"}
        width = max(len(c["name"]) for c in checks)
        for check in checks:
            print(f"{symbol[check['status']]} {check['name']:<{width}}  {check['detail']}")
            if check["status"] != OK and check.get("fix"):
                print(f"   ↳ {check['fix']}")
        print()
        print("GOTOWE do runu." if not blocking else
              f"BLOKUJE {len(blocking)} pozycji — napraw powyższe.")

    sys.exit(1 if blocking else 0)


if __name__ == "__main__":
    main()
