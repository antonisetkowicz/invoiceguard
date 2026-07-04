"""Paper trader: pelna symulacja handlu na strumieniu swiec.

Laczy PatternDetector + SignalAggregator + RiskManager + OrderManager
(PaperConnector) w jedna petle `on_bar`. Domyslny tryb pracy bota.

Przyklad:
    >>> from trading_bot.core.config import load_settings
    >>> from trading_bot.execution.paper_trader import PaperTrader
    >>> trader = PaperTrader(load_settings())  # doctest: +SKIP
"""
from __future__ import annotations

from typing import Optional

import pandas as pd
from loguru import logger

from trading_bot.core.config import Settings
from trading_bot.core.models import Direction, Regime, Trade
from trading_bot.core.pattern_detector import PatternDetector
from trading_bot.core.risk_manager import RiskManager
from trading_bot.core.signal_aggregator import SignalAggregator
from trading_bot.core.indicators import atr
from trading_bot.execution.exchange_connector import PaperConnector
from trading_bot.execution.order_manager import OrderManager
from trading_bot.ml.meta_learner import MetaLearner
from trading_bot.ml.regime_detector import RegimeDetector


class PaperTrader:
    """Silnik symulacji handlu bez realnych srodkow."""

    def __init__(self, settings: Settings, detector: Optional[PatternDetector] = None) -> None:
        self.settings = settings
        self.detector = detector or PatternDetector.default(settings.patterns)
        self.risk = RiskManager(settings.risk)
        self.meta = MetaLearner(settings.strategy_weights or {"candlestick": 1.0})
        self.regime_detector = RegimeDetector(settings.regime)
        self.connector = PaperConnector(
            {"USDT": settings.risk.initial_capital}
        )
        self.orders = OrderManager(self.connector, live_mode=False)
        self.trades: list[Trade] = []
        self._regime: Regime = Regime.MEAN_REVERTING

    def warmup(self, frames: dict[str, pd.DataFrame]) -> None:
        """Trenuje detektor rezimu na historii przed startem symulacji."""
        primary = next(iter(frames.values()))
        self.regime_detector.fit(primary)

    def on_bar(self, symbol: str, frames: dict[str, pd.DataFrame]) -> None:
        """Przetwarza nowa domknieta swiece (multi-timeframe widok).

        Kolejnosc: aktualizacja cen/wyjsc -> trailing -> nowe sygnaly.
        """
        exec_tf = self.settings.timeframes[0]
        df = frames[exec_tf]
        price = float(df["close"].iloc[-1])
        now = df.index[-1].to_pydatetime()

        self.risk.on_new_bar(now)
        self.connector.set_price(symbol, price)
        self._handle_exits(symbol, price)
        self._update_trailing(symbol, df, price)

        if symbol in self.orders.open_positions or self.risk.halted_until_next_day:
            return

        self._regime = self.regime_detector.classify(df)
        active = set(self.regime_detector.active_strategies(self._regime))
        signals = [
            s for s in self.detector.detect_all(frames, symbol=symbol)
            if s.strategy in active
        ]
        aggregator = SignalAggregator(
            self.meta.current_weights(),
            self.settings.regime_multipliers,
            self.settings.signals,
        )
        result = aggregator.aggregate(signals, self._regime)
        if result.decision not in ("LONG", "SHORT"):
            return

        direction = Direction.LONG if result.decision == "LONG" else Direction.SHORT
        structure_stop = self._structure_stop(result.contributing, direction)
        plan = self.risk.plan_trade(symbol, direction, df, structure_stop)
        if plan is None:
            return
        strategies = sorted({s.strategy for s in result.contributing})
        self.orders.execute_plan(plan, strategy_names=strategies)

    # ------------------------------------------------------------------
    @staticmethod
    def _structure_stop(signals: list, direction: Direction) -> Optional[float]:
        """Poziom SL z metadanych formacji (neckline / PRZ), jesli dostepny."""
        levels = [
            s.meta.get("neckline") or s.meta.get("prz")
            for s in signals
            if s.meta.get("neckline") or s.meta.get("prz")
        ]
        if not levels:
            return None
        return max(levels) if direction == Direction.SHORT else min(levels)

    def _update_trailing(self, symbol: str, df: pd.DataFrame, price: float) -> None:
        managed = self.orders.open_positions.get(symbol)
        if managed is None:
            return
        atr_value = float(atr(df, 14).iloc[-1])
        pos = self.risk.update_trailing(managed.position, price, atr_value)
        new_stop = self.risk.effective_stop(pos)
        if new_stop != pos.stop_loss:
            self.orders.update_stop(symbol, new_stop)

    def _handle_exits(self, symbol: str, price: float) -> None:
        """Ksieguje pozycje zamkniete przez SL/TP."""
        for sym, exit_price, reason, managed in self.orders.poll_exits():
            pos = managed.position
            trade = Trade(
                symbol=sym,
                direction=pos.direction,
                quantity=pos.quantity,
                entry_price=pos.entry_price,
                exit_price=exit_price,
                exit_reason=reason,
                entry_logic=",".join(managed.strategy_names),
            )
            self.trades.append(trade)
            self.risk.record_trade(trade.pnl)
            for strategy in managed.strategy_names:
                self.meta.record_outcome(strategy, won=trade.pnl > 0)
            logger.info("Trade {} PnL={:.2f} ({})", sym, trade.pnl, reason)

    def close_all(self, prices: dict[str, float]) -> None:
        """Zamyka wszystkie pozycje (koniec sesji / shutdown)."""
        for symbol in list(self.orders.open_positions):
            price = prices.get(symbol)
            if price is not None:
                self.connector.set_price(symbol, price)
            managed = self.orders.open_positions[symbol]
            exit_price = self.orders.close_position(symbol, reason="shutdown") or price or 0.0
            pos = managed.position
            trade = Trade(
                symbol=symbol,
                direction=pos.direction,
                quantity=pos.quantity,
                entry_price=pos.entry_price,
                exit_price=exit_price,
                exit_reason="shutdown",
            )
            self.trades.append(trade)
            self.risk.record_trade(trade.pnl)
            for strategy in managed.strategy_names:
                self.meta.record_outcome(strategy, won=trade.pnl > 0)
