"""Formacje klasyczne: H&S, trojkaty, flagi, prostokaty, podwojne szczyty/dna.

Wszystkie formacje budowane na potwierdzonych pivotach (core.indicators
.find_pivots). Sygnal emitowany dopiero po PRZEBICIU poziomu aktywacji
(neckline / linia trendu / granica prostokata) - nie na samym ksztalcie.

Przyklad:
    >>> from trading_bot.strategies.chart_patterns import ChartPatternStrategy
    >>> strat = ChartPatternStrategy(pivot_window=3)
    >>> strat.name
    'chart'
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from trading_bot.core.indicators import Pivot, find_pivots
from trading_bot.core.models import Direction, Signal, StrategyStyle
from trading_bot.strategies.base_strategy import BaseStrategy


class ChartPatternStrategy(BaseStrategy):
    """Detektor klasycznych formacji cenowych."""

    name = "chart"
    style = StrategyStyle.TREND_FOLLOWING
    min_bars = 60

    def __init__(
        self,
        min_confidence: float = 0.3,
        pivot_window: int = 5,
        tolerance: float = 0.03,
        max_signal_age_bars: int = 5,
    ) -> None:
        super().__init__(min_confidence)
        self.pivot_window = pivot_window
        #: tolerancja rownosci poziomow (ramiona H&S, podwojne szczyty)
        self.tolerance = tolerance
        self.max_signal_age_bars = max_signal_age_bars

    def detect(self, df: pd.DataFrame, symbol: str = "", timeframe: str = "") -> list[Signal]:
        pivots = find_pivots(df, window=self.pivot_window)
        signals: list[Signal] = []
        for finder in (
            self._head_and_shoulders,
            self._double_top_bottom,
            self._triangle,
            self._rectangle,
            self._flag_pennant,
        ):
            signals.extend(finder(df, pivots, symbol, timeframe))
        return signals

    # ------------------------------------------------------ Head & Shoulders
    def _head_and_shoulders(
        self, df: pd.DataFrame, pivots: list[Pivot], symbol: str, timeframe: str
    ) -> list[Signal]:
        """H&S: ramie-glowa-ramie + 2 dolki necklina; sygnal po przebiciu.

        Wersja odwrocona (inverse) analogicznie na dolkach.
        """
        signals: list[Signal] = []
        if len(pivots) < 5:
            return signals
        last_close = float(df["close"].iloc[-1])
        i = len(df) - 1
        for start in range(len(pivots) - 5, -1, -1):
            window = pivots[start : start + 5]
            if len(window) < 5:
                continue
            kinds = [p.kind for p in window]
            if kinds == ["high", "low", "high", "low", "high"]:
                ls, t1, head, t2, rs = window
                if not (head.price > ls.price and head.price > rs.price):
                    continue
                if abs(ls.price - rs.price) / head.price > self.tolerance:
                    continue  # ramiona musza byc zblizone
                neckline = self._neckline_at(t1, t2, i)
                if last_close < neckline:  # przebicie w dol
                    conf = self._hs_confidence(df, window, neckline, head.price, bearish=True)
                    signals.append(
                        self.make_signal(
                            "head_and_shoulders", Direction.SHORT, conf, symbol, timeframe, i,
                            meta={"neckline": neckline,
                                  "target": neckline - (head.price - neckline)},
                        )
                    )
                    break
            elif kinds == ["low", "high", "low", "high", "low"]:
                ls, p1, head, p2, rs = window
                if not (head.price < ls.price and head.price < rs.price):
                    continue
                if abs(ls.price - rs.price) / max(abs(head.price), 1e-12) > self.tolerance:
                    continue
                neckline = self._neckline_at(p1, p2, i)
                if last_close > neckline:  # przebicie w gore
                    conf = self._hs_confidence(df, window, neckline, head.price, bearish=False)
                    signals.append(
                        self.make_signal(
                            "inverse_head_and_shoulders", Direction.LONG, conf, symbol, timeframe, i,
                            meta={"neckline": neckline,
                                  "target": neckline + (neckline - head.price)},
                        )
                    )
                    break
        return signals

    @staticmethod
    def _neckline_at(p1: Pivot, p2: Pivot, at_index: int) -> float:
        """Ekstrapolacja linii szyi (przez 2 dolki/szczyty) do danej swiecy."""
        if p2.index == p1.index:
            return p2.price
        slope = (p2.price - p1.price) / (p2.index - p1.index)
        return p2.price + slope * (at_index - p2.index)

    def _hs_confidence(
        self, df: pd.DataFrame, window: list[Pivot], neckline: float, head: float, bearish: bool
    ) -> float:
        """Confidence H&S: symetria ramion + wolumen malejacy na prawym ramieniu."""
        ls, _, _, _, rs = window
        symmetry = 1.0 - min(abs(ls.price - rs.price) / max(abs(head - neckline), 1e-12), 1.0)
        vol_left = df["volume"].iloc[ls.index : window[2].index + 1].mean()
        vol_right = df["volume"].iloc[window[2].index : rs.index + 1].mean()
        vol_q = 1.0 if vol_right < vol_left else 0.5  # klasyka: slabnacy wolumen
        depth = min(abs(head - neckline) / max(neckline, 1e-12) / 0.05, 1.0)
        return 0.4 * symmetry + 0.3 * vol_q + 0.3 * depth

    # ------------------------------------------------------- Double top/bottom
    def _double_top_bottom(
        self, df: pd.DataFrame, pivots: list[Pivot], symbol: str, timeframe: str
    ) -> list[Signal]:
        signals: list[Signal] = []
        if len(pivots) < 3:
            return signals
        a, mid, b = pivots[-3], pivots[-2], pivots[-1]
        last_close = float(df["close"].iloc[-1])
        i = len(df) - 1
        equal = abs(a.price - b.price) / max(abs(a.price), 1e-12) <= self.tolerance
        if not equal:
            return signals
        if a.kind == "high" == b.kind and last_close < mid.price:
            conf = 0.5 + 0.5 * (1 - abs(a.price - b.price) / (a.price * self.tolerance))
            signals.append(
                self.make_signal("double_top", Direction.SHORT, conf, symbol, timeframe, i,
                                 meta={"neckline": mid.price}))
        elif a.kind == "low" == b.kind and last_close > mid.price:
            conf = 0.5 + 0.5 * (1 - abs(a.price - b.price) / (abs(a.price) * self.tolerance))
            signals.append(
                self.make_signal("double_bottom", Direction.LONG, conf, symbol, timeframe, i,
                                 meta={"neckline": mid.price}))
        return signals

    # ------------------------------------------------------------- Triangles
    def _triangle(
        self, df: pd.DataFrame, pivots: list[Pivot], symbol: str, timeframe: str
    ) -> list[Signal]:
        """Trojkaty na 2+2 ostatnich pivotach (highs/lows) + przebicie."""
        highs = [p for p in pivots if p.kind == "high"][-3:]
        lows = [p for p in pivots if p.kind == "low"][-3:]
        if len(highs) < 2 or len(lows) < 2:
            return []
        hi_slope = self._slope(highs)
        lo_slope = self._slope(lows)
        price = float(df["close"].iloc[-1])
        scale = price * 0.001  # nachylenie "plaskie" gdy < 0.1% ceny na swiece
        i = len(df) - 1
        upper_now = highs[-1].price + hi_slope * (i - highs[-1].index)
        lower_now = lows[-1].price + lo_slope * (i - lows[-1].index)

        kind: str | None = None
        if abs(hi_slope) < scale and lo_slope > scale:
            kind = "ascending_triangle"
        elif abs(lo_slope) < scale and hi_slope < -scale:
            kind = "descending_triangle"
        elif hi_slope < -scale and lo_slope > scale:
            kind = "symmetrical_triangle"
        if kind is None:
            return []

        span: float = max(abs(highs[0].price - lows[0].price), 1e-12)
        converge = 1.0 - min(abs(upper_now - lower_now) / span, 1.0)
        if price > upper_now:
            return [self.make_signal(kind, Direction.LONG, 0.4 + 0.6 * converge,
                                     symbol, timeframe, i, meta={"breakout": upper_now})]
        if price < lower_now:
            return [self.make_signal(kind, Direction.SHORT, 0.4 + 0.6 * converge,
                                     symbol, timeframe, i, meta={"breakout": lower_now})]
        return []

    @staticmethod
    def _slope(pts: list[Pivot]) -> float:
        xs = np.array([p.index for p in pts], dtype=float)
        ys = np.array([p.price for p in pts], dtype=float)
        if len(xs) < 2 or xs[-1] == xs[0]:
            return 0.0
        return float(np.polyfit(xs, ys, 1)[0])

    # ------------------------------------------------------------ Rectangle
    def _rectangle(
        self, df: pd.DataFrame, pivots: list[Pivot], symbol: str, timeframe: str
    ) -> list[Signal]:
        """Range: >=2 szczyty i >=2 dolki na zblizonych poziomach."""
        highs = [p for p in pivots if p.kind == "high"][-3:]
        lows = [p for p in pivots if p.kind == "low"][-3:]
        if len(highs) < 2 or len(lows) < 2:
            return []
        top = float(np.mean([p.price for p in highs]))
        bottom = float(np.mean([p.price for p in lows]))
        flat_top = all(abs(p.price - top) / top <= self.tolerance for p in highs)
        flat_bottom = all(abs(p.price - bottom) / max(bottom, 1e-12) <= self.tolerance for p in lows)
        if not (flat_top and flat_bottom) or top <= bottom:
            return []
        price = float(df["close"].iloc[-1])
        i = len(df) - 1
        touches = len(highs) + len(lows)
        conf = 0.4 + 0.1 * min(touches, 6)
        if price > top * (1 + self.tolerance / 2):
            return [self.make_signal("rectangle_breakout", Direction.LONG, conf,
                                     symbol, timeframe, i, meta={"top": top, "bottom": bottom})]
        if price < bottom * (1 - self.tolerance / 2):
            return [self.make_signal("rectangle_breakdown", Direction.SHORT, conf,
                                     symbol, timeframe, i, meta={"top": top, "bottom": bottom})]
        return []

    # ---------------------------------------------------------- Flag/Pennant
    def _flag_pennant(
        self, df: pd.DataFrame, pivots: list[Pivot], symbol: str, timeframe: str
    ) -> list[Signal]:
        """Flaga: silny impuls (maszt) + plytka konsolidacja pod prad + wybicie."""
        if len(df) < 40:
            return []
        pole = df["close"].iloc[-30:-10]
        flag = df["close"].iloc[-10:]
        pole_ret = (pole.iloc[-1] - pole.iloc[0]) / pole.iloc[0]
        flag_ret = (flag.iloc[-1] - flag.iloc[0]) / flag.iloc[0]
        flag_range = (flag.max() - flag.min()) / flag.mean()
        pole_strength = abs(pole_ret)
        if pole_strength < 0.05 or flag_range > pole_strength * 0.5:
            return []
        i = len(df) - 1
        price = float(df["close"].iloc[-1])
        tight = 1.0 - min(flag_range / (pole_strength * 0.5), 1.0)
        conf = 0.4 + 0.6 * tight
        name = "flag" if flag_range > pole_strength * 0.2 else "pennant"
        # wybicie w kierunku masztu ponad zakres konsolidacji
        if pole_ret > 0 and -0.02 <= flag_ret <= 0.01 and price >= flag.iloc[:-1].max():
            return [self.make_signal(name, Direction.LONG, conf, symbol, timeframe, i,
                                     meta={"pole_return": round(float(pole_ret), 4)})]
        if pole_ret < 0 and -0.01 <= flag_ret <= 0.02 and price <= flag.iloc[:-1].min():
            return [self.make_signal(name, Direction.SHORT, conf, symbol, timeframe, i,
                                     meta={"pole_return": round(float(pole_ret), 4)})]
        return []
