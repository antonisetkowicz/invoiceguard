"""Abstrakcyjna klasa bazowa wszystkich strategii.

Kazda strategia dostaje DataFrame OHLCV i zwraca liste sygnalow
odnoszacych sie do OSTATNIEJ domknietej swiecy (brak lookahead).

Przyklad implementacji:
    >>> import pandas as pd
    >>> from trading_bot.strategies.base_strategy import BaseStrategy
    >>> from trading_bot.core.models import Signal, Direction
    >>> class AlwaysLong(BaseStrategy):
    ...     name = "always_long"
    ...     def detect(self, df, symbol="X", timeframe="1h"):
    ...         return [self.make_signal("dummy", Direction.LONG, 1.0,
    ...                                  symbol, timeframe, len(df) - 1)]
"""
from __future__ import annotations

import abc
from typing import Optional

import pandas as pd

from trading_bot.core.indicators import OHLCV_COLUMNS
from trading_bot.core.models import Direction, Signal, StrategyStyle


class BaseStrategy(abc.ABC):
    """Kontrakt strategii: walidacja wejscia + fabryka sygnalow."""

    #: nazwa strategii - musi odpowiadac kluczowi w settings.strategy_weights
    name: str = "base"
    #: styl decydujacy o mnozniku rezimu w agregatorze
    style: StrategyStyle = StrategyStyle.TREND_FOLLOWING
    #: minimalna liczba swiec potrzebna do detekcji
    min_bars: int = 30

    def __init__(self, min_confidence: float = 0.3) -> None:
        self.min_confidence = min_confidence

    @abc.abstractmethod
    def detect(
        self, df: pd.DataFrame, symbol: str = "", timeframe: str = ""
    ) -> list[Signal]:
        """Zwraca sygnaly dla ostatniej domknietej swiecy `df`."""

    def scan(
        self, df: pd.DataFrame, symbol: str = "", timeframe: str = ""
    ) -> list[Signal]:
        """Waliduje dane i filtruje sygnaly ponizej progu pewnosci."""
        self.validate(df)
        signals = self.detect(df, symbol=symbol, timeframe=timeframe)
        return [s for s in signals if s.confidence >= self.min_confidence]

    def validate(self, df: pd.DataFrame) -> None:
        missing = [c for c in OHLCV_COLUMNS if c not in df.columns]
        if missing:
            raise ValueError(f"Brak kolumn OHLCV: {missing}")
        if len(df) < self.min_bars:
            raise ValueError(
                f"{self.name}: wymaga min {self.min_bars} swiec, dostal {len(df)}"
            )

    def make_signal(
        self,
        pattern: str,
        direction: Direction,
        confidence: float,
        symbol: str,
        timeframe: str,
        bar_index: int,
        meta: Optional[dict] = None,
    ) -> Signal:
        return Signal(
            strategy=self.name,
            pattern=pattern,
            direction=direction,
            confidence=max(0.0, min(1.0, confidence)),
            timeframe=timeframe,
            symbol=symbol,
            style=self.style,
            bar_index=bar_index,
            meta=meta or {},
        )
