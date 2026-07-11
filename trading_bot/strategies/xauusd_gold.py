"""Strategia dedykowana XAUUSD (zloto spot) - struktura sesyjna + poziomy.

Zloto ma cechy, ktorych generyczne detektory nie wykorzystuja:
- cicha sesja azjatycka buduje range, ktory Londyn/NY wybija albo
  fake'uje (dwa najbardziej powtarzalne schematy intraday na zlocie),
- poziomy psychologiczne co 25/50/100 USD dzialaja jak S/R,
- intraday cena wraca do sesyjnego VWAP po rozciagnieciu,
- "wolumen" z CFD/forex to tick volume - uzywany wylacznie jako
  opcjonalny bonus do confidence, nigdy jako warunek.

Sub-sygnaly:
    asia_breakout        - wybicie rangu azjatyckiego w LDN/NY (trend),
    london_fakeout       - nieudane wybicie wracajace do rangu (rewersja),
    round_level_bounce   - odrzucenie okraglego poziomu knotem (rewersja),
    session_vwap_fade    - fade od sesyjnego VWAP przy |z| > prog (rewersja).

Kazdy sygnal jest wazony PLYNNOSCIA SESJI: nakladka LDN/NY (12-17 UTC)
= 1.0x, Londyn = 0.9x, NY po nakladce = 0.8x, Azja = 0.5x.

Przyklad:
    >>> from trading_bot.strategies.xauusd_gold import XauusdStrategy
    >>> strat = XauusdStrategy()
    >>> strat.name
    'xauusd'
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from trading_bot.core.indicators import atr
from trading_bot.core.models import Direction, Signal, StrategyStyle
from trading_bot.strategies.base_strategy import BaseStrategy


class XauusdStrategy(BaseStrategy):
    """Detektor schematow sesyjnych zlota (interwaly intraday, M5-H1)."""

    name = "xauusd"
    style = StrategyStyle.TREND_FOLLOWING
    #: pelna doba M15 (96 swiec) + zapas na ATR
    min_bars = 120

    def __init__(
        self,
        min_confidence: float = 0.3,
        asia_start_hour: int = 0,
        asia_end_hour: int = 7,
        session_end_hour: int = 21,
        round_step: float = 25.0,
        round_proximity_atr: float = 0.5,
        vwap_z_entry: float = 2.0,
        fakeout_lookback: int = 6,
        breakout_buffer_atr: float = 0.1,
    ) -> None:
        """Args:
        asia_start_hour/asia_end_hour: sesja azjatycka w UTC (range).
        session_end_hour: koniec handlu NY (UTC) - potem sygnaly wygasa.
        round_step: krok poziomow psychologicznych w USD (25 -> 2650, 2675...).
        round_proximity_atr: max odleglosc knota od poziomu w ATR.
        vwap_z_entry: prog z-score odchylenia od sesyjnego VWAP.
        fakeout_lookback: ile swiec wstecz szukac nieudanego wybicia.
        breakout_buffer_atr: bufor nad/pod rangem w ATR (filtr szumu).
        """
        super().__init__(min_confidence)
        self.asia_start_hour = asia_start_hour
        self.asia_end_hour = asia_end_hour
        self.session_end_hour = session_end_hour
        self.round_step = round_step
        self.round_proximity_atr = round_proximity_atr
        self.vwap_z_entry = vwap_z_entry
        self.fakeout_lookback = fakeout_lookback
        self.breakout_buffer_atr = breakout_buffer_atr

    # ------------------------------------------------------------------
    def detect(self, df: pd.DataFrame, symbol: str = "", timeframe: str = "") -> list[Signal]:
        if not isinstance(df.index, pd.DatetimeIndex):
            return []  # struktura sesyjna wymaga osi czasu
        hour = int(df.index[-1].hour)
        session_w = self._session_weight(hour)
        if session_w == 0.0:
            return []
        atr_value = float(atr(df, 14).iloc[-1])
        if not atr_value > 0:
            return []

        i = len(df) - 1
        signals: list[Signal] = []
        asia = self._asia_range(df)
        for result in (
            self._asia_breakout(df, asia, atr_value, hour),
            self._london_fakeout(df, asia, atr_value, hour),
            self._round_level_bounce(df, atr_value),
            self._session_vwap_fade(df, hour),
        ):
            if result is None:
                continue
            pattern, direction, conf, style, meta = result
            signals.append(
                self.make_signal(pattern, direction, conf * session_w,
                                 symbol, timeframe, i, meta, style=style)
            )
        return signals

    # ----------------------------------------------------------- sesje
    def _session_weight(self, hour_utc: int) -> float:
        """Waga plynnosci: nakladka LDN/NY > Londyn > NY > Azja."""
        if 12 <= hour_utc < 17:
            return 1.0
        if 7 <= hour_utc < 12:
            return 0.9
        if 17 <= hour_utc < self.session_end_hour:
            return 0.8
        if self.asia_start_hour <= hour_utc < self.asia_end_hour:
            return 0.5
        return 0.0  # martwe godziny (rollover) - brak sygnalow

    def _asia_range(self, df: pd.DataFrame) -> Optional[tuple[float, float]]:
        """(high, low) sesji azjatyckiej biezacego dnia UTC lub None."""
        last_day = df.index[-1].date()
        mask = (df.index.date == last_day) & (df.index.hour >= self.asia_start_hour) \
            & (df.index.hour < self.asia_end_hour)
        session = df.loc[mask]
        if len(session) < 8:  # niepelna sesja = range niewiarygodny
            return None
        return float(session["high"].max()), float(session["low"].min())

    # ------------------------------------------------------- sub-sygnaly
    def _asia_breakout(
        self, df: pd.DataFrame, asia: Optional[tuple[float, float]],
        atr_value: float, hour: int,
    ) -> Optional[tuple]:
        """Wybicie rangu azjatyckiego w godzinach LDN/NY.

        Im ciasniejszy range wzgledem ATR, tym silniejszy sygnal
        (kompresja -> ekspansja). Wybicie musi byc swieze (ostatnia swieca
        zamyka za buforem, poprzednia jeszcze nie).
        """
        if asia is None or not self.asia_end_hour <= hour < self.session_end_hour:
            return None
        asia_high, asia_low = asia
        buffer = self.breakout_buffer_atr * atr_value
        close = float(df["close"].iloc[-1])
        prev_close = float(df["close"].iloc[-2])
        range_width = asia_high - asia_low
        if range_width <= 0:
            return None
        # kompresja: range < 4x ATR pelna sila, > 8x ATR bez sygnalu
        tightness = float(np.clip(2.0 - range_width / (4 * atr_value), 0.0, 1.0))
        if tightness == 0.0:
            return None
        meta = {"asia_high": asia_high, "asia_low": asia_low,
                "structure_stop": None}
        if close > asia_high + buffer and prev_close <= asia_high + buffer:
            meta["structure_stop"] = asia_low  # SL strukturalny pod rangem
            return ("asia_breakout", Direction.LONG, 0.5 + 0.5 * tightness,
                    StrategyStyle.TREND_FOLLOWING, meta)
        if close < asia_low - buffer and prev_close >= asia_low - buffer:
            meta["structure_stop"] = asia_high
            return ("asia_breakout", Direction.SHORT, 0.5 + 0.5 * tightness,
                    StrategyStyle.TREND_FOLLOWING, meta)
        return None

    def _london_fakeout(
        self, df: pd.DataFrame, asia: Optional[tuple[float, float]],
        atr_value: float, hour: int,
    ) -> Optional[tuple]:
        """Nieudane wybicie: knot za range i powrot do srodka = rewersja.

        Klasyczny londynski stop-hunt na zlocie: wybicie zbiera stopy
        nad rangem i cena wraca - gramy w przeciwna strone.
        """
        if asia is None or not self.asia_end_hour <= hour < self.session_end_hour:
            return None
        asia_high, asia_low = asia
        recent = df.iloc[-self.fakeout_lookback:]
        close = float(df["close"].iloc[-1])
        buffer = self.breakout_buffer_atr * atr_value
        poked_above = float(recent["high"].max()) > asia_high + buffer
        poked_below = float(recent["low"].min()) < asia_low - buffer
        # glebokosc powrotu do rangu wzmacnia sygnal
        if poked_above and close < asia_high - buffer:
            depth = min((asia_high - close) / max(atr_value, 1e-9), 2.0) / 2.0
            return ("london_fakeout", Direction.SHORT, 0.5 + 0.5 * depth,
                    StrategyStyle.MEAN_REVERSION,
                    {"failed_level": asia_high, "structure_stop": float(recent["high"].max())})
        if poked_below and close > asia_low + buffer:
            depth = min((close - asia_low) / max(atr_value, 1e-9), 2.0) / 2.0
            return ("london_fakeout", Direction.LONG, 0.5 + 0.5 * depth,
                    StrategyStyle.MEAN_REVERSION,
                    {"failed_level": asia_low, "structure_stop": float(recent["low"].min())})
        return None

    def _round_level_bounce(self, df: pd.DataFrame, atr_value: float) -> Optional[tuple]:
        """Odrzucenie poziomu psychologicznego (co `round_step` USD) knotem."""
        last = df.iloc[-1]
        close = float(last["close"])
        body = abs(last["close"] - last["open"])
        proximity = self.round_proximity_atr * atr_value

        level_below = np.floor(float(last["low"]) / self.round_step + 0.5) * self.round_step
        lower_wick = min(last["open"], last["close"]) - last["low"]
        if (abs(last["low"] - level_below) <= proximity and close > level_below
                and lower_wick >= 1.5 * max(body, 1e-9)):
            quality = min(lower_wick / max(atr_value, 1e-9), 1.5) / 1.5
            return ("round_level_bounce", Direction.LONG, 0.45 + 0.45 * quality,
                    StrategyStyle.MEAN_REVERSION,
                    {"level": float(level_below), "structure_stop": float(last["low"])})

        level_above = np.floor(float(last["high"]) / self.round_step + 0.5) * self.round_step
        upper_wick = last["high"] - max(last["open"], last["close"])
        if (abs(last["high"] - level_above) <= proximity and close < level_above
                and upper_wick >= 1.5 * max(body, 1e-9)):
            quality = min(upper_wick / max(atr_value, 1e-9), 1.5) / 1.5
            return ("round_level_bounce", Direction.SHORT, 0.45 + 0.45 * quality,
                    StrategyStyle.MEAN_REVERSION,
                    {"level": float(level_above), "structure_stop": float(last["high"])})
        return None

    def _session_vwap_fade(self, df: pd.DataFrame, hour: int) -> Optional[tuple]:
        """Fade od VWAP zakotwiczonego na starcie dnia UTC przy |z| > prog.

        Tick volume z CFD wystarcza do wazenia VWAP; przy zerowym wolumenie
        uzywamy sredniej typowej ceny (fallback bez wolumenu).
        """
        if hour < self.asia_end_hour:  # w Azji za malo probek na z-score
            return None
        last_day = df.index[-1].date()
        day = df.loc[df.index.date == last_day]
        if len(day) < 20:
            return None
        typical = (day["high"] + day["low"] + day["close"]) / 3.0
        vol = day["volume"]
        if float(vol.sum()) > 0:
            vwap = float((typical * vol).cumsum().iloc[-1] / vol.cumsum().iloc[-1])
        else:
            vwap = float(typical.mean())
        deviations = day["close"] - typical.expanding().mean()
        std = float(deviations.std())
        if not np.isfinite(std) or std == 0:
            return None
        z = (float(day["close"].iloc[-1]) - vwap) / std
        if abs(z) < self.vwap_z_entry:
            return None
        direction = Direction.SHORT if z > 0 else Direction.LONG
        conf = min(abs(z) / (2 * self.vwap_z_entry), 1.0)
        return ("session_vwap_fade", direction, conf,
                StrategyStyle.MEAN_REVERSION,
                {"zscore": round(float(z), 3), "session_vwap": round(vwap, 2)})
