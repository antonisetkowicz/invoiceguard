"""Wspólne I/O dla wszystkich agentów pipeline'u /content.

Kontrakt: każdy agent dostaje --run-dir i komunikuje się WYŁĄCZNIE przez pliki
w tym katalogu (state.json + artefakty). Żaden agent nie woła innego agenta.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]        # content-pipeline/
REPO_ROOT = ROOT.parent                            # repo
RUNS_DIR = ROOT / "logs"
HUMAN_FILE = REPO_ROOT / "HUMAN_ACTION_REQUIRED.md"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_stamp() -> str:
    """Timestamp bezpieczny dla nazw katalogów."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def slugify(text: str, max_len: int = 60) -> str:
    trans = str.maketrans("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ", "acelnoszzACELNOSZZ")
    text = (text or "").translate(trans)
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return (text[:max_len].strip("-")) or "reel"


# --------------------------------------------------------------------------- #
# JSON
# --------------------------------------------------------------------------- #
def read_json(path: Path | str, default: Any = None) -> Any:
    p = Path(path)
    if not p.exists():
        if default is None:
            raise FileNotFoundError(f"Brak wymaganego pliku: {p}")
        return default
    with p.open(encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: Path | str, data: Any) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    tmp.replace(p)
    return p


# --------------------------------------------------------------------------- #
# Run directory
# --------------------------------------------------------------------------- #
class Run:
    """Uchwyt na katalog runu: state.json, log.md, ścieżki artefaktów."""

    def __init__(self, run_dir: Path | str):
        self.dir = Path(run_dir).resolve()
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / "temp").mkdir(exist_ok=True)
        self.state_path = self.dir / "state.json"
        self.log_path = self.dir / "log.md"

    # -- ścieżki artefaktów (jedno miejsce prawdy o nazwach plików) ---------- #
    @property
    def trends(self) -> Path:      return self.dir / "trends.json"
    @property
    def brief(self) -> Path:       return self.dir / "brief.json"
    @property
    def script(self) -> Path:      return self.dir / "script.json"
    @property
    def voice(self) -> Path:       return self.dir / "voice.mp3"
    @property
    def voice_meta(self) -> Path:  return self.dir / "voice.json"
    @property
    def visuals(self) -> Path:     return self.dir / "visuals.mp4"
    @property
    def captions(self) -> Path:    return self.dir / "captions.json"
    @property
    def captioned(self) -> Path:   return self.dir / "captioned.mp4"
    @property
    def mixed_audio(self) -> Path: return self.dir / "mixed.m4a"
    @property
    def final(self) -> Path:       return self.dir / "final.mp4"
    @property
    def thumbnail(self) -> Path:   return self.dir / "thumbnail.jpg"
    @property
    def qa_report(self) -> Path:   return self.dir / "qa_report.json"
    @property
    def publish(self) -> Path:     return self.dir / "publish.json"
    @property
    def analytics(self) -> Path:   return self.dir / "analytics.json"

    def temp(self, name: str) -> Path:
        return self.dir / "temp" / name

    # -- state -------------------------------------------------------------- #
    def state(self) -> dict:
        return read_json(self.state_path, default={})

    def merge_state(self, patch: dict) -> dict:
        """Płytki merge na pierwszym poziomie — agenci nie nadpisują sobie pól."""
        state = self.state()
        for key, value in patch.items():
            if isinstance(value, dict) and isinstance(state.get(key), dict):
                state[key].update(value)
            else:
                state[key] = value
        state["updated_at"] = now_iso()
        write_json(self.state_path, state)
        return state

    def step_done(self, step: str, **fields) -> None:
        self.merge_state({step: {"status": "done", "at": now_iso(), **fields}})

    def step_failed(self, step: str, reason: str, **fields) -> None:
        self.merge_state({step: {"status": "failed", "at": now_iso(),
                                 "reason": reason, **fields}})

    def step_skipped(self, step: str, reason: str, **fields) -> None:
        self.merge_state({step: {"status": "skipped", "at": now_iso(),
                                 "reason": reason, **fields}})

    # -- log ---------------------------------------------------------------- #
    def log(self, step: str, message: str) -> None:
        if not self.log_path.exists():
            self.log_path.write_text(
                f"# Log runu — {self.dir.name}\n", encoding="utf-8")
        with self.log_path.open("a", encoding="utf-8") as fh:
            fh.write(f"\n## [{step}] — {now_iso()}\n{message.rstrip()}\n")


def new_run(topic: str | None = None) -> Run:
    run = Run(RUNS_DIR / run_stamp())
    run.merge_state({
        "run_id": run.dir.name,
        "started_at": now_iso(),
        "args": {"topic": topic},
    })
    return run


def latest_run() -> Run | None:
    if not RUNS_DIR.exists():
        return None
    candidates = sorted((d for d in RUNS_DIR.iterdir()
                         if d.is_dir() and (d / "state.json").exists()))
    return Run(candidates[-1]) if candidates else None


# --------------------------------------------------------------------------- #
# Human-in-the-loop
# --------------------------------------------------------------------------- #
def escalate(title: str, body: str) -> None:
    """DOPISUJE sekcję do HUMAN_ACTION_REQUIRED.md — nigdy nie nadpisuje."""
    header = "" if HUMAN_FILE.exists() else "# Wymaga Twojej akcji\n"
    with HUMAN_FILE.open("a", encoding="utf-8") as fh:
        fh.write(f"{header}\n## [/content] {title} — {now_iso()}\n\n{body.rstrip()}\n")


# --------------------------------------------------------------------------- #
# Config + .env
# --------------------------------------------------------------------------- #
_ENV_CACHE: dict[str, str] | None = None


def env(key: str, default: str | None = None) -> str | None:
    """Czyta z os.environ, a jeśli brak — z repo .env (bez zewnętrznych zależności)."""
    global _ENV_CACHE
    if key in os.environ and os.environ[key]:
        return os.environ[key]
    if _ENV_CACHE is None:
        _ENV_CACHE = {}
        env_file = REPO_ROOT / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                _ENV_CACHE[k.strip()] = v.strip().strip('"').strip("'")
    return _ENV_CACHE.get(key) or default


DEFAULT_CONFIG: dict = {
    "language": "pl",
    "voice": "pl-PL-MarekNeural",
    "voice_rate": "+8%",
    "voice_pitch": "+0Hz",
    "video": {"width": 1080, "height": 1920, "fps": 30, "max_duration_s": 88},
    "captions": {
        "font": "DejaVu Sans",
        "font_size": 92,
        "primary_color": "&H00FFFFFF",     # biały (ASS: &HAABBGGRR)
        "highlight_color": "&H0000E5FF",   # amber
        "outline": 6,
        "shadow": 2,
        "margin_v": 420,                   # od dołu — nad UI Instagrama
        "max_chars_per_line": 18,
        "words_per_cue": 3,
        "engine": "faster-whisper",        # faster-whisper | openai-whisper | edge-tts
        "whisper_model": "small",
    },
    "audio": {"music_gain_db": -16, "duck_ratio": 8, "duck_threshold": 0.045},
    "publish": {
        "provider": "instagram_graph",     # instagram_graph | manual | ayrshare
        "hosting": "auto",                 # auto | github_release | catbox | public_base_url
        "share_to_feed": True,
    },
}


def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    user_cfg = ROOT / "config.json"
    if user_cfg.exists():
        override = read_json(user_cfg, default={})
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(cfg.get(key), dict):
                cfg[key].update(value)
            else:
                cfg[key] = value
    return cfg


# --------------------------------------------------------------------------- #
# CLI helpers
# --------------------------------------------------------------------------- #
def base_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--run-dir", required=True,
                        help="katalog runu, np. content-pipeline/logs/2026-07-26T10-00-00Z")
    return parser


def emit(payload: dict) -> None:
    """Jedyny kanał wyjściowy agenta na stdout: pojedynczy obiekt JSON."""
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


def fail(run: Run | None, step: str, reason: str, **extra) -> None:
    if run is not None:
        run.step_failed(step, reason)
        run.log(step, f"BŁĄD: {reason}")
    emit({"status": "failed", "step": step, "error": reason, **extra})
    sys.exit(1)
