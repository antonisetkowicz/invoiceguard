"""Testy silnika danych: gap fill, resample, align, cache Parquet."""
from __future__ import annotations

import pandas as pd
import pytest

from trading_bot.core.config import DataConfig
from trading_bot.core.data_engine import (
    DataEngine,
    align_timeframes,
    fill_gaps,
    generate_synthetic_ohlcv,
    resample_ohlcv,
)


class TestGapFill:
    def test_fills_missing_bars(self):
        df = generate_synthetic_ohlcv(bars=50, seed=1)
        holey = df.drop(df.index[10:15])
        fixed = fill_gaps(holey, "1h")
        assert len(fixed) == 50
        assert not fixed["close"].isna().any()
        # luka wypelniona poprzednim close, wolumen zerowy
        assert (fixed["volume"].iloc[10:15] == 0).all()
        assert (fixed["close"].iloc[10:15] == df["close"].iloc[9]).all()

    def test_no_change_when_complete(self):
        df = generate_synthetic_ohlcv(bars=30, seed=2)
        assert fill_gaps(df, "1h").equals(df)


class TestResample:
    def test_1h_to_4h(self):
        df = generate_synthetic_ohlcv(bars=48, seed=3)
        out = resample_ohlcv(df, "4h")
        assert len(out) == 12
        assert out["high"].iloc[0] == df["high"].iloc[:4].max()
        assert out["volume"].iloc[0] == pytest.approx(df["volume"].iloc[:4].sum())
        assert out["open"].iloc[0] == df["open"].iloc[0]
        assert out["close"].iloc[0] == df["close"].iloc[3]


class TestAlign:
    def test_common_range(self):
        a = generate_synthetic_ohlcv(bars=100, seed=1, start="2024-01-01")
        b = generate_synthetic_ohlcv(bars=100, seed=1, start="2024-01-02")
        aligned = align_timeframes({"a": a, "b": b})
        assert aligned["a"].index[0] == aligned["b"].index[0]
        assert aligned["a"].index[-1] == aligned["b"].index[-1]


class TestDataEngineCache:
    def test_fetch_and_cache(self, tmp_path):
        calls = {"n": 0}

        def fetcher(symbol: str, timeframe: str, bars: int) -> pd.DataFrame:
            calls["n"] += 1
            return generate_synthetic_ohlcv(bars=bars, seed=9)

        engine = DataEngine(DataConfig(cache_dir=str(tmp_path)), fetcher=fetcher)
        df1 = engine.get_ohlcv("BTC/USDT", "1h", bars=100)
        df2 = engine.get_ohlcv("BTC/USDT", "1h", bars=100)  # z cache
        assert calls["n"] == 1
        assert len(df1) == len(df2) == 100
        assert (tmp_path / "binance_BTC-USDT_1h.parquet").exists()

    def test_get_multi_parallel(self, tmp_path):
        def fetcher(symbol: str, timeframe: str, bars: int) -> pd.DataFrame:
            return generate_synthetic_ohlcv(bars=bars, seed=hash(symbol + timeframe) % 100)

        engine = DataEngine(DataConfig(cache_dir=str(tmp_path), max_workers=4), fetcher=fetcher)
        result = engine.get_multi(["BTC/USDT", "ETH/USDT"], ["1h", "4h"], bars=200)
        assert set(result) == {"BTC/USDT", "ETH/USDT"}
        for sym in result:
            assert set(result[sym]) == {"1h", "4h"}
