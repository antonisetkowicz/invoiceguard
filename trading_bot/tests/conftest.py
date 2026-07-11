"""Wspolne fixtures testow."""
from __future__ import annotations

import sys

import numpy as np
import pandas as pd
import pytest
from loguru import logger

# logi DEBUG/INFO zalewaja output i spowalniaja petle backtestu
logger.remove()
logger.add(sys.stderr, level="WARNING")


def make_df(prices: list[float], volumes: list[float] | None = None) -> pd.DataFrame:
    """OHLCV z listy cen zamkniecia (swiece 'pelne', open=poprzedni close)."""
    closes = np.asarray(prices, dtype=float)
    opens = np.concatenate([[closes[0]], closes[:-1]])
    highs = np.maximum(opens, closes) * 1.001
    lows = np.minimum(opens, closes) * 0.999
    vols = np.asarray(volumes, dtype=float) if volumes else np.full(len(closes), 100.0)
    index = pd.date_range("2024-01-01", periods=len(closes), freq="1h", tz="UTC")
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes, "volume": vols},
        index=index,
    )


def make_ohlc(rows: list[tuple[float, float, float, float]],
              volumes: list[float] | None = None) -> pd.DataFrame:
    """OHLCV z jawnych krotek (open, high, low, close)."""
    arr = np.asarray(rows, dtype=float)
    vols = np.asarray(volumes, dtype=float) if volumes else np.full(len(arr), 100.0)
    index = pd.date_range("2024-01-01", periods=len(arr), freq="1h", tz="UTC")
    return pd.DataFrame(
        {"open": arr[:, 0], "high": arr[:, 1], "low": arr[:, 2],
         "close": arr[:, 3], "volume": vols},
        index=index,
    )


@pytest.fixture
def synthetic_df() -> pd.DataFrame:
    from trading_bot.core.data_engine import generate_synthetic_ohlcv

    return generate_synthetic_ohlcv(bars=400, seed=42)
