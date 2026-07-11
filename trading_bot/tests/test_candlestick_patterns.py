"""Testy formacji swiecowych - deterministyczne swiece syntetyczne."""
from __future__ import annotations

import numpy as np

from trading_bot.core.models import Direction
from trading_bot.strategies.candlestick_patterns import CandlestickStrategy
from trading_bot.tests.conftest import make_ohlc


def _downtrend_rows(n: int = 30, start: float = 120.0, step: float = 1.0):
    """Sekwencja spadkowych swiec (kontekst dla formacji byczych)."""
    rows = []
    price = start
    for _ in range(n):
        rows.append((price, price + 0.2, price - step - 0.2, price - step))
        price -= step
    return rows, price


def _uptrend_rows(n: int = 30, start: float = 80.0, step: float = 1.0):
    rows = []
    price = start
    for _ in range(n):
        rows.append((price, price + step + 0.2, price - 0.2, price + step))
        price += step
    return rows, price


def _patterns(df, name=None):
    strat = CandlestickStrategy(min_confidence=0.0)
    signals = strat.scan(df, symbol="T", timeframe="1h")
    if name:
        return [s for s in signals if s.pattern == name]
    return signals


class TestEngulfing:
    def test_bullish_engulfing_detected(self):
        rows, price = _downtrend_rows()
        rows.append((price, price + 0.1, price - 1.1, price - 1.0))          # bearish
        rows.append((price - 1.2, price + 1.7, price - 1.4, price + 1.5))    # obejmuje
        found = _patterns(make_ohlc(rows), "bullish_engulfing")
        assert len(found) == 1
        assert found[0].direction == Direction.LONG
        assert 0.0 < found[0].confidence <= 1.0

    def test_bearish_engulfing_detected(self):
        rows, price = _uptrend_rows()
        rows.append((price, price + 1.1, price - 0.1, price + 1.0))          # bullish
        rows.append((price + 1.2, price + 1.4, price - 1.7, price - 1.5))    # obejmuje
        found = _patterns(make_ohlc(rows), "bearish_engulfing")
        assert len(found) == 1
        assert found[0].direction == Direction.SHORT

    def test_no_engulfing_on_small_candle(self):
        rows, price = _downtrend_rows()
        rows.append((price, price + 0.1, price - 1.1, price - 1.0))
        rows.append((price - 0.9, price - 0.3, price - 1.05, price - 0.5))   # w srodku
        assert _patterns(make_ohlc(rows), "bullish_engulfing") == []

    def test_volume_boosts_confidence(self):
        rows, price = _downtrend_rows()
        rows.append((price, price + 0.1, price - 1.1, price - 1.0))
        rows.append((price - 1.2, price + 1.7, price - 1.4, price + 1.5))
        low_vol = [100.0] * len(rows)
        high_vol = [100.0] * (len(rows) - 1) + [400.0]
        weak = _patterns(make_ohlc(rows, low_vol), "bullish_engulfing")[0]
        strong = _patterns(make_ohlc(rows, high_vol), "bullish_engulfing")[0]
        assert strong.confidence > weak.confidence


class TestStars:
    def test_morning_star(self):
        rows, price = _downtrend_rows()
        rows.append((price, price + 0.1, price - 3.2, price - 3.0))              # duza spadkowa
        rows.append((price - 3.3, price - 3.1, price - 3.6, price - 3.4))        # mala
        rows.append((price - 3.2, price + 0.0, price - 3.4, price - 0.5))        # duza wzrostowa
        found = _patterns(make_ohlc(rows), "morning_star")
        assert len(found) == 1
        assert found[0].direction == Direction.LONG

    def test_evening_star(self):
        rows, price = _uptrend_rows()
        rows.append((price, price + 3.2, price - 0.1, price + 3.0))
        rows.append((price + 3.3, price + 3.6, price + 3.1, price + 3.4))
        rows.append((price + 3.2, price + 3.4, price - 0.0, price + 0.5))
        found = _patterns(make_ohlc(rows), "evening_star")
        assert len(found) == 1
        assert found[0].direction == Direction.SHORT


class TestHammerFamily:
    def test_hammer_after_downtrend(self):
        rows, price = _downtrend_rows()
        body = 0.4
        rows.append((price, price + 0.1, price - 3.0, price + body))  # dlugi dolny cien
        found = _patterns(make_ohlc(rows), "hammer")
        assert len(found) == 1
        assert found[0].direction == Direction.LONG

    def test_hanging_man_after_uptrend(self):
        rows, price = _uptrend_rows()
        rows.append((price, price + 0.1, price - 3.0, price + 0.4))
        found = _patterns(make_ohlc(rows), "hanging_man")
        assert len(found) == 1
        assert found[0].direction == Direction.SHORT

    def test_shooting_star_after_uptrend(self):
        rows, price = _uptrend_rows()
        rows.append((price, price + 3.0, price - 0.1, price + 0.4))
        found = _patterns(make_ohlc(rows), "shooting_star")
        assert len(found) == 1
        assert found[0].direction == Direction.SHORT


class TestThreeCandles:
    def test_three_white_soldiers(self):
        rows, price = _downtrend_rows()
        for k in range(3):
            rows.append((price + 2 * k, price + 2 * k + 2.1, price + 2 * k - 0.1, price + 2 * k + 2))
        found = _patterns(make_ohlc(rows), "three_white_soldiers")
        assert len(found) == 1
        assert found[0].direction == Direction.LONG

    def test_three_black_crows(self):
        rows, price = _uptrend_rows()
        for k in range(3):
            rows.append((price - 2 * k, price - 2 * k + 0.1, price - 2 * k - 2.1, price - 2 * k - 2))
        found = _patterns(make_ohlc(rows), "three_black_crows")
        assert len(found) == 1
        assert found[0].direction == Direction.SHORT


class TestDoji:
    def test_standard_doji_is_neutral(self):
        rows, price = _uptrend_rows()
        rows.append((price, price + 1.0, price - 1.0, price + 0.01))
        found = _patterns(make_ohlc(rows), "doji")
        assert len(found) == 1
        assert found[0].direction == Direction.HOLD

    def test_dragonfly_doji(self):
        rows, price = _downtrend_rows()
        rows.append((price, price + 0.05, price - 2.0, price + 0.01))
        found = _patterns(make_ohlc(rows), "dragonfly_doji")
        assert len(found) == 1
        assert found[0].direction == Direction.LONG

    def test_gravestone_doji(self):
        rows, price = _uptrend_rows()
        rows.append((price, price + 2.0, price - 0.05, price + 0.01))
        found = _patterns(make_ohlc(rows), "gravestone_doji")
        assert len(found) == 1
        assert found[0].direction == Direction.SHORT


def test_confidence_always_in_range(synthetic_df):
    strat = CandlestickStrategy(min_confidence=0.0)
    for s in strat.scan(synthetic_df, symbol="X", timeframe="1h"):
        assert 0.0 <= s.confidence <= 1.0
