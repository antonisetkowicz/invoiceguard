"""Metryki wydajnosci: Sharpe, Sortino, Max Drawdown, Profit Factor i inne.

Przyklad:
    >>> import pandas as pd
    >>> from trading_bot.backtest.performance_metrics import sharpe_ratio
    >>> rets = pd.Series([0.01, -0.005, 0.02, 0.003])
    >>> sharpe_ratio(rets, periods_per_year=252) > 0
    True
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from trading_bot.core.models import Trade

TRADING_DAYS = 252


def sharpe_ratio(returns: pd.Series, risk_free: float = 0.0, periods_per_year: int = TRADING_DAYS) -> float:
    """Annualizowany Sharpe ratio z serii zwrotow okresowych."""
    excess = returns - risk_free / periods_per_year
    std = excess.std()
    if std == 0 or np.isnan(std) or len(returns) < 2:
        return 0.0
    return float(excess.mean() / std * np.sqrt(periods_per_year))


def sortino_ratio(returns: pd.Series, risk_free: float = 0.0, periods_per_year: int = TRADING_DAYS) -> float:
    """Sortino: jak Sharpe, ale w mianowniku tylko odchylenie strat."""
    excess = returns - risk_free / periods_per_year
    downside = excess[excess < 0]
    dd_std = downside.std()
    if dd_std == 0 or np.isnan(dd_std) or len(downside) == 0:
        return 0.0 if excess.mean() <= 0 else float("inf")
    return float(excess.mean() / dd_std * np.sqrt(periods_per_year))


def max_drawdown(equity: pd.Series) -> float:
    """Maksymalne obsuniecie kapitalu jako ulamek (0.2 = -20%)."""
    if equity.empty:
        return 0.0
    running_max = equity.cummax()
    drawdown = (running_max - equity) / running_max
    return float(drawdown.max())


def drawdown_periods(equity: pd.Series) -> pd.DataFrame:
    """Tabela okresow drawdownu (start, dolek, koniec, glebokosc)."""
    if equity.empty:
        return pd.DataFrame(columns=["start", "trough", "end", "depth"])
    running_max = equity.cummax()
    dd = (running_max - equity) / running_max
    rows = []
    in_dd = False
    start = trough = None
    depth = 0.0
    for ts, value in dd.items():
        if value > 0 and not in_dd:
            in_dd, start, trough, depth = True, ts, ts, value
        elif in_dd:
            if value > depth:
                trough, depth = ts, value
            if value == 0:
                rows.append({"start": start, "trough": trough, "end": ts, "depth": depth})
                in_dd = False
    if in_dd:
        rows.append({"start": start, "trough": trough, "end": equity.index[-1], "depth": depth})
    return pd.DataFrame(rows, columns=["start", "trough", "end", "depth"])


def profit_factor(trades: list[Trade]) -> float:
    """Suma zyskow / suma strat (brutto po kosztach)."""
    gains = sum(t.pnl for t in trades if t.pnl > 0)
    losses = -sum(t.pnl for t in trades if t.pnl < 0)
    if losses == 0:
        return float("inf") if gains > 0 else 0.0
    return float(gains / losses)


def win_rate(trades: list[Trade]) -> float:
    if not trades:
        return 0.0
    return sum(1 for t in trades if t.pnl > 0) / len(trades)


def expectancy(trades: list[Trade]) -> float:
    """Srednia oczekiwana wartosc transakcji (quote currency)."""
    if not trades:
        return 0.0
    return float(np.mean([t.pnl for t in trades]))


def monthly_returns(equity: pd.Series) -> pd.DataFrame:
    """Macierz rok x miesiac zwrotow (do heatmapy raportu)."""
    if equity.empty or not isinstance(equity.index, pd.DatetimeIndex):
        return pd.DataFrame()
    monthly = equity.resample("ME").last().pct_change().dropna()
    frame = pd.DataFrame({
        "year": monthly.index.year, "month": monthly.index.month, "ret": monthly.values
    })
    return frame.pivot_table(index="year", columns="month", values="ret", aggfunc="first")


@dataclass(slots=True)
class PerformanceReport:
    """Komplet metryk pojedynczego przebiegu backtestu."""

    sharpe: float
    sortino: float
    max_dd: float
    profit_factor: float
    win_rate: float
    expectancy: float
    total_return: float
    n_trades: int

    def as_dict(self) -> dict[str, float]:
        return {
            "sharpe": self.sharpe,
            "sortino": self.sortino,
            "max_drawdown": self.max_dd,
            "profit_factor": self.profit_factor,
            "win_rate": self.win_rate,
            "expectancy": self.expectancy,
            "total_return": self.total_return,
            "n_trades": self.n_trades,
        }


def compute_report(
    equity: pd.Series, trades: list[Trade], periods_per_year: int = TRADING_DAYS
) -> PerformanceReport:
    """Buduje pelny raport metryk z krzywej kapitalu i listy transakcji."""
    returns = equity.pct_change().dropna()
    total = float(equity.iloc[-1] / equity.iloc[0] - 1) if len(equity) > 1 else 0.0
    return PerformanceReport(
        sharpe=sharpe_ratio(returns, periods_per_year=periods_per_year),
        sortino=sortino_ratio(returns, periods_per_year=periods_per_year),
        max_dd=max_drawdown(equity),
        profit_factor=profit_factor(trades),
        win_rate=win_rate(trades),
        expectancy=expectancy(trades),
        total_return=total,
        n_trades=len(trades),
    )


def monte_carlo(
    trades: list[Trade],
    initial_capital: float,
    runs: int = 1000,
    seed: int | None = 42,
) -> dict[str, float]:
    """Symulacja Monte Carlo: permutacje kolejnosci transakcji.

    Zwraca percentyle maksymalnego drawdownu i koncowego kapitalu -
    ocena wrazliwosci wyniku na sekwencje trade'ow.
    """
    if not trades:
        return {"dd_p50": 0.0, "dd_p95": 0.0, "final_p05": initial_capital,
                "final_p50": initial_capital}
    rng = np.random.default_rng(seed)
    pnls = np.array([t.pnl for t in trades])
    dds = np.empty(runs)
    finals = np.empty(runs)
    for i in range(runs):
        shuffled = rng.permutation(pnls)
        equity = initial_capital + np.cumsum(shuffled)
        running_max = np.maximum.accumulate(np.maximum(equity, 1e-9))
        dds[i] = ((running_max - equity) / running_max).max()
        finals[i] = equity[-1]
    return {
        "dd_p50": float(np.percentile(dds, 50)),
        "dd_p95": float(np.percentile(dds, 95)),
        "final_p05": float(np.percentile(finals, 5)),
        "final_p50": float(np.percentile(finals, 50)),
    }
