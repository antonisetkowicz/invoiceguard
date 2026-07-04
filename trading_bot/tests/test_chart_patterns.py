"""Testy formacji klasycznych (H&S, podwojne szczyty, trojkaty, prostokat)."""
from __future__ import annotations

import numpy as np

from trading_bot.core.models import Direction
from trading_bot.strategies.chart_patterns import ChartPatternStrategy
from trading_bot.tests.conftest import make_df


def seg(a: float, b: float, n: int = 8) -> list[float]:
    return np.linspace(a, b, n, endpoint=False).tolist()


def detect(prices: list[float], **kwargs):
    strat = ChartPatternStrategy(min_confidence=0.0, pivot_window=3, **kwargs)
    return strat.scan(make_df(prices), symbol="T", timeframe="1h")


class TestHeadAndShoulders:
    def hs_prices(self) -> list[float]:
        prices = seg(95, 110, 16)                 # rajd do lewego ramienia
        prices += seg(110, 105) + seg(105, 115)   # LS -> t1 -> head
        prices += seg(115, 105) + seg(105, 110)   # head -> t2 -> RS
        prices += seg(110, 100, 12)               # przebicie necklina (105)
        return prices

    def test_hs_detected_after_neckline_break(self):
        signals = [s for s in detect(self.hs_prices()) if s.pattern == "head_and_shoulders"]
        assert len(signals) == 1
        sig = signals[0]
        assert sig.direction == Direction.SHORT
        assert sig.meta["target"] < sig.meta["neckline"]

    def test_no_signal_before_neckline_break(self):
        prices = seg(95, 110, 16) + seg(110, 105) + seg(105, 115)
        prices += seg(115, 105) + seg(105, 110) + seg(110, 107, 12)  # nad neckline
        assert [s for s in detect(prices) if s.pattern == "head_and_shoulders"] == []

    def test_unequal_shoulders_rejected(self):
        prices = seg(95, 110, 20) + seg(110, 105) + seg(105, 115)
        prices += seg(115, 105) + seg(105, 102, 4) + seg(102, 98, 16)  # RS za nisko
        assert [s for s in detect(prices) if s.pattern == "head_and_shoulders"] == []

    def test_inverse_hs_detected(self):
        mirrored = [210.0 - p for p in self.hs_prices()]
        signals = [s for s in detect(mirrored) if s.pattern == "inverse_head_and_shoulders"]
        assert len(signals) == 1
        assert signals[0].direction == Direction.LONG


class TestDoubleTopBottom:
    def test_double_top(self):
        prices = seg(94, 90, 20) + seg(90, 110, 16) + seg(110, 100) + seg(100, 110) + seg(110, 96, 12)
        signals = [s for s in detect(prices) if s.pattern == "double_top"]
        assert len(signals) == 1
        assert signals[0].direction == Direction.SHORT

    def test_double_bottom(self):
        prices = seg(106, 110, 20) + seg(110, 90, 16) + seg(90, 100) + seg(100, 90) + seg(90, 104, 12)
        signals = [s for s in detect(prices) if s.pattern == "double_bottom"]
        assert len(signals) == 1
        assert signals[0].direction == Direction.LONG


class TestTriangles:
    def test_ascending_triangle_breakout(self):
        prices = seg(96, 100, 12) + seg(100, 110) + seg(110, 100) + seg(100, 110) + seg(110, 104)
        prices += seg(104, 110) + seg(110, 107) + seg(107, 113, 6)  # wybicie gora
        signals = [s for s in detect(prices) if "triangle" in s.pattern]
        assert any(s.pattern == "ascending_triangle" and s.direction == Direction.LONG
                   for s in signals)

    def test_descending_triangle_breakdown(self):
        prices = seg(114, 110, 12) + seg(110, 100) + seg(100, 110) + seg(110, 100) + seg(100, 106)
        prices += seg(106, 100) + seg(100, 103) + seg(103, 97, 6)  # wybicie dol
        signals = [s for s in detect(prices) if "triangle" in s.pattern]
        assert any(s.pattern == "descending_triangle" and s.direction == Direction.SHORT
                   for s in signals)


class TestRectangle:
    def test_rectangle_breakout(self):
        prices = seg(96, 100, 12)
        for _ in range(3):
            prices += seg(100, 110) + seg(110, 100)
        prices += seg(100, 116, 6)  # wybicie ponad gorna bande
        signals = [s for s in detect(prices) if s.pattern == "rectangle_breakout"]
        assert len(signals) == 1
        assert signals[0].direction == Direction.LONG


class TestFlag:
    def test_bull_flag_breakout(self):
        base = [100.0] * 40
        pole = seg(100, 120, 20)                      # maszt +20%
        flag = np.linspace(120, 118.5, 9).tolist()    # plytka konsolidacja
        prices = base + pole + flag + [120.5]         # wybicie
        signals = [s for s in detect(prices) if s.pattern in ("flag", "pennant")]
        assert len(signals) >= 1
        assert all(s.direction == Direction.LONG for s in signals)


def test_no_crash_on_random_walk(synthetic_df):
    strat = ChartPatternStrategy(min_confidence=0.0)
    for s in strat.scan(synthetic_df, symbol="X", timeframe="1h"):
        assert 0.0 <= s.confidence <= 1.0
