"""Testy formacji harmonicznych na syntetycznych sciezkach XABCD."""
from __future__ import annotations

import numpy as np
import pytest

import pandas as pd

from trading_bot.core.indicators import Pivot
from trading_bot.core.models import Direction
from trading_bot.strategies.harmonic_patterns import HarmonicStrategy, _ratio_match


def make_exact(prices: list[float]) -> pd.DataFrame:
    """OHLCV bez szumu (open=high=low=close) - dokladne poziomy Fibonacciego.

    make_df dodaje +-0.1% na high/low, co przy tolerancji +-2% na ratio
    potrafi wypchnac idealna formacje poza prog - tu tego unikamy.
    """
    closes = np.asarray(prices, dtype=float)
    index = pd.date_range("2024-01-01", periods=len(closes), freq="1h", tz="UTC")
    return pd.DataFrame(
        {"open": closes, "high": closes, "low": closes, "close": closes,
         "volume": np.full(len(closes), 100.0)},
        index=index,
    )


def path(points: list[float], bars_per_wave: int = 10, lead_in: float | None = None) -> list[float]:
    """Sciezka cen liniowo interpolowana miedzy punktami zwrotnymi."""
    prices: list[float] = []
    if lead_in is not None:
        prices.extend(np.linspace(lead_in, points[0], bars_per_wave * 2).tolist())
    for a, b in zip(points, points[1:]):
        prices.extend(np.linspace(a, b, bars_per_wave, endpoint=False).tolist())
    prices.append(points[-1])
    return prices


def gartley_bullish_prices() -> list[float]:
    """X=100 A=110 B=103.82(0.618) C=106.91 D=102.14(0.786) + potwierdzenie."""
    x, a = 100.0, 110.0
    b = a - 0.618 * (a - x)
    c = b + 0.5 * (a - b)
    d = a - 0.786 * (a - x)
    prices = path([x, a, b, c, d], bars_per_wave=10, lead_in=112.0)
    prices += [d + 0.3, d + 0.6, d + 0.9, d + 1.2]  # potwierdzenie pivotu D
    return prices


def detect(prices: list[float], **kwargs) -> list:
    strat = HarmonicStrategy(min_confidence=0.0, pivot_window=3, **kwargs)
    return strat.scan(make_exact(prices), symbol="T", timeframe="1h")


class TestRatioMatch:
    def test_exact_ratio_scores_one(self):
        assert _ratio_match(0.618, (0.618,), 0.02) == pytest.approx(1.0)

    def test_within_tolerance(self):
        assert _ratio_match(0.618 * 1.015, (0.618,), 0.02) > 0.0

    def test_outside_tolerance_rejected(self):
        assert _ratio_match(0.618 * 1.03, (0.618,), 0.02) == 0.0

    def test_multiple_ideals(self):
        assert _ratio_match(1.60, (1.272, 1.618), 0.02) > 0.0


class TestGartley:
    def test_bullish_gartley_detected(self):
        signals = [s for s in detect(gartley_bullish_prices()) if s.pattern == "gartley"]
        assert len(signals) == 1
        sig = signals[0]
        assert sig.direction == Direction.LONG
        assert 0.0 < sig.confidence <= 1.0
        assert "prz" in sig.meta
        assert set(sig.meta["points"]) == {"X", "A", "B", "C", "D"}

    def test_bearish_gartley_detected(self):
        # lustrzane odbicie wzgledem 100
        mirrored = [200.0 - p for p in gartley_bullish_prices()]
        signals = [s for s in detect(mirrored) if s.pattern == "gartley"]
        assert len(signals) == 1
        assert signals[0].direction == Direction.SHORT

    def test_bad_b_ratio_rejected(self):
        """B na 0.70 zamiast 0.618 (poza tolerancja 2%) -> brak Gartleya."""
        x, a = 100.0, 110.0
        b = a - 0.70 * (a - x)
        c = b + 0.5 * (a - b)
        d = a - 0.786 * (a - x)
        prices = path([x, a, b, c, d], 10, lead_in=112.0) + [d + 0.3, d + 0.6, d + 0.9, d + 1.2]
        assert [s for s in detect(prices) if s.pattern == "gartley"] == []

    def test_stale_pattern_rejected(self):
        """Formacja zakonczona zbyt dawno nie generuje sygnalu."""
        prices = gartley_bullish_prices() + [102.5] * 40
        assert [s for s in detect(prices) if s.pattern == "gartley"] == []


class TestTimeSymmetry:
    def _pivots(self, durations: list[int]) -> list[Pivot]:
        kinds = ["low", "high", "low", "high", "low"]
        idx = 0
        pivots = [Pivot(0, 100.0, kinds[0])]
        for k, d in enumerate(durations, start=1):
            idx += d
            pivots.append(Pivot(idx, 100.0, kinds[k]))
        return pivots

    def test_equal_waves_score_high(self):
        score = HarmonicStrategy._time_symmetry(self._pivots([10, 10, 10, 10]))
        assert score > 0.9

    def test_extreme_asymmetry_rejected(self):
        score = HarmonicStrategy._time_symmetry(self._pivots([10, 10, 10, 50]))
        assert score == 0.0


class TestOtherPatterns:
    @pytest.mark.parametrize(
        "name,b_ratio,d_ratio",
        [("bat", 0.500, 0.886), ("crab", 0.618, 1.618), ("butterfly", 0.786, 1.272)],
    )
    def test_pattern_ratios_detected(self, name, b_ratio, d_ratio):
        x, a = 100.0, 110.0
        xa = a - x
        b = a - b_ratio * xa
        c = b + 0.5 * (a - b)
        d = a - d_ratio * xa
        prices = path([x, a, b, c, d], 10, lead_in=112.0)
        prices += [d + 0.3, d + 0.6, d + 0.9, d + 1.2]
        signals = [s for s in detect(prices) if s.pattern == name]
        assert len(signals) == 1, f"{name}: oczekiwano detekcji"
        assert signals[0].direction == Direction.LONG

    def test_abcd_detected(self):
        a, b = 100.0, 110.0
        c = b - 0.618 * (b - a)
        d = c + (b - a)  # CD = AB
        prices = path([a, b, c, d], 14, lead_in=101.0)
        prices += [d - 0.3, d - 0.6, d - 0.9, d - 1.2]
        signals = [s for s in detect(prices) if s.pattern == "abcd"]
        assert len(signals) == 1
        assert signals[0].direction == Direction.SHORT  # D jest szczytem


def test_confidence_in_range_on_random_walk(synthetic_df):
    strat = HarmonicStrategy(min_confidence=0.0)
    for s in strat.scan(synthetic_df, symbol="X", timeframe="1h"):
        assert 0.0 <= s.confidence <= 1.0
