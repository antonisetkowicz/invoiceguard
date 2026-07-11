"""Testy metryk wydajnosci."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from trading_bot.backtest.performance_metrics import (
    compute_report,
    max_drawdown,
    monte_carlo,
    monthly_returns,
    profit_factor,
    sharpe_ratio,
    sortino_ratio,
    win_rate,
)
from trading_bot.core.models import Direction, Trade


def trade(pnl: float) -> Trade:
    """Trade o zadanym PnL (LONG, qty=1)."""
    return Trade("X", Direction.LONG, 1.0, 100.0, 100.0 + pnl)


class TestSharpeSortino:
    def test_positive_returns_positive_sharpe(self):
        rets = pd.Series([0.01] * 50 + [0.02] * 50)
        assert sharpe_ratio(rets) > 0

    def test_zero_variance_zero_sharpe(self):
        assert sharpe_ratio(pd.Series([0.0] * 10)) == 0.0

    def test_sortino_ignores_upside_vol(self):
        rets = pd.Series([0.05, -0.01] * 30)
        assert sortino_ratio(rets) > sharpe_ratio(rets)


class TestDrawdown:
    def test_known_drawdown(self):
        equity = pd.Series([100, 120, 90, 130], dtype=float)
        assert max_drawdown(equity) == pytest.approx(0.25)  # 120 -> 90

    def test_monotonic_no_drawdown(self):
        assert max_drawdown(pd.Series([1.0, 2.0, 3.0])) == 0.0


class TestTradeStats:
    def test_profit_factor(self):
        trades = [trade(10), trade(20), trade(-15)]
        assert profit_factor(trades) == pytest.approx(2.0)

    def test_win_rate(self):
        trades = [trade(1), trade(-1), trade(1), trade(1)]
        assert win_rate(trades) == pytest.approx(0.75)

    def test_report_dict_keys(self):
        equity = pd.Series(
            np.linspace(10_000, 11_000, 100),
            index=pd.date_range("2024-01-01", periods=100, freq="1D"),
        )
        rep = compute_report(equity, [trade(5), trade(-2)])
        d = rep.as_dict()
        assert {"sharpe", "sortino", "max_drawdown", "profit_factor",
                "win_rate", "expectancy", "total_return", "n_trades"} <= set(d)


class TestMonteCarlo:
    def test_percentiles_present_and_ordered(self):
        trades = [trade(float(x)) for x in np.random.default_rng(0).normal(2, 10, 100)]
        mc = monte_carlo(trades, initial_capital=10_000, runs=200)
        assert 0.0 <= mc["dd_p50"] <= mc["dd_p95"] <= 1.0
        assert mc["final_p05"] <= mc["final_p50"]

    def test_empty_trades(self):
        mc = monte_carlo([], 10_000, runs=100)
        assert mc["dd_p95"] == 0.0


def test_monthly_returns_shape():
    equity = pd.Series(
        np.linspace(100, 150, 400),
        index=pd.date_range("2023-01-01", periods=400, freq="1D"),
    )
    matrix = monthly_returns(equity)
    assert 2023 in matrix.index
    assert matrix.notna().sum().sum() >= 10
