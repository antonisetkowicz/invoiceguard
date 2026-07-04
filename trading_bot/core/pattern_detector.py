"""Silnik detekcji: uruchamia wszystkie strategie na wszystkich timeframe'ach.

Przyklad:
    >>> from trading_bot.core.pattern_detector import PatternDetector
    >>> from trading_bot.core.data_engine import generate_synthetic_ohlcv
    >>> det = PatternDetector.default()
    >>> frames = {"1h": generate_synthetic_ohlcv(300, seed=5)}
    >>> signals = det.detect_all(frames, symbol="BTC/USDT")
"""
from __future__ import annotations

import pandas as pd
from loguru import logger

from trading_bot.core.config import PatternConfig
from trading_bot.core.models import Signal
from trading_bot.strategies.base_strategy import BaseStrategy
from trading_bot.strategies.candlestick_patterns import CandlestickStrategy
from trading_bot.strategies.chart_patterns import ChartPatternStrategy
from trading_bot.strategies.harmonic_patterns import HarmonicStrategy
from trading_bot.strategies.microstructure import MicrostructureStrategy


class PatternDetector:
    """Orkiestrator strategii detekcyjnych."""

    def __init__(self, strategies: list[BaseStrategy]) -> None:
        self.strategies = strategies

    @classmethod
    def default(cls, config: PatternConfig | None = None) -> "PatternDetector":
        """Buduje detektor ze wszystkimi wbudowanymi strategiami."""
        cfg = config or PatternConfig()
        return cls(
            [
                CandlestickStrategy(min_confidence=cfg.min_confidence),
                HarmonicStrategy(
                    min_confidence=cfg.min_confidence,
                    fib_tolerance=cfg.fib_tolerance,
                    pivot_window=cfg.pivot_window,
                ),
                ChartPatternStrategy(
                    min_confidence=cfg.min_confidence,
                    pivot_window=cfg.pivot_window,
                ),
                MicrostructureStrategy(
                    min_confidence=cfg.min_confidence,
                    sr_min_touches=cfg.sr_min_touches,
                ),
            ]
        )

    def detect_all(self, frames: dict[str, pd.DataFrame], symbol: str = "") -> list[Signal]:
        """Uruchamia kazda strategie na kazdym timeframe.

        Strategie z niewystarczajaca liczba swiec sa pomijane (nie
        przerywaja calego skanu).
        """
        signals: list[Signal] = []
        for timeframe, df in frames.items():
            for strategy in self.strategies:
                if len(df) < strategy.min_bars:
                    continue
                try:
                    signals.extend(strategy.scan(df, symbol=symbol, timeframe=timeframe))
                except Exception as exc:
                    logger.error("Strategia {} na {} rzucila: {}", strategy.name, timeframe, exc)
        return signals
