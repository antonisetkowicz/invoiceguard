"""Testy zarzadzania ryzykiem: Kelly, SL/TP, limity, filtry, trailing."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from trading_bot.core.config import RiskConfig
from trading_bot.core.indicators import atr
from trading_bot.core.models import Direction, Position
from trading_bot.core.risk_manager import RiskManager, kelly_fraction
from trading_bot.tests.conftest import make_df
from trading_bot.core.data_engine import generate_synthetic_ohlcv


@pytest.fixture
def risk() -> RiskManager:
    return RiskManager(RiskConfig())


@pytest.fixture
def df() -> pd.DataFrame:
    return generate_synthetic_ohlcv(bars=300, seed=11)


class TestKelly:
    def test_positive_edge(self):
        # W=0.5, R=2 -> f = 0.5 - 0.5/2 = 0.25
        assert kelly_fraction(0.5, 2.0, 1.0) == pytest.approx(0.25)

    def test_negative_edge_returns_zero(self):
        assert kelly_fraction(0.3, 1.0, 1.0) == 0.0

    def test_invalid_inputs(self):
        assert kelly_fraction(0.5, 1.0, 0.0) == 0.0
        assert kelly_fraction(1.5, 1.0, 1.0) == 0.0

    def test_estimate_capped_at_max_position(self, risk):
        for _ in range(50):
            risk._wins.append(100.0)  # sztucznie idealna historia
        assert risk.estimate_kelly() <= risk.config.max_position_pct


class TestPlanTrade:
    def test_plan_has_min_rr(self, risk, df):
        plan = risk.plan_trade("BTC/USDT", Direction.LONG, df)
        assert plan is not None
        risk_dist = plan.entry_price - plan.stop_loss
        reward = plan.take_profit - plan.entry_price
        assert risk_dist > 0
        assert reward / risk_dist == pytest.approx(risk.config.rr_min)

    def test_short_plan_levels(self, risk, df):
        plan = risk.plan_trade("BTC/USDT", Direction.SHORT, df)
        assert plan is not None
        assert plan.stop_loss > plan.entry_price > plan.take_profit

    def test_position_risk_within_cap(self, risk, df):
        plan = risk.plan_trade("BTC/USDT", Direction.LONG, df)
        assert plan is not None
        risked = plan.quantity * (plan.entry_price - plan.stop_loss)
        assert risked <= risk.capital * risk.config.max_position_pct * 1.001

    def test_structure_stop_tighter_wins(self, risk, df):
        entry = float(df["close"].iloc[-1])
        atr_val = float(atr(df, 14).iloc[-1])
        tight = entry - 0.5 * atr_val
        plan = risk.plan_trade("BTC/USDT", Direction.LONG, df, structure_stop=tight)
        assert plan is not None
        assert plan.stop_loss == pytest.approx(tight)

    def test_hold_direction_returns_none(self, risk, df):
        assert risk.plan_trade("BTC/USDT", Direction.HOLD, df) is None


class TestDailyLossLimit:
    def test_halt_after_daily_loss(self, risk, df):
        now = datetime(2024, 5, 1, 10, tzinfo=timezone.utc)
        risk.on_new_bar(now)
        risk.record_trade(-risk.capital * 0.05)  # -5% > limit 3%
        assert risk.halted_until_next_day
        assert risk.plan_trade("BTC/USDT", Direction.LONG, df) is None

    def test_unhalt_next_day(self, risk):
        now = datetime(2024, 5, 1, 10, tzinfo=timezone.utc)
        risk.on_new_bar(now)
        risk.record_trade(-risk.capital * 0.05)
        assert risk.halted_until_next_day
        risk.on_new_bar(now + timedelta(days=1))
        assert not risk.halted_until_next_day
        assert risk.daily_pnl == 0.0


class TestVolatilityFilter:
    def test_blocks_on_atr_spike(self, risk):
        prices = [100.0 + 0.1 * (i % 5) for i in range(200)]
        df = make_df(prices)
        # ostatnie swiece: ogromny zakres -> ATR spike
        df.iloc[-5:, df.columns.get_loc("high")] = 140.0
        df.iloc[-5:, df.columns.get_loc("low")] = 60.0
        assert not risk.volatility_ok(df)

    def test_allows_normal_volatility(self, risk, df):
        assert risk.volatility_ok(df)


class TestCorrelationFilter:
    def _positions(self, symbols):
        return [Position(s, Direction.LONG, 1.0, 100.0, 95.0, 110.0) for s in symbols]

    def test_blocks_max_correlated(self, risk):
        base = generate_synthetic_ohlcv(bars=200, seed=5)["close"]
        closes = {s: base for s in ("A", "B", "C", "D")}  # identyczne = korelacja 1
        positions = self._positions(["A", "B", "C"])
        assert not risk.correlation_ok("D", positions, closes)

    def test_allows_uncorrelated(self, risk):
        closes = {
            "A": generate_synthetic_ohlcv(200, seed=1)["close"],
            "B": generate_synthetic_ohlcv(200, seed=2)["close"],
            "C": generate_synthetic_ohlcv(200, seed=3)["close"],
            "D": generate_synthetic_ohlcv(200, seed=4)["close"],
        }
        positions = self._positions(["A", "B", "C"])
        assert risk.correlation_ok("D", positions, closes)


class TestTrailing:
    def test_trailing_activates_after_1r(self, risk):
        pos = Position("X", Direction.LONG, 1.0, 100.0, 95.0, 110.0)
        pos = risk.update_trailing(pos, 105.0, atr_value=1.0)  # +1R
        assert pos.trailing_active
        assert risk.effective_stop(pos) >= 100.0  # co najmniej break-even

    def test_trailing_never_moves_down(self, risk):
        pos = Position("X", Direction.LONG, 1.0, 100.0, 95.0, 110.0)
        pos = risk.update_trailing(pos, 106.0, atr_value=1.0)
        stop_high = risk.effective_stop(pos)
        pos = risk.update_trailing(pos, 103.0, atr_value=1.0)  # cofniecie ceny
        assert risk.effective_stop(pos) >= stop_high

    def test_no_trailing_below_1r(self, risk):
        pos = Position("X", Direction.LONG, 1.0, 100.0, 95.0, 110.0)
        pos = risk.update_trailing(pos, 102.0, atr_value=1.0)  # +0.4R
        assert not pos.trailing_active
        assert risk.effective_stop(pos) == 95.0
