"""Formacje harmoniczne: Gartley, Bat, Butterfly, Crab, AB=CD.

Kazda formacja opisana tabela idealnych poziomow Fibonacciego z tolerancja
+-2% (config: patterns.fib_tolerance). Wzorce budowane sa na 5 naprzemiennych
pivotach X-A-B-C-D (AB=CD na 4: A-B-C-D).

Confidence sklada sie z:
- precyzji dopasowania ratio (im blizej idealu, tym wyzej),
- potwierdzenia wolumenem (spadek wolumenu w fali CD + wzrost na D),
- dywergencji RSI miedzy B i D,
- proporcji CZASOWEJ fal (fale nie moga byc skrajnie asymetryczne).

Przyklad:
    >>> from trading_bot.strategies.harmonic_patterns import HarmonicStrategy
    >>> strat = HarmonicStrategy(fib_tolerance=0.02)
    >>> strat.patterns["gartley"].d_ratios
    (0.786,)
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from trading_bot.core.indicators import Pivot, find_pivots, rsi
from trading_bot.core.models import Direction, Signal, StrategyStyle
from trading_bot.strategies.base_strategy import BaseStrategy


@dataclass(frozen=True, slots=True)
class HarmonicSpec:
    """Idealne poziomy Fibonacciego formacji harmonicznej.

    b_ratios / d_ratios: dopuszczalne wartosci retracementu (lub ekstensji)
    fali XA; c_range: zakres retracementu AB dla punktu C.
    """

    name: str
    b_ratios: tuple[float, ...]
    d_ratios: tuple[float, ...]
    c_range: tuple[float, float] = (0.382, 0.886)


PATTERN_SPECS: dict[str, HarmonicSpec] = {
    "gartley": HarmonicSpec("gartley", b_ratios=(0.618,), d_ratios=(0.786,)),
    "bat": HarmonicSpec("bat", b_ratios=(0.382, 0.500), d_ratios=(0.886,)),
    "butterfly": HarmonicSpec("butterfly", b_ratios=(0.786,), d_ratios=(1.272, 1.618)),
    "crab": HarmonicSpec("crab", b_ratios=(0.382, 0.618), d_ratios=(1.618,)),
}


def _ratio_match(actual: float, ideals: tuple[float, ...], tolerance: float) -> float:
    """Zwraca jakosc dopasowania [0,1]; 0 gdy poza tolerancja.

    Tolerancja jest wzgledna (+-2% wartosci poziomu Fibonacciego).
    """
    best = 0.0
    for ideal in ideals:
        err = abs(actual - ideal) / ideal
        if err <= tolerance:
            best = max(best, 1.0 - err / tolerance)
    return best


class HarmonicStrategy(BaseStrategy):
    """Detektor formacji harmonicznych na potwierdzonych pivotach."""

    name = "harmonic"
    style = StrategyStyle.MEAN_REVERSION  # gra na odwrocenie w strefie PRZ
    min_bars = 60

    def __init__(
        self,
        min_confidence: float = 0.3,
        fib_tolerance: float = 0.02,
        pivot_window: int = 5,
        max_signal_age_bars: int = 15,
    ) -> None:
        super().__init__(min_confidence)
        self.fib_tolerance = fib_tolerance
        self.pivot_window = pivot_window
        #: jak stary moze byc pivot D, by sygnal byl aktualny
        self.max_signal_age_bars = max_signal_age_bars
        self.patterns = PATTERN_SPECS

    def detect(self, df: pd.DataFrame, symbol: str = "", timeframe: str = "") -> list[Signal]:
        pivots = find_pivots(df, window=self.pivot_window)
        signals: list[Signal] = []
        if len(pivots) >= 5:
            signals.extend(self._match_xabcd(df, pivots[-5:], symbol, timeframe))
        if len(pivots) >= 4:
            signals.extend(self._match_abcd(df, pivots[-4:], symbol, timeframe))
        return signals

    # ----------------------------------------------------------- XABCD
    def _match_xabcd(
        self, df: pd.DataFrame, pts: list[Pivot], symbol: str, timeframe: str
    ) -> list[Signal]:
        x, a, b, c, d = pts
        if not self._alternating(pts) or self._too_old(df, d):
            return []
        # bullish: X=low A=high B=low C=high D=low; bearish odwrotnie
        if x.kind == "low":
            direction = Direction.LONG
        else:
            direction = Direction.SHORT

        xa = abs(a.price - x.price)
        ab = abs(b.price - a.price)
        cd = abs(d.price - c.price)
        if xa <= 0 or ab <= 0:
            return []

        b_ratio = ab / xa                       # retracement B fali XA
        d_ratio = abs(a.price - d.price) / xa   # retracement/ekstensja D
        c_ratio = abs(c.price - b.price) / ab   # retracement C fali AB

        signals: list[Signal] = []
        for spec in self.patterns.values():
            qb = _ratio_match(b_ratio, spec.b_ratios, self.fib_tolerance)
            qd = _ratio_match(d_ratio, spec.d_ratios, self.fib_tolerance)
            if qb == 0.0 or qd == 0.0:
                continue
            if not spec.c_range[0] * (1 - self.fib_tolerance) <= c_ratio <= spec.c_range[1] * (1 + self.fib_tolerance):
                continue
            time_q = self._time_symmetry(pts)
            if time_q == 0.0:
                continue
            ratio_q = (qb + qd) / 2.0
            vol_q = self._volume_score(df, c.index, d.index)
            div_q = self._divergence_score(df, b, d, direction)
            confidence = 0.4 * ratio_q + 0.2 * vol_q + 0.2 * div_q + 0.2 * time_q
            signals.append(
                self.make_signal(
                    spec.name,
                    direction,
                    confidence,
                    symbol,
                    timeframe,
                    len(df) - 1,
                    meta={
                        "points": {p: (pt.index, pt.price) for p, pt in zip("XABCD", pts)},
                        "b_ratio": round(b_ratio, 4),
                        "d_ratio": round(d_ratio, 4),
                        "c_ratio": round(c_ratio, 4),
                        "prz": d.price,
                    },
                )
            )
        return signals

    # ----------------------------------------------------------- AB=CD
    def _match_abcd(
        self, df: pd.DataFrame, pts: list[Pivot], symbol: str, timeframe: str
    ) -> list[Signal]:
        a, b, c, d = pts
        if not self._alternating(pts) or self._too_old(df, d):
            return []
        ab = abs(b.price - a.price)
        cd = abs(d.price - c.price)
        bc = abs(c.price - b.price)
        if ab <= 0 or bc <= 0:
            return []
        # klasyczne AB=CD: CD ~= AB (cena) oraz retracement C w 0.382-0.886
        price_q = _ratio_match(cd / ab, (1.0,), self.fib_tolerance * 2)
        c_ratio = bc / ab
        if price_q == 0.0 or not 0.382 * 0.98 <= c_ratio <= 0.886 * 1.02:
            return []
        # proporcja czasowa: czas CD ~= czas AB
        t_ab = max(b.index - a.index, 1)
        t_cd = max(d.index - c.index, 1)
        time_q = max(0.0, 1.0 - abs(t_cd - t_ab) / max(t_ab, t_cd))
        if time_q < 0.3:
            return []
        direction = Direction.LONG if d.kind == "low" else Direction.SHORT
        vol_q = self._volume_score(df, c.index, d.index)
        confidence = 0.5 * price_q + 0.25 * time_q + 0.25 * vol_q
        return [
            self.make_signal(
                "abcd",
                direction,
                confidence,
                symbol,
                timeframe,
                len(df) - 1,
                meta={"points": {p: (pt.index, pt.price) for p, pt in zip("ABCD", pts)}},
            )
        ]

    # ------------------------------------------------------------- helpers
    @staticmethod
    def _alternating(pts: list[Pivot]) -> bool:
        return all(pts[i].kind != pts[i + 1].kind for i in range(len(pts) - 1))

    def _too_old(self, df: pd.DataFrame, d: Pivot) -> bool:
        return (len(df) - 1 - d.index) > self.max_signal_age_bars

    @staticmethod
    def _time_symmetry(pts: list[Pivot]) -> float:
        """Walidacja proporcji czasowej fal: zadna fala nie moze byc
        krotsza niz 1/4 ani dluzsza niz 4x sasiedniej fali."""
        durations = [max(pts[i + 1].index - pts[i].index, 1) for i in range(len(pts) - 1)]
        score = 1.0
        for prev, cur in zip(durations, durations[1:]):
            ratio = cur / prev
            if ratio < 0.25 or ratio > 4.0:
                return 0.0
            score *= 1.0 - abs(np.log(ratio)) / np.log(16)  # 1.0 przy rownych falach
        return float(max(0.0, score))

    @staticmethod
    def _volume_score(df: pd.DataFrame, c_idx: int, d_idx: int) -> float:
        """Malejacy wolumen w fali CD i wzrost na D = klasyczne potwierdzenie."""
        if d_idx <= c_idx:
            return 0.5
        wave = df["volume"].iloc[c_idx : d_idx + 1]
        if len(wave) < 2 or wave.mean() <= 0:
            return 0.5
        declining = 1.0 if wave.iloc[:-1].mean() >= wave.iloc[-1] * 0.5 else 0.5
        spike = min(wave.iloc[-1] / wave.mean(), 2.0) / 2.0
        return float(0.5 * declining + 0.5 * spike)

    @staticmethod
    def _divergence_score(df: pd.DataFrame, b: Pivot, d: Pivot, direction: Direction) -> float:
        """Dywergencja RSI miedzy pivotami B i D (tego samego typu)."""
        r = rsi(df["close"])
        rsi_b, rsi_d = float(r.iloc[b.index]), float(r.iloc[d.index])
        if direction == Direction.LONG:
            # cena robi nizsze/rowne minimum, RSI wyzsze -> dywergencja bycza
            diverges = d.price <= b.price and rsi_d > rsi_b
        else:
            diverges = d.price >= b.price and rsi_d < rsi_b
        return 1.0 if diverges else 0.4
