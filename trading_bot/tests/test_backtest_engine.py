"""Testy silnika backtestu: brak lookahead, koszty, walk-forward, raport."""
from __future__ import annotations

import pandas as pd
import pytest

from trading_bot.backtest.backtest_engine import BacktestEngine, BacktestResult
from trading_bot.backtest.report import generate_html_report
from trading_bot.core.config import Settings
from trading_bot.core.data_engine import generate_synthetic_ohlcv
from trading_bot.core.models import Direction, Trade


@pytest.fixture
def settings() -> Settings:
    return Settings(
        strategy_weights={"candlestick": 1.0, "harmonic": 1.2,
                          "chart": 1.1, "microstructure": 0.9},
    )


@pytest.fixture
def engine(settings) -> BacktestEngine:
    return BacktestEngine(settings, lookback=200)


class TestRun:
    def test_run_produces_equity_curve(self, engine):
        df = generate_synthetic_ohlcv(bars=800, seed=21, volatility=0.02)
        result = engine.run(df, symbol="BTC/USDT", with_monte_carlo=False)
        assert isinstance(result, BacktestResult)
        assert not result.equity.empty
        assert result.equity.index.is_monotonic_increasing
        assert (result.equity > 0).all()

    def test_costs_applied_to_trades(self, engine):
        df = generate_synthetic_ohlcv(bars=1200, seed=22, volatility=0.03)
        result = engine.run(df, symbol="BTC/USDT", with_monte_carlo=False)
        for t in result.trades:
            assert t.commission > 0
            assert t.slippage > 0

    def test_trades_have_valid_rr(self, engine):
        df = generate_synthetic_ohlcv(bars=1200, seed=23, volatility=0.03)
        result = engine.run(df, symbol="BTC/USDT", with_monte_carlo=False)
        for t in result.trades:
            assert t.exit_reason in ("stop_loss", "take_profit")

    def test_deterministic(self, engine):
        df = generate_synthetic_ohlcv(bars=600, seed=24)
        r1 = engine.run(df, symbol="X", with_monte_carlo=False)
        r2 = engine.run(df, symbol="X", with_monte_carlo=False)
        assert r1.report.as_dict() == r2.report.as_dict()


class TestWalkForward:
    def test_windows_created(self, settings):
        engine = BacktestEngine(settings, lookback=200)
        # ~11 miesiecy godzinowych danych -> min. 2 okna (6m train + 2m test)
        df = generate_synthetic_ohlcv(bars=24 * 335, seed=25, volatility=0.015)
        result = engine.walk_forward(df, symbol="BTC/USDT")
        assert len(result.windows) >= 2
        assert result.monte_carlo is not None

    def test_report_html_generated(self, settings, tmp_path):
        engine = BacktestEngine(settings, lookback=200)
        df = generate_synthetic_ohlcv(bars=24 * 250, seed=26, volatility=0.02)
        result = engine.walk_forward(df, symbol="BTC/USDT")
        out = generate_html_report(result, tmp_path / "report.html", title="Test")
        content = out.read_text(encoding="utf-8")
        assert "Krzywa kapitalu" in content
        assert "Sharpe" in content
        assert "<svg" in content


class TestReportEdgeCases:
    def test_report_with_no_trades(self, tmp_path):
        equity = pd.Series(
            [10_000.0] * 10,
            index=pd.date_range("2024-01-01", periods=10, freq="1D"),
        )
        from trading_bot.backtest.performance_metrics import compute_report

        result = BacktestResult(
            equity=equity, trades=[], report=compute_report(equity, []),
        )
        out = generate_html_report(result, tmp_path / "empty.html")
        assert out.exists()
