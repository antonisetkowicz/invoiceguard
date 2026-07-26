"""Lokalizacja i wywołania ffmpeg/ffprobe. Zero płatnych zależności.

Kolejność szukania binarki:
1. ffmpeg/ffprobe w PATH (instalacja systemowa, np. brew install ffmpeg)
2. binarka z pakietu PyPI `imageio-ffmpeg` (statyczny build, pip install, darmowy)
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path


class FFmpegMissing(RuntimeError):
    pass


def ffmpeg_bin() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - zależy od środowiska
        raise FFmpegMissing(
            "Nie znaleziono ffmpeg. Zainstaluj: `brew install ffmpeg` "
            "(macOS) / `apt install ffmpeg` (Linux) albo `pip install imageio-ffmpeg`."
        ) from exc


def ffprobe_bin() -> str | None:
    """Zwraca ścieżkę do ffprobe albo None. `imageio-ffmpeg` go nie zawiera,
    dlatego brak ffprobe NIE jest błędem — probe() ma wtedy fallback."""
    found = shutil.which("ffprobe")
    if found:
        return found
    sibling = Path(ffmpeg_bin()).with_name("ffprobe")
    return str(sibling) if sibling.exists() else None


def run_ffmpeg(args: list[str], *, log_path: Path | None = None) -> None:
    """Uruchamia ffmpeg z -y -hide_banner. Rzuca RuntimeError z ogonem stderr."""
    cmd = [ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *args]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(
            " ".join(cmd) + "\n\n" + proc.stdout + proc.stderr, encoding="utf-8")
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-15:]
        raise RuntimeError("ffmpeg nie powiódł się:\n" + "\n".join(tail))


_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d{2}):(\d{2}\.\d+)")
_STREAM_RE = re.compile(r"Stream #\d+:\d+.*?: (Video|Audio): (\w+)")
_SIZE_RE = re.compile(r"(\d{2,5})x(\d{2,5})")


def _probe_via_ffmpeg(path: Path | str) -> dict:
    """Fallback bez ffprobe: parsuje nagłówek z `ffmpeg -i`.

    Wyciąga tylko to, czego pipeline naprawdę używa (długość, kodeki,
    rozdzielczość), ale w tym samym kształcie co wyjście ffprobe -print_format json.
    """
    proc = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", str(path)],
                          capture_output=True, text=True)
    text = proc.stderr  # ffmpeg zawsze wypisuje metadane na stderr

    duration = None
    match = _DURATION_RE.search(text)
    if match:
        hours, minutes, seconds = match.groups()
        duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)

    streams: list[dict] = []
    for line in text.splitlines():
        stream_match = _STREAM_RE.search(line)
        if not stream_match:
            continue
        kind, codec = stream_match.groups()
        entry: dict = {"codec_type": kind.lower(), "codec_name": codec}
        if kind == "Video":
            size_match = _SIZE_RE.search(line.split(codec, 1)[-1])
            if size_match:
                entry["width"] = int(size_match.group(1))
                entry["height"] = int(size_match.group(2))
        streams.append(entry)

    if duration is None and not streams:
        raise RuntimeError(
            f"Nie udało się odczytać metadanych {path}: {text.strip()[-400:]}")

    return {"format": {"duration": duration}, "streams": streams,
            "_source": "ffmpeg-fallback"}


def probe(path: Path | str) -> dict:
    binary = ffprobe_bin()
    if binary is None:
        return _probe_via_ffmpeg(path)
    cmd = [binary, "-v", "error", "-print_format", "json",
           "-show_format", "-show_streams", str(path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe nie powiódł się dla {path}: {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def duration_s(path: Path | str) -> float:
    info = probe(path)
    fmt_dur = info.get("format", {}).get("duration")
    if fmt_dur:
        return float(fmt_dur)
    for stream in info.get("streams", []):
        if stream.get("duration"):
            return float(stream["duration"])
    raise RuntimeError(f"Nie udało się odczytać długości: {path}")


def video_stream(path: Path | str) -> dict | None:
    for stream in probe(path).get("streams", []):
        if stream.get("codec_type") == "video":
            return stream
    return None


def has_audio(path: Path | str) -> bool:
    return any(s.get("codec_type") == "audio" for s in probe(path).get("streams", []))


def ass_escape_path(path: Path | str) -> str:
    """Escapowanie ścieżki wewnątrz filtergraph ffmpeg (filtr `ass`/`subtitles`)."""
    text = str(path)
    text = text.replace("\\", "\\\\").replace(":", "\\:")
    text = text.replace("'", "\\'").replace("[", "\\[").replace("]", "\\]")
    text = text.replace(",", "\\,").replace(";", "\\;")
    return text
