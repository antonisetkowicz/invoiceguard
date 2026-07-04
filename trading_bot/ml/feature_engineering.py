"""Budowa cech z danych rynkowych dla modulow ML.

Przyklad:
    >>> from trading_bot.core.data_engine import generate_synthetic_ohlcv
    >>> from trading_bot.ml.feature_engineering import build_features
    >>> feats = build_features(generate_synthetic_ohlcv(300, seed=1))
    >>> set(feats.columns) >= {"adx", "hurst", "rv_percentile", "skew_30"}
    True
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from trading_bot.core.indicators import adx, atr, hurst_exponent, realized_volatility, rsi


def rolling_hurst(close: pd.Series, window: int = 100, max_lag: int = 20) -> pd.Series:
    """Wykladnik Hursta w oknie kroczacym (co bar, O(n*window))."""
    values = np.full(len(close), 0.5)
    arr = close.to_numpy(dtype=float)
    for i in range(window, len(arr)):
        values[i] = hurst_exponent(pd.Series(arr[i - window : i]), max_lag=max_lag)
    return pd.Series(values, index=close.index)


def build_features(df: pd.DataFrame, window: int = 30) -> pd.DataFrame:
    """Zwraca DataFrame cech wyrownany do indeksu OHLCV.

    Cechy (uzywane przez regime_detector):
        adx            - sila trendu (0-100),
        hurst          - momentum vs mean-reversion,
        rv_percentile  - percentyl realized volatility (0-1),
        skew_30        - skosnosc zwrotow 30-okresowa,
        ret_window     - zwrot skumulowany w oknie,
        atr_norm       - ATR znormalizowane cena,
        rsi            - RSI(14).
    """
    log_ret = np.log(df["close"] / df["close"].shift(1))
    rv = realized_volatility(df["close"], window)
    features = pd.DataFrame(index=df.index)
    features["adx"] = adx(df)
    features["hurst"] = rolling_hurst(df["close"], window=max(window * 3, 60))
    features["rv_percentile"] = rv.rolling(252, min_periods=window).rank(pct=True)
    features["skew_30"] = log_ret.rolling(window).skew()
    features["ret_window"] = df["close"].pct_change(window)
    features["atr_norm"] = atr(df) / df["close"]
    features["rsi"] = rsi(df["close"])
    return features


def latest_feature_vector(df: pd.DataFrame, window: int = 30) -> pd.Series:
    """Ostatni wektor cech liczony SZYBKA sciezka (bez rolling Hursta).

    Uzywana w petli backtestu/live, gdzie potrzebny jest wylacznie stan
    biezacy - rolling_hurst dla calej historii bylby O(n * window).
    """
    if len(df) < window + 2:
        raise ValueError("Za malo danych do policzenia cech")
    log_ret = np.log(df["close"] / df["close"].shift(1))
    rv = realized_volatility(df["close"], window).dropna()
    rv_pct = float((rv <= rv.iloc[-1]).mean()) if len(rv) else 0.5
    return pd.Series(
        {
            "adx": float(adx(df).iloc[-1]),
            "hurst": hurst_exponent(df["close"].tail(max(window * 3, 60))),
            "rv_percentile": rv_pct,
            "skew_30": float(log_ret.rolling(window).skew().iloc[-1]),
            "ret_window": float(df["close"].pct_change(window).iloc[-1]),
            "atr_norm": float((atr(df) / df["close"]).iloc[-1]),
            "rsi": float(rsi(df["close"]).iloc[-1]),
        }
    )
