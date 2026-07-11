"""Formacje swiecowe: Engulfing, Star, Hammer, Soldiers/Crows, Doji.

Confidence budowane z trzech skladnikow:
- jakosc geometrii swiecy (proporcje korpus/cien),
- potwierdzenie wolumenem (wolumen formacji vs srednia 20),
- kontekst trendu (formacja odwrocenia wymaga trendu do odwrocenia).

Przyklad:
    >>> from trading_bot.core.data_engine import generate_synthetic_ohlcv
    >>> from trading_bot.strategies.candlestick_patterns import CandlestickStrategy
    >>> strat = CandlestickStrategy()
    >>> signals = strat.scan(generate_synthetic_ohlcv(200, seed=7),
    ...                      symbol="BTC/USDT", timeframe="1h")
"""
from __future__ import annotations

import pandas as pd

from trading_bot.core.indicators import trend_direction
from trading_bot.core.models import Direction, Signal, StrategyStyle
from trading_bot.strategies.base_strategy import BaseStrategy

_EPS = 1e-12


def _body(row: pd.Series) -> float:
    return abs(row["close"] - row["open"])


def _range(row: pd.Series) -> float:
    return max(row["high"] - row["low"], _EPS)


def _upper_shadow(row: pd.Series) -> float:
    return row["high"] - max(row["open"], row["close"])


def _lower_shadow(row: pd.Series) -> float:
    return min(row["open"], row["close"]) - row["low"]


def _is_bull(row: pd.Series) -> bool:
    return bool(row["close"] > row["open"])


def _is_bear(row: pd.Series) -> bool:
    return bool(row["close"] < row["open"])


class CandlestickStrategy(BaseStrategy):
    """Detektor formacji swiecowych na ostatnich domknietych swiecach."""

    name = "candlestick"
    style = StrategyStyle.MEAN_REVERSION  # formacje odwrocenia
    min_bars = 30

    #: cialo < doji_body_max * zakresu -> doji
    doji_body_max: float = 0.1
    #: cien >= hammer_shadow_min * korpusu -> mlot / spadajaca gwiazda
    hammer_shadow_min: float = 2.0

    def detect(self, df: pd.DataFrame, symbol: str = "", timeframe: str = "") -> list[Signal]:
        i = len(df) - 1
        trend = trend_direction(df["close"].iloc[:i], lookback=20)
        vol_conf = self._volume_confirmation(df)
        checks = (
            self._engulfing,
            self._star,
            self._hammer_family,
            self._three_candles,
            self._doji,
        )
        signals: list[Signal] = []
        for check in checks:
            found = check(df, trend)
            for pattern, direction, geometry_conf, meta in found:
                confidence = 0.6 * geometry_conf + 0.4 * vol_conf
                signals.append(
                    self.make_signal(pattern, direction, confidence, symbol, timeframe, i, meta)
                )
        return signals

    # ------------------------------------------------------------ komponenty
    def _volume_confirmation(self, df: pd.DataFrame) -> float:
        """Wolumen ostatniej swiecy vs SMA20 -> [0, 1]."""
        avg = df["volume"].iloc[-21:-1].mean()
        if avg <= 0:
            return 0.5
        ratio = df["volume"].iloc[-1] / avg
        return float(min(1.0, ratio / 2.0))

    @staticmethod
    def _trend_bonus(direction: Direction, trend: Direction) -> float:
        """Formacja odwrocenia jest silniejsza przeciw istniejacemu trendowi."""
        if trend == Direction.HOLD:
            return 0.7
        return 1.0 if direction != trend else 0.5

    # -------------------------------------------------------------- formacje
    def _engulfing(self, df: pd.DataFrame, trend: Direction) -> list[tuple]:
        prev, cur = df.iloc[-2], df.iloc[-1]
        out: list[tuple] = []
        engulfs = (
            cur["open"] <= min(prev["open"], prev["close"])
            and cur["close"] >= max(prev["open"], prev["close"])
            or cur["open"] >= max(prev["open"], prev["close"])
            and cur["close"] <= min(prev["open"], prev["close"])
        )
        if not engulfs or _body(prev) < _EPS:
            return out
        size_ratio = min(_body(cur) / max(_body(prev), _EPS), 3.0) / 3.0
        if _is_bear(prev) and _is_bull(cur):
            conf = (0.5 + 0.5 * size_ratio) * self._trend_bonus(Direction.LONG, trend)
            out.append(("bullish_engulfing", Direction.LONG, conf, {"body_ratio": size_ratio}))
        elif _is_bull(prev) and _is_bear(cur):
            conf = (0.5 + 0.5 * size_ratio) * self._trend_bonus(Direction.SHORT, trend)
            out.append(("bearish_engulfing", Direction.SHORT, conf, {"body_ratio": size_ratio}))
        return out

    def _star(self, df: pd.DataFrame, trend: Direction) -> list[tuple]:
        """Morning Star / Evening Star (3 swiece)."""
        a, b, c = df.iloc[-3], df.iloc[-2], df.iloc[-1]
        out: list[tuple] = []
        small_middle = _body(b) <= 0.5 * min(_body(a), _body(c)) if min(_body(a), _body(c)) > _EPS else False
        if not small_middle:
            return out
        midpoint_a = (a["open"] + a["close"]) / 2
        if _is_bear(a) and _is_bull(c) and c["close"] > midpoint_a:
            depth = min((c["close"] - midpoint_a) / max(_body(a), _EPS), 1.0)
            conf = (0.6 + 0.4 * depth) * self._trend_bonus(Direction.LONG, trend)
            out.append(("morning_star", Direction.LONG, conf, {}))
        elif _is_bull(a) and _is_bear(c) and c["close"] < midpoint_a:
            depth = min((midpoint_a - c["close"]) / max(_body(a), _EPS), 1.0)
            conf = (0.6 + 0.4 * depth) * self._trend_bonus(Direction.SHORT, trend)
            out.append(("evening_star", Direction.SHORT, conf, {}))
        return out

    def _hammer_family(self, df: pd.DataFrame, trend: Direction) -> list[tuple]:
        """Hammer / Hanging Man / Shooting Star - jedna swieca + kontekst."""
        cur = df.iloc[-1]
        body = _body(cur)
        if body < _EPS:
            return []
        out: list[tuple] = []
        long_lower = _lower_shadow(cur) >= self.hammer_shadow_min * body
        long_upper = _upper_shadow(cur) >= self.hammer_shadow_min * body
        small_opposite_lower = _upper_shadow(cur) <= body
        small_opposite_upper = _lower_shadow(cur) <= body
        shadow_quality_lo = min(_lower_shadow(cur) / (self.hammer_shadow_min * body), 2.0) / 2.0
        shadow_quality_up = min(_upper_shadow(cur) / (self.hammer_shadow_min * body), 2.0) / 2.0
        if long_lower and small_opposite_lower:
            if trend == Direction.SHORT:      # po spadkach -> hammer (bullish)
                out.append(("hammer", Direction.LONG, 0.5 + 0.5 * shadow_quality_lo, {}))
            elif trend == Direction.LONG:     # po wzrostach -> hanging man (bearish)
                out.append(("hanging_man", Direction.SHORT, 0.4 + 0.4 * shadow_quality_lo, {}))
        if long_upper and small_opposite_upper and trend == Direction.LONG:
            out.append(("shooting_star", Direction.SHORT, 0.5 + 0.5 * shadow_quality_up, {}))
        return out

    def _three_candles(self, df: pd.DataFrame, trend: Direction) -> list[tuple]:
        """Three White Soldiers / Three Black Crows."""
        rows = [df.iloc[-3], df.iloc[-2], df.iloc[-1]]
        out: list[tuple] = []
        solid = all(_body(r) >= 0.5 * _range(r) for r in rows)
        if not solid:
            return out
        if all(_is_bull(r) for r in rows) and rows[0]["close"] < rows[1]["close"] < rows[2]["close"]:
            conf = 0.7 * self._trend_bonus(Direction.LONG, trend) + 0.3
            out.append(("three_white_soldiers", Direction.LONG, conf, {}))
        elif all(_is_bear(r) for r in rows) and rows[0]["close"] > rows[1]["close"] > rows[2]["close"]:
            conf = 0.7 * self._trend_bonus(Direction.SHORT, trend) + 0.3
            out.append(("three_black_crows", Direction.SHORT, conf, {}))
        return out

    def _doji(self, df: pd.DataFrame, trend: Direction) -> list[tuple]:
        """Doji: standard (neutralne), dragonfly (bullish), gravestone (bearish)."""
        cur = df.iloc[-1]
        rng = _range(cur)
        if _body(cur) > self.doji_body_max * rng:
            return []
        upper, lower = _upper_shadow(cur), _lower_shadow(cur)
        if lower >= 0.6 * rng and upper <= 0.15 * rng:
            conf = 0.5 + 0.3 * self._trend_bonus(Direction.LONG, trend)
            return [("dragonfly_doji", Direction.LONG, conf, {})]
        if upper >= 0.6 * rng and lower <= 0.15 * rng:
            conf = 0.5 + 0.3 * self._trend_bonus(Direction.SHORT, trend)
            return [("gravestone_doji", Direction.SHORT, conf, {})]
        return [("doji", Direction.HOLD, 0.4, {})]
