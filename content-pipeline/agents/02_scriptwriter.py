#!/usr/bin/env python3
"""KROK 2 — scriptwriter (część deterministyczna).

Subagent LLM `.claude/agents/content-scriptwriter.md` pisze script.json.
Ten skrypt jest bramką jakości: sprawdza twarde reguły, których LLM nie może
naruszyć, bo dalsze kroki (TTS, render, IG) na nich stoją:

  * suma czasu scen < 90 s (twardy limit Reelsa przez API)
  * tempo ≤ 150 słów / 60 s (czyli 2.5 słowa/s) — inaczej lektor się zapowietrza
  * scena 1 = hook ≤ 3 s i musi być pytaniem / liczbą / kontrowersją
  * każda scena ma tekst, czas trwania i sugerowany wizual
  * caption + hashtagi gotowe do publikacji

Bez --strict problemy są zwracane jako ostrzeżenia zamiast błędu.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.runio import (Run, base_parser, emit, fail, load_config, read_json,
                       write_json)

STEP = "scriptwriter"

MAX_TOTAL_S = 88.0          # zostawiamy 2 s marginesu do twardych 90 s API
MIN_TOTAL_S = 8.0
MAX_WORDS_PER_60S = 150.0
MAX_HOOK_S = 3.0
VISUAL_KINDS = {"footage", "text", "gradient", "shapes", "counter", "list",
                "quote", "image"}
MIN_FOOTAGE_SHARE = 0.4   # poniżej tego Reels wygląda jak prezentacja, nie jak Reels
HOOK_PATTERN = re.compile(r"(\?|\d|nikt|nigdy|przesta|błąd|blad|prawda|sekret|"
                          r"stop|myślisz|myslisz|dlaczego|jak\b)", re.IGNORECASE)


def word_count(text: str) -> int:
    return len([w for w in re.split(r"\s+", (text or "").strip()) if w])


def validate(script: dict, cfg: dict) -> tuple[list[str], dict]:
    problems: list[str] = []
    scenes = script.get("scenes") or []

    if not scenes:
        return ["script.json nie zawiera żadnych scen"], {}

    total_s = 0.0
    total_words = 0
    for idx, scene in enumerate(scenes, start=1):
        label = f"scena {idx}"
        text = (scene.get("text") or "").strip()
        duration = scene.get("duration_s")
        visual = scene.get("visual") or {}

        if not text:
            problems.append(f"{label}: pusty `text`")
        if not isinstance(duration, (int, float)) or duration <= 0:
            problems.append(f"{label}: `duration_s` musi być liczbą > 0")
            duration = 0
        if not visual.get("kind"):
            problems.append(f"{label}: brak `visual.kind`")
        elif visual["kind"] not in VISUAL_KINDS:
            problems.append(f"{label}: `visual.kind`='{visual['kind']}' spoza "
                            f"{sorted(VISUAL_KINDS)}")
        elif visual["kind"] == "footage":
            query = (visual.get("query") or "").strip()
            if not query:
                problems.append(f"{label}: `footage` wymaga `visual.query` "
                                f"(opis ujęcia po angielsku)")
            elif len(query.split()) < 3:
                problems.append(f"{label}: `query`='{query}' jest za ogólne — "
                                f"opisz konkretną scenę z człowiekiem "
                                f"(4–8 słów po angielsku)")

        words = word_count(text)
        total_words += words
        total_s += float(duration)

        if duration and words:
            wps = words / float(duration)
            if wps > MAX_WORDS_PER_60S / 60.0 * 1.35:
                problems.append(
                    f"{label}: {words} słów w {duration:.1f}s = {wps:.1f} słów/s — "
                    f"za szybko dla lektora (limit ~{MAX_WORDS_PER_60S/60:.1f}/s)")

    # hook
    hook_scene = scenes[0]
    hook_text = (hook_scene.get("text") or "").strip()
    hook_duration = float(hook_scene.get("duration_s") or 0)
    if hook_duration > MAX_HOOK_S:
        problems.append(f"hook trwa {hook_duration:.1f}s — musi zmieścić się "
                        f"w {MAX_HOOK_S:.0f}s (pierwsze 2 s decydują o retencji)")
    if not HOOK_PATTERN.search(hook_text):
        problems.append("hook nie wygląda na pytanie/liczbę/kontrowersję — "
                        "przepisz go tak, żeby zatrzymywał kciuk")

    # całość
    if total_s > MAX_TOTAL_S:
        problems.append(f"łączny czas {total_s:.1f}s > {MAX_TOTAL_S:.0f}s "
                        f"(Instagram Reels przez API: maks. 90 s)")
    if total_s < MIN_TOTAL_S:
        problems.append(f"łączny czas {total_s:.1f}s < {MIN_TOTAL_S:.0f}s — za krótko")

    if total_s > 0:
        pace = total_words / total_s * 60.0
        if pace > MAX_WORDS_PER_60S:
            problems.append(f"tempo {pace:.0f} słów/60s > limit {MAX_WORDS_PER_60S:.0f}")
    else:
        pace = 0.0

    # CTA
    if not (script.get("cta") or "").strip():
        problems.append("brak `cta` — każdy Reel kończy się wezwaniem do działania")

    # caption / hashtagi
    caption = (script.get("caption") or "").strip()
    if not caption:
        problems.append("brak `caption` do publikacji")
    elif len(caption) > 2200:
        problems.append(f"caption {len(caption)} znaków > limit Instagrama 2200")

    hashtags = script.get("hashtags") or []
    if not hashtags:
        problems.append("brak `hashtags`")
    elif len(hashtags) > 30:
        problems.append(f"{len(hashtags)} hashtagów > limit Instagrama 30")
    else:
        bad = [h for h in hashtags if not str(h).startswith("#")]
        if bad:
            problems.append(f"hashtagi bez prefiksu #: {bad[:5]}")

    # udział ujęć z ludźmi — ostrzeżenie, nie błąd twardy
    footage_count = sum(1 for s in scenes
                        if (s.get("visual") or {}).get("kind") == "footage")
    footage_share = footage_count / len(scenes)
    if footage_share < MIN_FOOTAGE_SHARE:
        problems.append(
            f"tylko {footage_count}/{len(scenes)} scen to `footage` "
            f"({footage_share:.0%}) — Reels z samych plansz tekstowych wypada "
            f"jak prezentacja; celuj w min. {MIN_FOOTAGE_SHARE:.0%} ujęć z ludźmi")

    stats = {
        "scenes": len(scenes),
        "footage_scenes": footage_count,
        "footage_share": round(footage_share, 2),
        "total_duration_s": round(total_s, 2),
        "total_words": total_words,
        "words_per_60s": round(pace, 1),
        "hook": hook_text,
        "hook_duration_s": hook_duration,
        "narration": " ".join((s.get("text") or "").strip() for s in scenes).strip(),
        "max_duration_s": cfg["video"]["max_duration_s"],
    }
    return problems, stats


def main() -> None:
    parser = base_parser("Krok 2/10 — scriptwriter (walidacja scenariusza)")
    parser.add_argument("--strict", action="store_true", default=True,
                        help="traktuj problemy jako błąd (domyślnie włączone)")
    parser.add_argument("--no-strict", dest="strict", action="store_false",
                        help="zwróć problemy jako ostrzeżenia i przepuść dalej")
    args = parser.parse_args()

    run = Run(args.run_dir)
    cfg = load_config()

    if not run.script.exists():
        fail(run, STEP,
             f"Brak {run.script} — subagent content-scriptwriter go nie zapisał.")

    script = read_json(run.script)
    problems, stats = validate(script, cfg)

    if problems and args.strict:
        run.log(STEP, "Walidacja odrzuciła scenariusz:\n- " + "\n- ".join(problems))
        fail(run, STEP, "scenariusz nie przechodzi walidacji", problems=problems,
             stats=stats, hint="popraw script.json i uruchom krok 2 ponownie")

    # narracja jako jedno miejsce prawdy dla TTS (krok 3)
    script["narration"] = stats["narration"]
    script["stats"] = stats
    write_json(run.script, script)

    run.step_done(STEP, output="script.json", duration_s=stats["total_duration_s"],
                  words=stats["total_words"], warnings=problems)
    run.log(STEP, f"Scenariusz OK: {stats['scenes']} scen, "
                  f"{stats['total_duration_s']}s, {stats['total_words']} słów "
                  f"({stats['words_per_60s']} słów/60s). Hook: {stats['hook'][:80]}")
    emit({"status": "ok", "step": STEP, "output": str(run.script),
          "stats": stats, "warnings": problems})


if __name__ == "__main__":
    main()
