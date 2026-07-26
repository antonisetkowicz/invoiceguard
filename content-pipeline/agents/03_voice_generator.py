#!/usr/bin/env python3
"""KROK 3 — voice-generator (DARMOWY TTS).

Silnik główny: `edge-tts` (PyPI) — głosy neuronowe Microsoft Edge, bez klucza
API, bez limitu, bez konta. Zwraca voice.mp3 + word-level timestampy
(zdarzenia WordBoundary) + voice.srt.

Fallback: lokalny Piper/Coqui TTS (offline, open source) — tylko jeśli
edge-tts nie działa (np. brak internetu). Fallback nie daje timestampów;
wtedy krok 5 i tak wyliczy je z Whispera, więc pipeline jedzie dalej.
"""
from __future__ import annotations

import asyncio
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.ffmpeg import duration_s
from lib.runio import (Run, base_parser, emit, fail, load_config, read_json,
                       write_json)

STEP = "voice_generator"
TICKS_PER_MS = 10_000  # edge-tts podaje offsety w jednostkach 100 ns


def ms_to_srt_time(ms: float) -> str:
    ms = max(0, int(round(ms)))
    h, rest = divmod(ms, 3_600_000)
    m, rest = divmod(rest, 60_000)
    s, milli = divmod(rest, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{milli:03d}"


def words_to_srt(words: list[dict], per_cue: int = 4) -> str:
    lines: list[str] = []
    for index, start in enumerate(range(0, len(words), per_cue), start=1):
        group = words[start:start + per_cue]
        if not group:
            continue
        text = " ".join(w["word"] for w in group)
        lines.append(str(index))
        lines.append(f"{ms_to_srt_time(group[0]['start_ms'])} --> "
                     f"{ms_to_srt_time(group[-1]['end_ms'])}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


async def synthesize_edge(text: str, out_mp3: Path, *, voice: str, rate: str,
                          pitch: str) -> list[dict]:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    words: list[dict] = []
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    with out_mp3.open("wb") as fh:
        async for chunk in communicate.stream():
            ctype = chunk.get("type")
            if ctype == "audio":
                fh.write(chunk["data"])
            elif ctype == "WordBoundary":
                start_ms = chunk["offset"] / TICKS_PER_MS
                dur_ms = chunk["duration"] / TICKS_PER_MS
                words.append({
                    "word": chunk["text"],
                    "start_ms": round(start_ms, 1),
                    "end_ms": round(start_ms + dur_ms, 1),
                })
    if out_mp3.stat().st_size == 0:
        raise RuntimeError("edge-tts zwrócił pusty plik audio")
    return words


def synthesize_piper(text: str, out_mp3: Path, model: str | None) -> None:
    """Fallback offline. Wymaga `piper` w PATH i pobranego modelu głosu."""
    if not shutil.which("piper"):
        raise RuntimeError("Fallback niedostępny: brak `piper` w PATH.")
    wav = out_mp3.with_suffix(".wav")
    cmd = ["piper", "--output_file", str(wav)]
    if model:
        cmd += ["--model", model]
    proc = subprocess.run(cmd, input=text, text=True, capture_output=True)
    if proc.returncode != 0 or not wav.exists():
        raise RuntimeError(f"piper nie powiódł się: {proc.stderr.strip()[:300]}")
    from lib.ffmpeg import run_ffmpeg
    run_ffmpeg(["-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "3", str(out_mp3)])
    wav.unlink(missing_ok=True)


def main() -> None:
    parser = base_parser("Krok 3/10 — voice-generator (edge-tts)")
    parser.add_argument("--voice", default=None, help="np. pl-PL-MarekNeural")
    parser.add_argument("--list-voices", action="store_true",
                        help="wypisz dostępne głosy i zakończ")
    args = parser.parse_args()

    if args.list_voices:
        import edge_tts
        voices = asyncio.run(edge_tts.list_voices())
        emit({"status": "ok", "voices": [
            {"name": v["ShortName"], "gender": v["Gender"], "locale": v["Locale"]}
            for v in voices]})
        return

    run = Run(args.run_dir)
    cfg = load_config()

    if not run.script.exists():
        fail(run, STEP, f"Brak {run.script} — najpierw krok 2 (scriptwriter).")

    script = read_json(run.script)
    narration = (script.get("narration") or "").strip()
    if not narration:
        narration = " ".join((s.get("text") or "").strip()
                             for s in script.get("scenes", [])).strip()
    if not narration:
        fail(run, STEP, "script.json nie zawiera tekstu do przeczytania.")

    voice = args.voice or cfg["voice"]
    engine = "edge-tts"
    words: list[dict] = []

    try:
        words = asyncio.run(synthesize_edge(
            narration, run.voice, voice=voice,
            rate=cfg["voice_rate"], pitch=cfg["voice_pitch"]))
    except Exception as exc:  # noqa: BLE001 - fallback offline
        run.log(STEP, f"edge-tts nie zadziałał ({exc}) — próbuję fallbacku Piper.")
        try:
            synthesize_piper(narration, run.voice, cfg.get("piper_model"))
            engine = "piper"
        except Exception as fallback_exc:  # noqa: BLE001
            fail(run, STEP,
                 f"TTS nie powiódł się. edge-tts: {exc} | piper: {fallback_exc}",
                 hint="sprawdź internet (edge-tts) albo zainstaluj piper-tts")

    audio_s = duration_s(run.voice)
    planned_s = float((script.get("stats") or {}).get("total_duration_s") or 0)
    max_s = float(cfg["video"]["max_duration_s"])

    meta = {
        "engine": engine,
        "voice": voice if engine == "edge-tts" else cfg.get("piper_model"),
        "rate": cfg["voice_rate"],
        "pitch": cfg["voice_pitch"],
        "audio_path": str(run.voice),
        "duration_s": round(audio_s, 3),
        "planned_duration_s": planned_s,
        "drift_s": round(audio_s - planned_s, 2) if planned_s else None,
        "words": words,
        "has_word_timestamps": bool(words),
        "narration": narration,
    }
    write_json(run.voice_meta, meta)

    if words:
        (run.dir / "voice.srt").write_text(words_to_srt(words), encoding="utf-8")

    over_limit = audio_s > max_s
    if over_limit:
        run.log(STEP, f"UWAGA: lektor trwa {audio_s:.1f}s > limit {max_s:.0f}s. "
                      f"Krok 8 (QA) to odrzuci — skróć scenariusz.")

    run.step_done(STEP, output="voice.mp3", engine=engine,
                  duration_s=round(audio_s, 2), words=len(words),
                  over_limit=over_limit)
    run.log(STEP, f"Wygenerowano lektora ({engine}, głos {voice}): "
                  f"{audio_s:.2f}s, {len(words)} znaczników słów. "
                  f"Dryf vs scenariusz: {meta['drift_s']}s")

    emit({"status": "ok", "step": STEP, "output": str(run.voice),
          "duration_s": round(audio_s, 2), "engine": engine,
          "word_timestamps": len(words), "over_limit": over_limit})


if __name__ == "__main__":
    main()
