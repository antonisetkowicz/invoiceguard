"""Mikrostruktura rynku: VWAP z-score, order flow imbalance, luki plynnosci,
wsparcia/opory z walidacja liczby dotkniec.

Order flow jest APROKSYMOWANY z OHLCV (brak danych tick): kierunek
przeplywu wyznaczany pozycja zamkniecia w zakresie swiecy (close location
value) wazona wolumenem.

Przyklad:
    >>> from trading_bot.core.data_engine import generate_synthetic_ohlcv
    >>> from trading_bot.strategies.microstructure import MicrostructureStrategy
    >>> strat = MicrostructureStrategy()
    >>> sig = strat.scan(generate_synthetic_ohlcv(300, seed=3),
    ...                  symbol="BTC/USDT", timeframe="1h")
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from trading_bot.core.indicators import rolling_vwap
from trading_bot.core.models import Direction, Signal, StrategyStyle
from trading_bot.strategies.base_strategy import BaseStrategy


class MicrostructureStrategy(BaseStrategy):
    """Sygnaly mean-reversion / breakout z mikrostruktury OHLCV."""

    name = "microstructure"
    style = StrategyStyle.MEAN_REVERSION
    min_bars = 100

    def __init__(
        self,
        min_confidence: float = 0.3,
        vwap_window: int = 50,
        vwap_zscore_entry: float = 2.0,
        imbalance_window: int = 20,
        sr_min_touches: int = 3,
        sr_tolerance: float = 0.005,
    ) -> None:
        super().__init__(min_confidence)
        self.vwap_window = vwap_window
        self.vwap_zscore_entry = vwap_zscore_entry
        self.imbalance_window = imbalance_window
        self.sr_min_touches = sr_min_touches
        self.sr_tolerance = sr_tolerance

    def detect(self, df: pd.DataFrame, symbol: str = "", timeframe: str = "") -> list[Signal]:
        signals: list[Signal] = []
        i = len(df) - 1
        for result in (
            self._vwap_deviation(df),
            self._order_flow_imbalance(df),
            self._liquidity_void(df),
            self._support_resistance(df),
        ):
            if result is None:
                continue
            pattern, direction, conf, meta = result
            signals.append(self.make_signal(pattern, direction, conf, symbol, timeframe, i, meta))
        return signals

    # ------------------------------------------------------------- VWAP
    def _vwap_deviation(self, df: pd.DataFrame) -> tuple | None:
        """Z-score odchylenia ceny od kroczacego VWAP; skrajne = mean reversion."""
        vw = rolling_vwap(df, self.vwap_window)
        dev = df["close"] - vw
        std = dev.rolling(self.vwap_window).std().iloc[-1]
        if not np.isfinite(std) or std == 0:
            return None
        z = float(dev.iloc[-1] / std)
        if abs(z) < self.vwap_zscore_entry:
            return None
        direction = Direction.SHORT if z > 0 else Direction.LONG  # powrot do VWAP
        conf = min(abs(z) / (self.vwap_zscore_entry * 2), 1.0)
        return "vwap_deviation", direction, conf, {"zscore": round(z, 3)}

    # ------------------------------------------------------ Order flow
    def _order_flow_imbalance(self, df: pd.DataFrame) -> tuple | None:
        """Aproksymacja przewagi kupujacych/sprzedajacych z OHLCV.

        CLV = ((C-L) - (H-C)) / (H-L) w [-1, 1]; imbalance = suma CLV*V
        w oknie / suma V. Wartosci skrajne wskazuja kierunek przeplywu.
        """
        window = df.iloc[-self.imbalance_window:]
        rng = (window["high"] - window["low"]).replace(0, np.nan)
        clv = ((window["close"] - window["low"]) - (window["high"] - window["close"])) / rng
        flow = (clv * window["volume"]).sum()
        total = window["volume"].sum()
        if total <= 0:
            return None
        imbalance = float(flow / total)  # [-1, 1]
        if abs(imbalance) < 0.3:
            return None
        direction = Direction.LONG if imbalance > 0 else Direction.SHORT
        conf = min(abs(imbalance) / 0.6, 1.0)
        return "order_flow_imbalance", direction, conf, {"imbalance": round(imbalance, 3)}

    # -------------------------------------------------- Liquidity void
    def _liquidity_void(self, df: pd.DataFrame) -> tuple | None:
        """Luka plynnosci: swieca o zakresie >3x ATR przy niskim wolumenie.

        Cena zwykle wraca wypelnic void -> sygnal przeciwny do swiecy void.
        """
        recent = df.iloc[-20:]
        rng = recent["high"] - recent["low"]
        avg_range = (df["high"] - df["low"]).iloc[-100:].mean()
        avg_vol = df["volume"].iloc[-100:].mean()
        if avg_range <= 0 or avg_vol <= 0:
            return None
        for offset in range(len(recent) - 1, max(len(recent) - 6, -1), -1):
            row = recent.iloc[offset]
            if rng.iloc[offset] > 3 * avg_range and row["volume"] < 0.7 * avg_vol:
                mid = (row["high"] + row["low"]) / 2
                price = float(df["close"].iloc[-1])
                direction = Direction.LONG if price < mid else Direction.SHORT
                conf = min(float(rng.iloc[offset] / (4 * avg_range)), 1.0) * 0.8
                return "liquidity_void", direction, conf, {"void_mid": float(mid)}
        return None

    # --------------------------------------------- Support / Resistance
    def _support_resistance(self, df: pd.DataFrame) -> tuple | None:
        """Poziomy S/R walidowane min. `sr_min_touches` dotknieciami.

        Sygnal: odbicie od zwalidowanego wsparcia (LONG) / oporu (SHORT)
        na ostatniej swiecy.
        """
        levels = self.find_levels(df)
        if not levels:
            return None
        last = df.iloc[-1]
        price = float(last["close"])
        for level, touches, kind in levels:
            near = abs(price - level) / level <= self.sr_tolerance * 2
            if not near:
                continue
            bounced_up = last["low"] <= level * (1 + self.sr_tolerance) and price > level
            bounced_down = last["high"] >= level * (1 - self.sr_tolerance) and price < level
            conf = min(0.3 + 0.15 * touches, 0.9)
            if kind == "support" and bounced_up:
                return "support_bounce", Direction.LONG, conf, {"level": level, "touches": touches}
            if kind == "resistance" and bounced_down:
                return "resistance_rejection", Direction.SHORT, conf, {"level": level, "touches": touches}
        return None

    def find_levels(self, df: pd.DataFrame) -> list[tuple[float, int, str]]:
        """Zwraca [(poziom, liczba_dotkniec, 'support'|'resistance'), ...].

        Poziom = klaster ekstremow swiec w odleglosci sr_tolerance; liczony
        na ostatnich 200 swiecach; wymaga >= sr_min_touches dotkniec.
        """
        window = df.iloc[-200:]
        levels: list[tuple[float, int, str]] = []
        price_now = float(window["close"].iloc[-1])
        for series, kind in ((window["low"], "support"), (window["high"], "resistance")):
            values = series.to_numpy(dtype=float)
            used = np.zeros(len(values), dtype=bool)
            for j in range(len(values)):
                if used[j]:
                    continue
                cluster = np.abs(values - values[j]) / values[j] <= self.sr_tolerance
                touches = int(cluster.sum())
                if touches >= self.sr_min_touches:
                    level = float(values[cluster].mean())
                    correct_side = level <= price_now if kind == "support" else level >= price_now
                    if correct_side:
                        levels.append((level, touches, kind))
                    used |= cluster
        return sorted(levels, key=lambda x: -x[1])
