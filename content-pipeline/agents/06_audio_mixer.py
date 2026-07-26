#!/usr/bin/env python3
"""KROK 6 — audio-mixer (DARMOWA muzyka + ducking, wszystko lokalnie).

Muzyka pochodzi z `content-pipeline/assets/music/` — pliki pobierasz RAZ,
ręcznie, z YouTube Audio Library albo Pixabay Music (oba darmowe i
royalty-free). Nic nie jest pobierane automatycznie: to jedyny sposób, żeby
mieć pewność co do licencji ścieżki, którą publikujesz.

Miks robi ffmpeg lokalnie:
  * lektor → loudnorm (równy poziom niezależnie od głosu TTS)
  * muzyka → zapętlona do długości wideo, ściszona, z fade-outem
  * sidechaincompress — muzyka automatycznie „schodzi" pod lektorem (ducking)
  * amix + alimiter — brak przesterów
Na końcu audio jest muksowane z captioned.mp4 → final.mp4.
"""
from __future__ import annotations

import hashlib
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.ffmpeg import duration_s, has_audio, run_ffmpeg
from lib.runio import ROOT, Run, base_parser, emit, escalate, fail, load_config

STEP = "audio_mixer"
MUSIC_DIR = ROOT / "assets" / "music"
MUSIC_EXTS = {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"}


def available_tracks() -> list[Path]:
    if not MUSIC_DIR.exists():
        return []
    return sorted(p for p in MUSIC_DIR.iterdir()
                  if p.suffix.lower() in MUSIC_EXTS and p.is_file())


def pick_track(tracks: list[Path], run_id: str, explicit: str | None) -> Path | None:
    if explicit:
        candidate = Path(explicit)
        if not candidate.is_absolute():
            candidate = MUSIC_DIR / explicit
        if not candidate.exists():
            raise FileNotFoundError(f"Nie ma takiego utworu: {candidate}")
        return candidate
    if not tracks:
        return None
    # deterministycznie per run — ten sam run daje ten sam podkład
    seed = int(hashlib.sha256(run_id.encode()).hexdigest()[:8], 16)
    return random.Random(seed).choice(tracks)


def build_filter(video_s: float, cfg: dict, *, with_music: bool) -> str:
    audio_cfg = cfg["audio"]
    fade_start = max(0.0, video_s - 1.5)
    # apad do długości WIDEO: lektor jest zwykle krótszy niż render (Remotion
    # dokłada ogon na wybrzmienie). Bez tego `amix duration=first` przyciąłby
    # obraz do długości głosu i ucięło końcówkę ostatniej sceny.
    voice_chain = (f"[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,"
                   f"apad=whole_dur={video_s:.3f}")

    if not with_music:
        return f"{voice_chain},alimiter=limit=0.95[aout]"

    return (
        f"{voice_chain},asplit=2[voice][sc];"
        f"[1:a]aresample=48000,atrim=0:{video_s:.3f},asetpts=N/SR/TB,"
        f"volume={audio_cfg['music_gain_db']}dB,"
        f"afade=t=out:st={fade_start:.3f}:d=1.5[music];"
        f"[music][sc]sidechaincompress="
        f"threshold={audio_cfg['duck_threshold']}:ratio={audio_cfg['duck_ratio']}:"
        f"attack=5:release=280:makeup=1[ducked];"
        f"[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0,"
        f"alimiter=limit=0.95[aout]"
    )


def main() -> None:
    parser = base_parser("Krok 6/10 — audio-mixer (lektor + muzyka z duckingiem)")
    parser.add_argument("--track", default=None,
                        help="konkretny plik z assets/music/ (domyślnie losowy per run)")
    parser.add_argument("--no-music", action="store_true",
                        help="sam lektor, bez podkładu")
    args = parser.parse_args()

    run = Run(args.run_dir)
    cfg = load_config()

    if not run.captioned.exists():
        fail(run, STEP, f"Brak {run.captioned} — najpierw krok 5.")
    if not run.voice.exists():
        fail(run, STEP, f"Brak {run.voice} — najpierw krok 3.")

    video_s = duration_s(run.captioned)
    tracks = available_tracks()

    try:
        track = None if args.no_music else pick_track(tracks, run.dir.name, args.track)
    except FileNotFoundError as exc:
        fail(run, STEP, str(exc))

    if track is None and not args.no_music:
        escalate(
            "Brak muzyki w assets/music/",
            "Pipeline zmiksował Reelsa **bez podkładu muzycznego** — plik wideo "
            "jest gotowy, ale wypada płasko.\n\n"
            "Jednorazowa akcja (5 minut, całkowicie darmowa):\n"
            "1. Wejdź na YouTube Studio → Audio Library "
            "(https://studio.youtube.com → Audio library) albo na "
            "https://pixabay.com/music/.\n"
            "2. Pobierz 3–5 utworów bez wymogu atrybucji, tempo 90–120 BPM.\n"
            f"3. Wrzuć pliki .mp3 do `{MUSIC_DIR}`.\n\n"
            "Kolejne runy wezmą je automatycznie.",
        )
        run.log(STEP, f"Brak plików w {MUSIC_DIR} — miks bez muzyki, eskalacja do "
                      f"HUMAN_ACTION_REQUIRED.md")

    with_music = track is not None
    inputs = ["-i", str(run.voice)]
    if with_music:
        inputs = ["-i", str(run.voice), "-stream_loop", "-1", "-i", str(track)]

    filter_complex = build_filter(video_s, cfg, with_music=with_music)

    try:
        run_ffmpeg([*inputs, "-filter_complex", filter_complex, "-map", "[aout]",
                    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                    "-t", f"{video_s:.3f}", str(run.mixed_audio)],
                   log_path=run.temp("ffmpeg_mix.log"))
    except RuntimeError as exc:
        fail(run, STEP, f"Miks audio nie powiódł się: {exc}")

    try:
        run_ffmpeg(["-i", str(run.captioned), "-i", str(run.mixed_audio),
                    "-map", "0:v:0", "-map", "1:a:0",
                    "-c:v", "copy", "-c:a", "copy",
                    "-movflags", "+faststart", "-shortest", str(run.final)],
                   log_path=run.temp("ffmpeg_mux.log"))
    except RuntimeError as exc:
        fail(run, STEP, f"Muksowanie audio+wideo nie powiodło się: {exc}")

    result = {
        "output": str(run.final),
        "duration_s": round(duration_s(run.final), 3),
        "music": track.name if track else None,
        "music_available": len(tracks),
        "ducking": with_music,
        "has_audio": has_audio(run.final),
    }
    run.step_done(STEP, **result)
    music_note = f"muzyka {track.name} z duckingiem" if track else "BEZ muzyki"
    run.log(STEP, f"Zmiksowano: lektor + {music_note} "
                  f"→ final.mp4 ({result['duration_s']}s)")
    emit({"status": "ok", "step": STEP, **result})


if __name__ == "__main__":
    main()
