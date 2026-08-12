"""Raport zmian: plik markdown i/lub webhook.

Raport budujemy z tabeli `offer_changes` (a nie z obiektów w pamięci), dzięki
czemu `--report` potrafi odtworzyć raport dla dowolnego wcześniejszego
przebiegu, bez ponownego scrapowania.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

import db
from config import Config
from models import FIELD_LABELS

log = logging.getLogger(__name__)


def _money(value: Any) -> str:
    try:
        return f"{int(float(value)):,}".replace(",", " ") + " zł"
    except (TypeError, ValueError):
        return str(value) if value not in (None, "") else "—"


def _offer_line(row: sqlite3.Row) -> str:
    bits: list[str] = []
    if row["price"] is not None:
        bits.append(_money(row["price"]))
    if row["area"]:
        bits.append(f"{row['area']:g} m²")
    if row["rooms"]:
        bits.append(f"{row['rooms']} pok.")
    if row["location"]:
        bits.append(str(row["location"]))
    title = row["title"] or row["offer_id"]
    url = row["url"] or ""
    head = f"[{title}]({url})" if url else title
    return f"- **{head}**" + (f" — {' · '.join(bits)}" if bits else "")


def _change_line(row: sqlite3.Row) -> str:
    field = row["field"] or ""
    label = FIELD_LABELS.get(field, field or row["change_type"])
    old, new = row["old_value"], row["new_value"]

    if field == "price":
        arrow = ""
        try:
            delta = int(float(new)) - int(float(old))
            pct = (delta / float(old) * 100) if float(old) else 0.0
            arrow = f" ({'📉' if delta < 0 else '📈'} {delta:+,}".replace(",", " ") + f" zł, {pct:+.1f}%)"
        except (TypeError, ValueError, ZeroDivisionError):
            pass
        return f"  - **cena**: {_money(old)} → {_money(new)}{arrow}"

    if field == "description":
        return "  - **opis**: zmieniony przez ogłoszeniodawcę"
    if field == "images":
        return f"  - **zdjęcia**: {old} → {new}"
    return f"  - **{label}**: {old or '—'} → {new or '—'}"


def markdown_for_run(conn: sqlite3.Connection, run_id: int, cfg: Config) -> str:
    """Buduje raport markdown dla wskazanego przebiegu."""
    run = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    if run is None:
        raise ValueError(f"Przebieg #{run_id} nie istnieje w bazie")

    changes = db.changes_for_run(conn, run_id)
    grouped: dict[str, list[sqlite3.Row]] = {}
    for row in changes:
        grouped.setdefault(row["change_type"], []).append(row)

    field_changes: dict[str, list[sqlite3.Row]] = {}
    for row in grouped.get("price", []) + grouped.get("field", []) + grouped.get("images", []):
        field_changes.setdefault(row["offer_id"], []).append(row)

    counters = db.stats(conn)
    started = run["started_at"]
    lines: list[str] = [
        f"# Raport zmian — {cfg.portal.name}",
        "",
        f"- Przebieg: **#{run_id}** ({run['mode'] or '—'}), status: **{run['status']}**",
        f"- Start: {started} · koniec: {run['finished_at'] or '—'}",
        f"- Ofert w tym przebiegu: **{run['offers_seen']}**"
        + ("" if run["complete"] else "  ⚠️ przebieg NIE objął całego zbioru wyników"),
        f"- W bazie: {counters['offers_active']} aktywnych / {counters['offers_removed']} usuniętych "
        f"· zdjęć na dysku: {counters['images_downloaded']}/{counters['images_total']}",
        f"- Wyszukiwanie: <{run['search_url'] or cfg.search_url}>",
        "",
    ]

    if run["error"]:
        lines += ["> ⚠️ **Przebieg zakończony błędem:** " + str(run["error"]), ""]

    if not changes:
        lines += ["## Brak zmian", "", "Żadna oferta nie doszła, nie zniknęła ani nie zmieniła ceny.", ""]
        return "\n".join(lines)

    if grouped.get("new"):
        lines += [f"## 🆕 Nowe oferty ({len(grouped['new'])})", ""]
        lines += [_offer_line(row) for row in grouped["new"]]
        lines.append("")

    if field_changes:
        price_first = sorted(
            field_changes.items(),
            key=lambda kv: 0 if any(r["field"] == "price" for r in kv[1]) else 1,
        )
        lines += [f"## ✏️ Zmiany w ofertach ({len(field_changes)})", ""]
        for _offer_id, rows in price_first:
            lines.append(_offer_line(rows[0]))
            lines += [_change_line(r) for r in rows]
        lines.append("")

    if grouped.get("removed"):
        lines += [f"## ❌ Zniknęły z wyników ({len(grouped['removed'])})", ""]
        lines += [_offer_line(row) for row in grouped["removed"]]
        lines.append("")

    if grouped.get("restored"):
        lines += [f"## ♻️ Wróciły do wyników ({len(grouped['restored'])})", ""]
        lines += [_offer_line(row) for row in grouped["restored"]]
        lines.append("")

    lines += ["---", f"_Wygenerowano {datetime.now().isoformat(timespec='seconds')}_"]
    return "\n".join(lines)


def write_markdown(cfg: Config, run_id: int, text: str) -> Path:
    cfg.reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = cfg.reports_dir / f"raport-{stamp}-run{run_id}.md"
    path.write_text(text, encoding="utf-8")

    latest = cfg.reports_dir / "latest.md"
    latest.write_text(text, encoding="utf-8")
    return path


def structured_changes(conn: sqlite3.Connection, run_id: int) -> list[dict[str, Any]]:
    return [
        {
            "offer_id": row["offer_id"],
            "type": row["change_type"],
            "field": row["field"],
            "old": row["old_value"],
            "new": row["new_value"],
            "title": row["title"],
            "url": row["url"],
        }
        for row in db.changes_for_run(conn, run_id)
    ]


def send_webhook(cfg: Config, text: str, changes: list[dict[str, Any]]) -> bool:
    """POST z raportem. Zwraca True przy sukcesie."""
    webhook = cfg.webhook or {}
    if not webhook.get("enabled"):
        return False
    url = (webhook.get("url") or "").strip()
    if not url:
        log.warning("watch.webhook.enabled = true, ale brak URL-a — pomijam")
        return False

    payload: dict[str, Any] = {webhook.get("text_field", "text"): text}
    if webhook.get("include_structured", True):
        payload["changes"] = changes

    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=int(webhook.get("timeout_seconds", 15))) as resp:
            log.info("Webhook wysłany (HTTP %s)", resp.status)
            return 200 <= resp.status < 300
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
        log.error("Webhook nieudany: %s", exc)
        return False
