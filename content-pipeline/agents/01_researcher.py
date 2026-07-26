#!/usr/bin/env python3
"""KROK 1 — researcher (część deterministyczna).

Dwa tryby:
  --collect   pobiera darmowe sygnały (Google Trends RSS + baza własnych metryk)
              → trends.json. To jest WEJŚCIE dla subagenta LLM
              `.claude/agents/content-researcher.md`, który dopisuje research
              z WebSearch i zapisuje brief.json.
  --validate  sprawdza brief.json wyprodukowany przez subagenta LLM.

Google Trends RSS jest publiczny i nie wymaga klucza ani konta.
"""
from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib import db
from lib.runio import Run, base_parser, emit, fail, load_config, now_iso

STEP = "researcher"
TRENDS_RSS = "https://trends.google.com/trending/rss?geo={geo}"
NS = {"ht": "https://trends.google.com/trending/rss"}

REQUIRED_BRIEF_FIELDS = ["topic", "audience", "angle", "hook_ideas", "keywords"]


def fetch_google_trends(geo: str = "PL", timeout: int = 30) -> list[dict]:
    """Dzienne trendy z publicznego RSS. Zwraca [] przy błędzie sieci — trendy
    są sygnałem pomocniczym, nie mogą wywalić pipeline'u."""
    url = TRENDS_RSS.format(geo=geo)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "content-pipeline/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return []

    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []

    items = []
    for item in root.iterfind(".//item"):
        title = (item.findtext("title") or "").strip()
        if not title:
            continue
        traffic = item.findtext("ht:approx_traffic", default="", namespaces=NS)
        news = [n.text.strip() for n in item.iterfind("ht:news_item/ht:news_item_title", NS)
                if n.text]
        items.append({
            "title": title,
            "approx_traffic": (traffic or "").strip(),
            "news_titles": news[:3],
        })
    return items


def own_learnings(limit: int = 10) -> dict:
    """Co zadziałało na naszym koncie — pętla uczenia się z 10_analytics_tracker."""
    try:
        conn = db.connect()
    except Exception:
        return {"available": False, "top": [], "note": "brak lokalnej bazy"}
    try:
        top = db.top_performers(conn, limit=limit)
    finally:
        conn.close()
    if not top:
        return {"available": False, "top": [],
                "note": "brak opublikowanych postów z metrykami — pierwszy run"}
    hooks = [t["hook"] for t in top[:5] if t.get("hook")]
    return {
        "available": True,
        "top": top,
        "best_hooks": hooks,
        "note": f"{len(top)} postów z metrykami — użyj ich jako wzorca",
    }


def collect(run: Run, geo: str, topic: str | None) -> dict:
    trends = fetch_google_trends(geo)
    learnings = own_learnings()
    payload = {
        "generated_at": now_iso(),
        "geo": geo,
        "requested_topic": topic,
        "google_trends": trends,
        "own_performance": learnings,
        "sources": [TRENDS_RSS.format(geo=geo)],
        "next_step": ("Subagent LLM content-researcher: zrób WebSearch pod kątem "
                      "tematu/niszy i konkurencyjnych Reelsów, potem zapisz brief.json"),
    }
    run.merge_state({STEP: {"status": "collected", "at": now_iso(),
                            "trends_count": len(trends),
                            "learning_from_own_posts": learnings["available"]}})
    run.log(STEP, f"Zebrano {len(trends)} trendów Google ({geo}); "
                  f"własne metryki: {learnings['note']}")
    return payload


def validate_brief(brief: dict) -> list[str]:
    problems = []
    for field in REQUIRED_BRIEF_FIELDS:
        if not brief.get(field):
            problems.append(f"brak pola `{field}`")
    hooks = brief.get("hook_ideas") or []
    if isinstance(hooks, list) and len(hooks) < 3:
        problems.append("hook_ideas: potrzeba min. 3 propozycji hooka")
    keywords = brief.get("keywords") or []
    if isinstance(keywords, list) and len(keywords) < 3:
        problems.append("keywords: potrzeba min. 3 słów kluczowych")
    hashtags = brief.get("hashtags") or []
    if isinstance(hashtags, list):
        bad = [h for h in hashtags if not re.match(r"^#[\wÀ-ſ]+$", str(h))]
        if bad:
            problems.append(f"hashtags w złym formacie (wymagany prefiks #): {bad[:5]}")
        if len(hashtags) > 30:
            problems.append("hashtags: Instagram dopuszcza maks. 30")
    return problems


def main() -> None:
    parser = base_parser("Krok 1/10 — researcher (trendy + walidacja briefu)")
    parser.add_argument("--collect", action="store_true",
                        help="pobierz sygnały trendów → trends.json")
    parser.add_argument("--validate", action="store_true",
                        help="zwaliduj brief.json od subagenta LLM")
    parser.add_argument("--topic", default=None, help="temat/nisza od użytkownika")
    parser.add_argument("--geo", default=None, help="kod kraju dla Google Trends (domyślnie PL)")
    args = parser.parse_args()

    run = Run(args.run_dir)
    cfg = load_config()
    geo = args.geo or ("PL" if cfg.get("language") == "pl" else "US")

    if args.validate:
        if not run.brief.exists():
            fail(run, STEP, f"Brak {run.brief} — subagent content-researcher go nie zapisał.")
        from lib.runio import read_json
        brief = read_json(run.brief)
        problems = validate_brief(brief)
        if problems:
            fail(run, STEP, "brief.json nie przechodzi walidacji: " + "; ".join(problems),
                 problems=problems)
        run.step_done(STEP, output="brief.json", topic=brief.get("topic"))
        run.log(STEP, f"brief.json OK — temat: {brief.get('topic')}")
        emit({"status": "ok", "step": STEP, "output": str(run.brief),
              "topic": brief.get("topic")})
        return

    # domyślnie: --collect
    payload = collect(run, geo, args.topic)
    from lib.runio import write_json
    write_json(run.trends, payload)
    emit({"status": "ok", "step": STEP, "mode": "collect",
          "output": str(run.trends),
          "trends_count": len(payload["google_trends"]),
          "own_performance_available": payload["own_performance"]["available"],
          "next": "subagent LLM content-researcher → brief.json"})


if __name__ == "__main__":
    main()
