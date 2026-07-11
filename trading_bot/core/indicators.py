"""Wskazniki techniczne i detekcja pivotow (swing high/low).

Wszystkie funkcje sa wektorowe (pandas/numpy) i bezstanowe.

Przyklad:
    >>> import pandas as pd
    >>> from trading_bot.core.indicators import atr
    >>> df = pd.DataFrame({"high": [2, 3], "low": [1, 2], "close": [1.5, 2.5]})
    >>> atr(df, period=1).iloc[-1]
    1.5
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from trading_bot.core.models import Direction

OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]


def true_range(df: pd.DataFrame) -> pd.Series:
    """True Range: max(H-L, |H-C1|, |L-C1|)."""
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average True Range (Wilder EMA)."""
    return true_range(df).ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()


def adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average Directional Index - sila trendu (0-100)."""
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=df.index)
    tr_smooth = true_range(df).ewm(alpha=1.0 / period, adjust=False).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1.0 / period, adjust=False).mean() / tr_smooth
    minus_di = 100 * minus_dm.ewm(alpha=1.0 / period, adjust=False).mean() / tr_smooth
    denom = (plus_di + minus_di).replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / denom
    return dx.ewm(alpha=1.0 / period, adjust=False).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder)."""
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1.0 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1.0 / period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50.0)


def vwap(df: pd.DataFrame) -> pd.Series:
    """Volume Weighted Average Price (kumulatywny w ramach przekazanych danych)."""
    typical = (df["high"] + df["low"] + df["close"]) / 3.0
    cum_vol = df["volume"].cumsum().replace(0, np.nan)
    return (typical * df["volume"]).cumsum() / cum_vol


def rolling_vwap(df: pd.DataFrame, window: int = 20) -> pd.Series:
    """VWAP w oknie kroczacym."""
    typical = (df["high"] + df["low"] + df["close"]) / 3.0
    pv = (typical * df["volume"]).rolling(window).sum()
    v = df["volume"].rolling(window).sum().replace(0, np.nan)
    return pv / v


def realized_volatility(close: pd.Series, window: int = 30) -> pd.Series:
    """Odchylenie standardowe log-zwrotow w oknie (annualizacja pominieta)."""
    log_ret = np.log(close / close.shift(1))
    return log_ret.rolling(window).std()


def hurst_exponent(close: pd.Series, max_lag: int = 20) -> float:
    """Wykladnik Hursta metoda zmiennosci lagowanej.

    ~0.5 = random walk, >0.5 = momentum, <0.5 = mean reversion.
    """
    prices = np.asarray(close.dropna(), dtype=float)
    if len(prices) < max_lag * 2:
        return 0.5
    lags = range(2, max_lag)
    tau = np.maximum(
        [np.std(prices[lag:] - prices[:-lag]) for lag in lags], 1e-12
    )
    slope = np.polyfit(np.log(list(lags)), np.log(tau), 1)[0]
    return float(np.clip(slope, 0.0, 1.0))


@dataclass(slots=True)
class Pivot:
    """Punkt zwrotny (swing high/low)."""

    index: int          # pozycja w DataFrame (iloc)
    price: float
    kind: str           # "high" | "low"


def find_pivots(df: pd.DataFrame, window: int = 5) -> list[Pivot]:
    """Znajduje naprzemienne pivoty (zigzag) metoda okna lokalnego ekstremum.

    Swieca `i` jest swing high, gdy jej high jest najwyzszy w oknie
    [i-window, i+window]; analogicznie swing low. Kolejne pivoty tego
    samego typu sa scalane (zostaje bardziej ekstremalny), aby uzyskac
    naprzemienna sekwencje high/low wymagana przez formacje.

    Przyklad:
        >>> import pandas as pd, numpy as np
        >>> prices = [1, 2, 3, 2, 1, 2, 3, 4, 3, 2]
        >>> df = pd.DataFrame({"high": prices, "low": prices,
        ...                    "open": prices, "close": prices,
        ...                    "volume": [1] * 10})
        >>> [p.kind for p in find_pivots(df, window=2)]
        ['high', 'low', 'high']
    """
    highs = df["high"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    n = len(df)
    raw: list[Pivot] = []
    for i in range(window, n - window):
        lo_win = slice(i - window, i + window + 1)
        if highs[i] >= highs[lo_win].max():
            raw.append(Pivot(index=i, price=highs[i], kind="high"))
        elif lows[i] <= lows[lo_win].min():
            raw.append(Pivot(index=i, price=lows[i], kind="low"))

    merged: list[Pivot] = []
    for piv in raw:
        if merged and merged[-1].kind == piv.kind:
            last = merged[-1]
            better = (piv.price >= last.price) if piv.kind == "high" else (piv.price <= last.price)
            if better:
                merged[-1] = piv
        else:
            merged.append(piv)
    return merged


def trend_direction(close: pd.Series, lookback: int = 20) -> Direction:
    """Prosty kontekst trendu: nachylenie regresji liniowej ceny."""
    y = close.tail(lookback).to_numpy(dtype=float)
    if len(y) < 3:
        return Direction.HOLD
    x = np.arange(len(y), dtype=float)
    slope = np.polyfit(x, y, 1)[0]
    threshold = np.std(y) / max(len(y), 1) * 0.5
    if slope > threshold:
        return Direction.LONG
    if slope < -threshold:
        return Direction.SHORT
    return Direction.HOLD
