"""Testy konfiguracji, optymalizacji, pattern detectora i paper tradera."""
from __future__ import annotations

import pytest

from trading_bot.backtest.optimization import BayesianOptimizer, random_search
from trading_bot.core.config import Settings, load_exchanges, load_settings
from trading_bot.core.data_engine import generate_synthetic_ohlcv
from trading_bot.core.pattern_detector import PatternDetector
from trading_bot.execution.paper_trader import PaperTrader


class TestConfig:
    def test_load_default_settings(self):
        cfg = load_settings()
        assert cfg.signals.long_threshold == 0.6
        assert cfg.signals.short_threshold == -0.6
        assert cfg.risk.max_position_pct == 0.05
        assert cfg.risk.max_daily_loss_pct == 0.03
        assert cfg.patterns.fib_tolerance == 0.02
        assert cfg.mode == "paper"

    def test_load_exchanges(self):
        ex = load_exchanges()
        assert ex.default_exchange == "binance"
        assert "binance" in ex.exchanges
        assert ex.exchanges["binance"].sandbox is True

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("TRADINGBOT_RISK__RR_MIN", "3.5")
        cfg = load_settings()
        assert cfg.risk.rr_min == 3.5

    def test_invalid_threshold_rejected(self):
        with pytest.raises(Exception):
            Settings.model_validate({"signals": {"long_threshold": -1.0}})


class TestOptimization:
    def test_bayesian_finds_optimum(self):
        opt = BayesianOptimizer({"x": (0.0, 10.0)}, n_initial=6, seed=3)
        best = opt.optimize(lambda p: -(p["x"] - 3.0) ** 2, n_iter=25)
        assert abs(best.params["x"] - 3.0) < 1.0
        assert len(best.history) == 25

    def test_random_search_baseline(self):
        best = random_search({"x": (0.0, 10.0)}, lambda p: -(p["x"] - 7.0) ** 2,
                             n_iter=60, seed=4)
        assert abs(best.params["x"] - 7.0) < 1.5

    def test_empty_space_rejected(self):
        with pytest.raises(ValueError):
            BayesianOptimizer({})


class TestPatternDetector:
    def test_default_has_all_strategies(self):
        det = PatternDetector.default()
        names = {s.name for s in det.strategies}
        assert names == {"candlestick", "harmonic", "chart", "microstructure"}

    def test_detect_all_multi_timeframe(self):
        det = PatternDetector.default()
        frames = {
            "1h": generate_synthetic_ohlcv(300, seed=31),
            "4h": generate_synthetic_ohlcv(150, seed=32, freq="4h"),
        }
        signals = det.detect_all(frames, symbol="BTC/USDT")
        assert all(s.timeframe in ("1h", "4h") for s in signals)
        assert all(0 <= s.confidence <= 1 for s in signals)

    def test_short_data_skipped_not_crash(self):
        det = PatternDetector.default()
        frames = {"1h": generate_synthetic_ohlcv(10, seed=33)}
        assert det.detect_all(frames, symbol="X") == []


class TestPaperTraderIntegration:
    def test_full_pipeline_runs(self):
        settings = Settings(
            strategy_weights={"candlestick": 1.0, "harmonic": 1.2,
                              "chart": 1.1, "microstructure": 0.9},
            timeframes=["1h"],
        )
        trader = PaperTrader(settings)
        df = generate_synthetic_ohlcv(bars=700, seed=34, volatility=0.02)
        trader.warmup({"1h": df.iloc[:300]})
        for i in range(300, len(df)):
            frames = {"1h": df.iloc[max(0, i - 300): i + 1]}
            trader.on_bar("BTC/USDT", frames)
        trader.close_all({"BTC/USDT": float(df["close"].iloc[-1])})
        # kapital sie zmienil lub nie bylo transakcji - obie sciezki poprawne
        assert trader.risk.capital > 0
        for trade in trader.trades:
            assert trade.exit_reason in ("stop_loss", "take_profit", "shutdown")
