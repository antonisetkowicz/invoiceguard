"""Testy silnika konfluencji (glosowanie wazone + progi + konflikty TF)."""
from __future__ import annotations

import pytest

from trading_bot.core.config import SignalConfig
from trading_bot.core.models import Direction, Regime, Signal, StrategyStyle
from trading_bot.core.signal_aggregator import SignalAggregator


def sig(strategy="candlestick", direction=Direction.LONG, confidence=0.9,
        timeframe="1h", style=StrategyStyle.TREND_FOLLOWING) -> Signal:
    return Signal(strategy=strategy, pattern="p", direction=direction,
                  confidence=confidence, timeframe=timeframe, symbol="BTC/USDT",
                  style=style)


@pytest.fixture
def aggregator() -> SignalAggregator:
    return SignalAggregator(
        strategy_weights={"candlestick": 1.0, "harmonic": 1.2},
        regime_multipliers={
            "trending_up": {"trend_following": 1.2, "mean_reversion": 0.8},
        },
        config=SignalConfig(),
    )


class TestThresholds:
    def test_strong_long(self, aggregator):
        result = aggregator.aggregate([sig(confidence=0.9)], Regime.TRENDING_UP)
        assert result.decision == "LONG"
        assert result.score > 0.6

    def test_strong_short(self, aggregator):
        result = aggregator.aggregate(
            [sig(direction=Direction.SHORT, confidence=0.9)], Regime.TRENDING_UP
        )
        assert result.decision == "SHORT"

    def test_neutral_hold(self, aggregator):
        result = aggregator.aggregate(
            [sig(confidence=0.1), sig(direction=Direction.SHORT, confidence=0.1)],
            Regime.TRENDING_UP,
        )
        assert result.decision == "HOLD"

    def test_weak_zone(self, aggregator):
        result = aggregator.aggregate([sig(confidence=0.4)], Regime.TRENDING_UP)
        assert result.decision == "WEAK"

    def test_empty_signals_hold(self, aggregator):
        assert aggregator.aggregate([], Regime.TRENDING_UP).decision == "HOLD"


class TestWeighting:
    def test_weighted_average_formula(self):
        agg = SignalAggregator({"a": 1.0, "b": 1.0}, {}, SignalConfig())
        signals = [
            sig(strategy="a", confidence=0.8),
            sig(strategy="b", direction=Direction.SHORT, confidence=0.8),
        ]
        result = agg.aggregate(signals, Regime.MEAN_REVERTING)
        assert result.score == pytest.approx(0.0, abs=1e-9)

    def test_regime_multiplier_shifts_result(self, aggregator):
        signals = [
            sig(style=StrategyStyle.TREND_FOLLOWING, confidence=0.8),
            sig(strategy="harmonic", direction=Direction.SHORT, confidence=0.8,
                style=StrategyStyle.MEAN_REVERSION),
        ]
        trending = aggregator.aggregate(signals, Regime.TRENDING_UP).score
        neutral = aggregator.aggregate(signals, Regime.LOW_VOLATILITY).score
        # w trendzie trend-following (LONG) dostaje 1.2x, mean-rev 0.8x
        assert trending > neutral

    def test_confidence_multiplier_range(self, aggregator):
        # sygnal o wyzszym confidence dominuje przy rownych wagach bazowych
        signals = [
            sig(strategy="candlestick", confidence=0.9),
            sig(strategy="candlestick", direction=Direction.SHORT, confidence=0.2),
        ]
        result = aggregator.aggregate(signals, Regime.MEAN_REVERTING)
        assert result.score > 0


class TestTimeframeConflict:
    def test_conflicting_timeframes_penalized(self, aggregator):
        aligned = [sig(timeframe="1h", confidence=0.9), sig(timeframe="4h", confidence=0.9)]
        conflicted = [
            sig(timeframe="1h", confidence=0.9),
            sig(timeframe="4h", direction=Direction.SHORT, confidence=0.9),
        ]
        score_aligned = abs(aggregator.aggregate(aligned, Regime.TRENDING_UP).score)
        result_conflicted = aggregator.aggregate(conflicted, Regime.TRENDING_UP)
        assert result_conflicted.conflict_penalty > 0
        assert abs(result_conflicted.score) < score_aligned

    def test_single_timeframe_no_penalty(self, aggregator):
        signals = [sig(confidence=0.9), sig(direction=Direction.SHORT, confidence=0.5)]
        assert aggregator.aggregate(signals, Regime.TRENDING_UP).conflict_penalty == 0.0
