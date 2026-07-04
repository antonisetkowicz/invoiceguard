"""Generator samowystarczalnego raportu HTML z backtestu.

Wykresy rysowane inline SVG (zero zaleznosci JS/CDN): equity curve,
histogram zwrotow, heatmapa miesieczna, tabela drawdownow i lista
transakcji z logika wejscia/wyjscia.

Przyklad:
    >>> from trading_bot.backtest.report import generate_html_report
    >>> # generate_html_report(result, "reports/btc.html")  # doctest: +SKIP
"""
from __future__ import annotations

import html
from pathlib import Path

import numpy as np
import pandas as pd

from trading_bot.backtest.backtest_engine import BacktestResult
from trading_bot.backtest.performance_metrics import drawdown_periods, monthly_returns

_W, _H = 860, 260


def _svg_line(series: pd.Series, color: str = "#2563eb") -> str:
    """Prosty wykres liniowy SVG (equity curve)."""
    if series.empty:
        return "<p>Brak danych</p>"
    values = series.to_numpy(dtype=float)
    lo, hi = values.min(), values.max()
    span = (hi - lo) or 1.0
    xs = np.linspace(40, _W - 10, len(values))
    ys = _H - 30 - (values - lo) / span * (_H - 60)
    points = " ".join(f"{x:.1f},{y:.1f}" for x, y in zip(xs, ys))
    return (
        f'<svg viewBox="0 0 {_W} {_H}" role="img">'
        f'<polyline fill="none" stroke="{color}" stroke-width="1.5" points="{points}"/>'
        f'<text x="40" y="18" font-size="12">max: {hi:,.2f}</text>'
        f'<text x="40" y="{_H - 8}" font-size="12">min: {lo:,.2f}</text>'
        "</svg>"
    )


def _svg_histogram(returns: pd.Series, bins: int = 40, color: str = "#059669") -> str:
    """Histogram rozkladu zwrotow."""
    data = returns.dropna().to_numpy(dtype=float)
    if data.size == 0:
        return "<p>Brak danych</p>"
    counts, edges = np.histogram(data, bins=bins)
    top = counts.max() or 1
    bar_w = (_W - 60) / bins
    bars = []
    for i, count in enumerate(counts):
        h = count / top * (_H - 60)
        x = 40 + i * bar_w
        y = _H - 30 - h
        fill = color if edges[i] >= 0 else "#dc2626"
        bars.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w - 1:.1f}" height="{h:.1f}" fill="{fill}"/>')
    return f'<svg viewBox="0 0 {_W} {_H}" role="img">{"".join(bars)}</svg>'


def _heatmap_table(matrix: pd.DataFrame) -> str:
    """Heatmapa miesiecznych zwrotow jako tabela HTML z tlami komorek."""
    if matrix.empty:
        return "<p>Brak danych</p>"
    months = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze",
              "Lip", "Sie", "Wrz", "Paz", "Lis", "Gru"]
    rows = ["<tr><th></th>" + "".join(f"<th>{m}</th>" for m in months) + "</tr>"]
    for year, row in matrix.iterrows():
        cells = [f"<th>{year}</th>"]
        for m in range(1, 13):
            v = row.get(m)
            if v is None or pd.isna(v):
                cells.append("<td></td>")
            else:
                alpha = min(abs(v) / 0.1, 1.0)
                bg = f"rgba(5,150,105,{alpha:.2f})" if v >= 0 else f"rgba(220,38,38,{alpha:.2f})"
                cells.append(f'<td style="background:{bg}">{v:+.1%}</td>')
        rows.append("<tr>" + "".join(cells) + "</tr>")
    return "<table>" + "".join(rows) + "</table>"


def _trades_table(result: BacktestResult, limit: int = 200) -> str:
    head = ("<tr><th>#</th><th>Symbol</th><th>Kierunek</th><th>Wejscie</th>"
            "<th>Wyjscie</th><th>PnL</th><th>Powod wyjscia</th><th>Logika wejscia</th></tr>")
    rows = [head]
    for i, t in enumerate(result.trades[:limit], 1):
        color = "#059669" if t.pnl >= 0 else "#dc2626"
        rows.append(
            f"<tr><td>{i}</td><td>{html.escape(t.symbol)}</td>"
            f"<td>{t.direction.name}</td><td>{t.entry_price:,.2f}</td>"
            f"<td>{t.exit_price:,.2f}</td>"
            f'<td style="color:{color}">{t.pnl:+,.2f}</td>'
            f"<td>{html.escape(t.exit_reason)}</td>"
            f"<td>{html.escape(t.entry_logic)}</td></tr>"
        )
    return "<table>" + "".join(rows) + "</table>"


def generate_html_report(result: BacktestResult, path: str | Path, title: str = "Backtest") -> Path:
    """Zapisuje pelny raport HTML i zwraca sciezke pliku."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    rep = result.report
    returns = result.equity.pct_change().dropna()
    dd = drawdown_periods(result.equity)
    dd_rows = "".join(
        f"<tr><td>{r.start}</td><td>{r.trough}</td><td>{r.end}</td><td>{r.depth:.1%}</td></tr>"
        for r in dd.sort_values("depth", ascending=False).head(10).itertuples()
    )
    mc = result.monte_carlo
    mc_html = (
        f"<p>Monte Carlo ({len(result.trades)} transakcji): "
        f"drawdown P50 {mc.get('dd_p50', 0):.1%}, P95 {mc.get('dd_p95', 0):.1%}; "
        f"kapital koncowy P05 {mc.get('final_p05', 0):,.0f}, "
        f"P50 {mc.get('final_p50', 0):,.0f}</p>"
    ) if mc else ""

    metrics = "".join(
        f"<div class='card'><div class='v'>{v}</div><div class='k'>{k}</div></div>"
        for k, v in {
            "Sharpe": f"{rep.sharpe:.2f}",
            "Sortino": f"{rep.sortino:.2f}",
            "Max DD": f"{rep.max_dd:.1%}",
            "Profit Factor": f"{rep.profit_factor:.2f}",
            "Win Rate": f"{rep.win_rate:.1%}",
            "Zwrot": f"{rep.total_return:+.1%}",
            "Transakcje": str(rep.n_trades),
        }.items()
    )

    doc = f"""<!doctype html><html lang="pl"><head><meta charset="utf-8">
<title>{html.escape(title)}</title><style>
body{{font-family:system-ui,sans-serif;margin:2rem auto;max-width:960px;color:#111}}
h1,h2{{font-weight:600}} .cards{{display:flex;gap:12px;flex-wrap:wrap}}
.card{{border:1px solid #ddd;border-radius:8px;padding:12px 18px;text-align:center}}
.card .v{{font-size:1.4rem;font-weight:700}} .card .k{{color:#666;font-size:.8rem}}
table{{border-collapse:collapse;font-size:.85rem;width:100%}}
td,th{{border:1px solid #e5e5e5;padding:4px 8px;text-align:right}}
th{{background:#f5f5f5}} svg{{width:100%;height:auto;border:1px solid #eee}}
</style></head><body>
<h1>{html.escape(title)}</h1>
<div class="cards">{metrics}</div>
<h2>Krzywa kapitalu</h2>{_svg_line(result.equity)}
<h2>Rozklad zwrotow</h2>{_svg_histogram(returns)}
<h2>Miesieczne zwroty</h2>{_heatmap_table(monthly_returns(result.equity))}
<h2>Najglebsze drawdowny</h2>
<table><tr><th>Start</th><th>Dolek</th><th>Koniec</th><th>Glebokosc</th></tr>{dd_rows}</table>
{mc_html}
<h2>Lista transakcji</h2>{_trades_table(result)}
</body></html>"""
    path.write_text(doc, encoding="utf-8")
    return path
