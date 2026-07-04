"""Testy strategii mikrostruktury: VWAP, order flow, S/R, liquidity void."""
from __future__ import annotations

import numpy as np

from trading_bot.core.models import Direction
from trading_bot.strategies.microstructure import MicrostructureStrategy
from trading_bot.tests.conftest import make_df, make_ohlc


def detect(df, name=None, **kwargs):
    strat = MicrostructureStrategy(min_confidence=0.0, **kwargs)
    signals = strat.scan(df, symbol="T", timeframe="1h")
    return [s for s in signals if name is None or s.pattern == name]


class TestVwapDeviation:
    def test_spike_above_vwap_gives_short(self):
        prices = [100.0 + 0.2 * np.sin(i / 5) for i in range(150)]
        prices += [100.0, 100.5, 101.5, 103.0, 106.0]  # gwaltowny rajd
        found = detect(make_df(prices), "vwap_deviation")
        assert len(found) == 1
        assert found[0].direction == Direction.SHORT
        assert found[0].meta["zscore"] > 2.0

    def test_no_signal_in_calm_market(self):
        prices = [100.0 + 0.05 * np.sin(i / 7) for i in range(150)]
        assert detect(make_df(prices), "vwap_deviation") == []


class TestOrderFlow:
    def test_bullish_imbalance(self):
        # swiece zamykajace przy high = przewaga kupujacych
        rows = [(100 + i * 0.1, 100 + i * 0.1 + 1.0, 100 + i * 0.1 - 0.1,
                 100 + i * 0.1 + 0.95) for i in range(120)]
        found = detect(make_ohlc(rows), "order_flow_imbalance")
        assert len(found) == 1
        assert found[0].direction == Direction.LONG


class TestSupportResistance:
    def test_levels_require_min_touches(self):
        # 4 odbicia od 100
        prices = []
        for _ in range(4):
            prices += list(np.linspace(104, 100, 15)) + list(np.linspace(100, 104, 15))
        df = make_df(prices)
        strat = MicrostructureStrategy(sr_min_touches=3)
        levels = strat.find_levels(df)
        assert any(kind == "support" and touches >= 3 and abs(level - 100) < 1
                   for level, touches, kind in levels)

    def test_bounce_signal_at_support(self):
        prices = []
        for _ in range(4):
            prices += list(np.linspace(104, 100, 15)) + list(np.linspace(100, 104, 15))
        prices += list(np.linspace(104, 100.2, 10)) + [100.6]  # test wsparcia
        found = detect(make_df(prices), "support_bounce")
        assert len(found) == 1
        assert found[0].direction == Direction.LONG
        assert found[0].meta["touches"] >= 3


class TestLiquidityVoid:
    def test_void_detected(self):
        rows = [(100.0, 100.6, 99.4, 100.0)] * 140
        # swieca-void: ogromny zakres, niski wolumen
        rows.append((100.0, 112.0, 99.8, 111.0))
        rows += [(111.0, 111.6, 110.4, 111.0)] * 3
        volumes = [100.0] * 141 + [100.0] * 3
        volumes[140] = 20.0
        found = detect(make_ohlc(rows, volumes), "liquidity_void")
        assert len(found) == 1
        # cena nad srodkiem voidu -> oczekiwany powrot w dol
        assert found[0].direction == Direction.SHORT
