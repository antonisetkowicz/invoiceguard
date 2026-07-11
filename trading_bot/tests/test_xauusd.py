"""Testy strategii dedykowanej XAUUSD (schematy sesyjne zlota)."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from trading_bot.core.config import Settings
from trading_bot.core.models import Direction, StrategyStyle
from trading_bot.core.pattern_detector import PatternDetector
from trading_bot.strategies.xauusd_gold import XauusdStrategy


def gold_day(
    asia_low: float = 2648.0,
    asia_high: float = 2652.0,
    after_asia: list[float] | None = None,
    prev_day_price: float = 2650.0,
    end_hour: int = 14,
) -> pd.DataFrame:
    """Buduje 2 dni M15: dzien poprzedni plaski + Azja w rangu + sesja LDN/NY.

    after_asia: ceny zamkniecia od 07:00 UTC do end_hour (interpolowane
    rownomiernie). Domyslnie cena zostaje w srodku rangu.
    """
    bars_prev = 96                      # pelna doba M15
    bars_asia = 28                      # 00:00-07:00
    start = pd.Timestamp("2024-03-04 00:00", tz="UTC")  # poniedzialek
    idx = pd.date_range(start, periods=bars_prev, freq="15min")

    rng = np.random.default_rng(7)
    prev_close = prev_day_price + rng.normal(0, 0.3, bars_prev).cumsum() * 0.1
    mid = (asia_high + asia_low) / 2
    asia_close = mid + np.sin(np.linspace(0, 6 * np.pi, bars_asia)) * (asia_high - asia_low) / 2 * 0.9

    day2 = pd.date_range(start + pd.Timedelta(days=1), periods=bars_asia, freq="15min")
    n_after = (end_hour - 7) * 4
    after = np.asarray(after_asia if after_asia is not None else [mid] * n_after, dtype=float)
    after_idx = pd.date_range(day2[-1] + pd.Timedelta(minutes=15), periods=len(after), freq="15min")

    closes = np.concatenate([prev_close, asia_close, after])
    index = idx.append(day2).append(after_idx)
    opens = np.concatenate([[closes[0]], closes[:-1]])
    highs = np.maximum(opens, closes) + 0.15
    lows = np.minimum(opens, closes) - 0.15
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes,
         "volume": np.full(len(closes), 100.0)},
        index=index,
    )


def scan(df: pd.DataFrame, name: str | None = None, **kwargs) -> list:
    strat = XauusdStrategy(min_confidence=0.0, **kwargs)
    signals = strat.scan(df, symbol="XAU/USD", timeframe="15m")
    return [s for s in signals if name is None or s.pattern == name]


class TestAsiaBreakout:
    def test_breakout_long_after_tight_range(self):
        # cena w rangu przez cala rano, swieze wybicie na ostatniej swiecy
        after = [2650.5] * 19 + [2654.5]
        found = scan(gold_day(after_asia=after), "asia_breakout")
        assert len(found) == 1
        sig = found[0]
        assert sig.direction == Direction.LONG
        assert sig.style == StrategyStyle.TREND_FOLLOWING
        assert sig.meta["structure_stop"] == pytest.approx(sig.meta["asia_low"])

    def test_breakout_short(self):
        after = [2649.5] * 19 + [2645.5]
        found = scan(gold_day(after_asia=after), "asia_breakout")
        assert len(found) == 1
        assert found[0].direction == Direction.SHORT

    def test_no_breakout_inside_range(self):
        assert scan(gold_day(), "asia_breakout") == []

    def test_stale_breakout_not_resignaled(self):
        """Wybicie sprzed wielu swiec nie generuje sygnalu ponownie."""
        after = np.linspace(2650, 2657, 8).tolist() + [2657.0] * 12
        assert scan(gold_day(after_asia=after), "asia_breakout") == []

    def test_wide_range_rejected(self):
        """Range szerszy niz 8x ATR = brak kompresji, brak sygnalu."""
        after = np.linspace(2680, 2695, 20).tolist()
        df = gold_day(asia_low=2600.0, asia_high=2678.0, after_asia=after)
        assert scan(df, "asia_breakout") == []


class TestLondonFakeout:
    def test_failed_breakout_gives_reversal_short(self):
        spike = np.linspace(2650, 2655, 8).tolist()          # wybicie nad 2652
        comeback = np.linspace(2654, 2649, 4).tolist()       # szybki powrot
        after = spike + comeback
        found = scan(gold_day(after_asia=after), "london_fakeout")
        assert len(found) == 1
        sig = found[0]
        assert sig.direction == Direction.SHORT
        assert sig.style == StrategyStyle.MEAN_REVERSION
        assert sig.meta["structure_stop"] > sig.meta["failed_level"]  # SL nad knotem

    def test_failed_breakdown_gives_reversal_long(self):
        spike = np.linspace(2650, 2645, 8).tolist()
        comeback = np.linspace(2645, 2651, 8).tolist()
        found = scan(gold_day(after_asia=spike + comeback), "london_fakeout")
        assert len(found) == 1
        assert found[0].direction == Direction.LONG


class TestRoundLevelBounce:
    def test_wick_rejection_at_round_level(self):
        # zamkniecia tuz nad 2650; ostatnia swieca z dlugim dolnym knotem
        after = [2653.0] * 19 + [2653.2]
        df = gold_day(after_asia=after)
        df.iloc[-1, df.columns.get_loc("low")] = 2649.8   # knot w poziom 2650
        df.iloc[-1, df.columns.get_loc("open")] = 2653.0
        found = scan(df, "round_level_bounce")
        assert len(found) == 1
        sig = found[0]
        assert sig.direction == Direction.LONG
        assert sig.meta["level"] == pytest.approx(2650.0)

    def test_no_bounce_far_from_level(self):
        after = [2661.0] * 20  # daleko od 2650 i 2675
        assert scan(gold_day(after_asia=after), "round_level_bounce") == []


class TestSessionWeighting:
    def test_asia_signals_dampened(self):
        strat = XauusdStrategy()
        assert strat._session_weight(3) == 0.5
        assert strat._session_weight(14) == 1.0
        assert strat._session_weight(9) == 0.9

    def test_dead_hours_produce_nothing(self):
        strat = XauusdStrategy()
        assert strat._session_weight(22) == 0.0

    def test_no_signals_without_datetime_index(self):
        df = pd.DataFrame(
            {"open": [1.0] * 150, "high": [1.0] * 150, "low": [1.0] * 150,
             "close": [1.0] * 150, "volume": [1.0] * 150}
        )
        assert XauusdStrategy(min_confidence=0.0).scan(df) == []


class TestVwapFade:
    def test_stretched_price_fades_short(self):
        # stabilny dzien, potem pionowy rajd -> z-score > prog -> SHORT
        after = [2650.0] * 14 + np.linspace(2651, 2662, 6).tolist()
        found = scan(gold_day(after_asia=after), "session_vwap_fade")
        assert len(found) == 1
        assert found[0].direction == Direction.SHORT
        assert found[0].meta["zscore"] > 2.0


class TestIntegration:
    def test_detector_includes_xauusd_when_weighted(self):
        settings = Settings(strategy_weights={"xauusd": 1.4, "chart": 1.0})
        det = PatternDetector.from_settings(settings)
        assert "xauusd" in {s.name for s in det.strategies}

    def test_detector_excludes_without_weight(self):
        settings = Settings(strategy_weights={"chart": 1.0})
        det = PatternDetector.from_settings(settings)
        assert "xauusd" not in {s.name for s in det.strategies}

    def test_xauusd_preset_loads(self):
        from pathlib import Path
        from trading_bot.core.config import load_settings

        preset = Path(__file__).resolve().parent.parent / "config" / "settings_xauusd.yaml"
        cfg = load_settings(preset)
        assert cfg.symbols == ["XAU/USD"]
        assert cfg.strategy_weights["xauusd"] == 1.4
        assert cfg.risk.atr_stop_multiplier == 2.5
        assert cfg.timeframes[0] == "15m"

    def test_all_confidence_in_range(self):
        after = np.linspace(2650, 2657, 20).tolist()
        for sig in scan(gold_day(after_asia=after)):
            assert 0.0 <= sig.confidence <= 1.0
