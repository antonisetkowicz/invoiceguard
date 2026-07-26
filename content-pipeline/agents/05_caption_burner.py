#!/usr/bin/env python3
"""KROK 5 — caption-burner (DARMOWA transkrypcja + wypalanie napisów).

Transkrypcja: lokalny Whisper — `faster-whisper` (domyślnie) albo
`openai-whisper`. Oba open source, działają offline na CPU, bez klucza API.
Fallback: znaczniki słów z edge-tts (krok 3), jeśli Whisper nie jest
zainstalowany — pipeline nigdy nie zatrzymuje się na tym kroku.

Wypalanie: ffmpeg + libass. Napisy w stylu viralowym — duże, wyśrodkowane,
podświetlane słowo po słowie (karaoke), nad strefą UI Instagrama.
`drawtext` celowo NIE jest używany: statyczne buildy ffmpeg często nie mają
libfreetype, a libass jest dostępny praktycznie zawsze.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.ffmpeg import ass_escape_path, duration_s, run_ffmpeg
from lib.runio import (Run, base_parser, emit, fail, load_config, read_json,
                       write_json)

STEP = "caption_burner"


# --------------------------------------------------------------------------- #
# Transkrypcja
# --------------------------------------------------------------------------- #
def transcribe_faster_whisper(audio: Path, model_size: str, language: str) -> list[dict]:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        str(audio), language=language, word_timestamps=True,
        vad_filter=True, beam_size=5)
    words: list[dict] = []
    for segment in segments:
        for word in (segment.words or []):
            text = (word.word or "").strip()
            if not text:
                continue
            words.append({"word": text,
                          "start_ms": round(word.start * 1000, 1),
                          "end_ms": round(word.end * 1000, 1)})
    return words


def transcribe_openai_whisper(audio: Path, model_size: str, language: str) -> list[dict]:
    import whisper

    model = whisper.load_model(model_size)
    result = model.transcribe(str(audio), language=language, word_timestamps=True)
    words: list[dict] = []
    for segment in result.get("segments", []):
        for word in segment.get("words", []):
            text = (word.get("word") or "").strip()
            if not text:
                continue
            words.append({"word": text,
                          "start_ms": round(word["start"] * 1000, 1),
                          "end_ms": round(word["end"] * 1000, 1)})
    return words


def words_from_tts(run: Run) -> list[dict]:
    if not run.voice_meta.exists():
        return []
    return read_json(run.voice_meta, default={}).get("words") or []


# --------------------------------------------------------------------------- #
# ASS
# --------------------------------------------------------------------------- #
def ass_time(ms: float) -> str:
    """Format ASS: H:MM:SS.cc (setne sekundy)."""
    ms = max(0, int(round(ms)))
    h, rest = divmod(ms, 3_600_000)
    m, rest = divmod(rest, 60_000)
    s, centi = divmod(rest, 1000)
    return f"{h:d}:{m:02d}:{s:02d}.{centi // 10:02d}"


def inline_color(style_color: str) -> str:
    """Kolor stylu ASS (&HAABBGGRR) → forma inline dla tagu \\c (&HBBGGRR&).

    Style i tagi inline mają RÓŻNĄ składnię: styl bierze 8 cyfr z alfą,
    tag inline 6 cyfr i musi kończyć się `&`. Pominięcie tego działa
    przypadkiem w części wersji libass i cicho psuje kolor w innych.
    """
    value = (style_color or "").strip().lstrip("&").lstrip("Hh")
    value = value or "00FFFFFF"
    if len(value) == 8:      # AABBGGRR → odcinamy alfę
        value = value[2:]
    return f"&H{value.upper()}&"


def ass_escape_text(text: str) -> str:
    return (text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")
            .replace("\n", " ").strip())


def group_words(words: list[dict], per_cue: int, max_chars: int) -> list[list[dict]]:
    """Dzieli słowa na grupy — po liczbie słów, ale też po długości linii
    i po dłuższej pauzie (>0.55 s), żeby napis podążał za oddechem lektora."""
    cues: list[list[dict]] = []
    current: list[dict] = []
    for word in words:
        if current:
            gap = word["start_ms"] - current[-1]["end_ms"]
            candidate_len = len(" ".join(w["word"] for w in current + [word]))
            if len(current) >= per_cue or candidate_len > max_chars or gap > 550:
                cues.append(current)
                current = []
        current.append(word)
    if current:
        cues.append(current)
    return cues


def build_ass(words: list[dict], cfg: dict, video_duration_s: float) -> str:
    caps = cfg["captions"]
    width, height = cfg["video"]["width"], cfg["video"]["height"]
    cues = group_words(words, caps["words_per_cue"], caps["max_chars_per_line"])

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Viral,{caps['font']},{caps['font_size']},{caps['primary_color']},{caps['highlight_color']},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{caps['outline']},{caps['shadow']},2,90,90,{caps['margin_v']},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    highlight = inline_color(caps["highlight_color"])
    events: list[str] = []
    for cue in cues:
        for index, word in enumerate(cue):
            start = word["start_ms"]
            # napis trzyma się do startu następnego słowa — brak migotania
            if index + 1 < len(cue):
                end = cue[index + 1]["start_ms"]
            else:
                end = max(word["end_ms"], start + 120)
            end = min(end, video_duration_s * 1000)
            if end <= start:
                continue

            parts = []
            for j, w in enumerate(cue):
                token = ass_escape_text(w["word"])
                if j == index:
                    parts.append(f"{{\\c{highlight}\\fscx112\\fscy112}}{token}{{\\r}}")
                else:
                    parts.append(token)
            text = " ".join(parts)
            # lekkie „wbicie" napisu przy pierwszym słowie grupy
            if index == 0:
                text = "{\\fad(90,0)}" + text
            events.append(
                f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Viral,,0,0,0,,{text}")

    return header + "\n".join(events) + "\n"


# --------------------------------------------------------------------------- #
def main() -> None:
    parser = base_parser("Krok 5/10 — caption-burner (Whisper + ffmpeg/libass)")
    parser.add_argument("--engine", default=None,
                        choices=["faster-whisper", "openai-whisper", "edge-tts"],
                        help="silnik transkrypcji (domyślnie z config.json)")
    parser.add_argument("--model", default=None, help="rozmiar modelu Whisper")
    args = parser.parse_args()

    run = Run(args.run_dir)
    cfg = load_config()
    caps = cfg["captions"]
    engine = args.engine or caps["engine"]
    model_size = args.model or caps["whisper_model"]

    if not run.visuals.exists():
        fail(run, STEP, f"Brak {run.visuals} — najpierw krok 4.")
    if not run.voice.exists():
        fail(run, STEP, f"Brak {run.voice} — najpierw krok 3.")

    words: list[dict] = []
    used_engine = engine
    errors: list[str] = []

    if engine == "faster-whisper":
        try:
            words = transcribe_faster_whisper(run.voice, model_size, cfg["language"])
        except Exception as exc:  # noqa: BLE001
            errors.append(f"faster-whisper: {exc}")
    elif engine == "openai-whisper":
        try:
            words = transcribe_openai_whisper(run.voice, model_size, cfg["language"])
        except Exception as exc:  # noqa: BLE001
            errors.append(f"openai-whisper: {exc}")

    if not words:
        words = words_from_tts(run)
        if words:
            used_engine = "edge-tts (fallback)"
            run.log(STEP, "Whisper niedostępny/pusty — używam znaczników słów z "
                          "edge-tts. " + "; ".join(errors))

    if not words:
        fail(run, STEP,
             "Brak jakichkolwiek znaczników czasu dla napisów. " + "; ".join(errors),
             hint="pip install faster-whisper  (albo użyj edge-tts jako źródła czasów)")

    video_s = duration_s(run.visuals)
    ass_text = build_ass(words, cfg, video_s)
    ass_path = run.temp("captions.ass")
    ass_path.parent.mkdir(parents=True, exist_ok=True)
    ass_path.write_text(ass_text, encoding="utf-8")

    write_json(run.captions, {
        "engine": used_engine,
        "model": model_size if "whisper" in used_engine else None,
        "language": cfg["language"],
        "word_count": len(words),
        "words": words,
        "ass_path": str(ass_path),
        "errors": errors,
    })

    try:
        run_ffmpeg([
            "-i", str(run.visuals),
            "-vf", f"ass={ass_escape_path(ass_path)}",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-pix_fmt", "yuv420p", "-an",
            str(run.captioned),
        ], log_path=run.temp("ffmpeg_captions.log"))
    except RuntimeError as exc:
        fail(run, STEP, f"Wypalanie napisów nie powiodło się: {exc}",
             hint="sprawdź, czy ffmpeg ma libass (`ffmpeg -filters | grep ass`)")

    run.step_done(STEP, output="captioned.mp4", engine=used_engine,
                  words=len(words))
    run.log(STEP, f"Napisy wypalone ({used_engine}, {len(words)} słów, "
                  f"{caps['words_per_cue']} słów/napis).")
    emit({"status": "ok", "step": STEP, "output": str(run.captioned),
          "engine": used_engine, "words": len(words), "errors": errors})


if __name__ == "__main__":
    main()
