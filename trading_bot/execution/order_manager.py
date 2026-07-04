"""Zarzadzanie cyklem zycia zlecen: entry + SL + TP (emulowane OCO).

W trybie live kazde zlecenie wymaga potwierdzenia (callback confirm),
w trybie paper wykonywane od razu.

Przyklad:
    >>> from trading_bot.execution.exchange_connector import PaperConnector
    >>> from trading_bot.execution.order_manager import OrderManager
    >>> conn = PaperConnector(); conn.set_price("BTC/USDT", 100.0)
    >>> om = OrderManager(conn)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from loguru import logger

from trading_bot.core.models import (
    Direction,
    Order,
    OrderSide,
    OrderStatus,
    OrderType,
    Position,
)
from trading_bot.core.risk_manager import TradePlan
from trading_bot.execution.exchange_connector import ExchangeConnector

#: podpis funkcji potwierdzenia transakcji w trybie live
ConfirmCallback = Callable[[TradePlan], bool]


@dataclass(slots=True)
class ManagedPosition:
    """Pozycja wraz z przypisanymi zleceniami ochronnymi."""

    position: Position
    entry_order: Order
    stop_order: Optional[Order] = None
    tp_order: Optional[Order] = None
    strategy_names: list[str] = field(default_factory=list)


class OrderManager:
    """Sklada zlecenia wg TradePlan i pilnuje zlecen ochronnych (OCO)."""

    def __init__(
        self,
        connector: ExchangeConnector,
        live_mode: bool = False,
        confirm: Optional[ConfirmCallback] = None,
    ) -> None:
        self.connector = connector
        self.live_mode = live_mode
        self.confirm = confirm
        self.open_positions: dict[str, ManagedPosition] = {}

    def execute_plan(self, plan: TradePlan, strategy_names: Optional[list[str]] = None) -> Optional[ManagedPosition]:
        """Realizuje plan: potwierdzenie (live) -> entry -> SL/TP."""
        if self.live_mode:
            if self.confirm is None or not self.confirm(plan):
                logger.info("Transakcja {} odrzucona (brak potwierdzenia)", plan.symbol)
                return None
        side = OrderSide.BUY if plan.direction == Direction.LONG else OrderSide.SELL
        entry = self.connector.create_order(
            Order(plan.symbol, side, OrderType.MARKET, plan.quantity)
        )
        if entry.status not in (OrderStatus.FILLED, OrderStatus.OPEN):
            logger.error("Entry odrzucone: {}", entry)
            return None
        fill_price = entry.avg_fill_price or plan.entry_price
        position = Position(
            symbol=plan.symbol,
            direction=plan.direction,
            quantity=plan.quantity,
            entry_price=fill_price,
            stop_loss=plan.stop_loss,
            take_profit=plan.take_profit,
        )
        managed = ManagedPosition(
            position=position, entry_order=entry, strategy_names=strategy_names or []
        )
        self._place_protective(managed)
        self.open_positions[plan.symbol] = managed
        logger.info(
            "Otwarta pozycja {} {} qty={:.6f} @ {:.2f} SL={:.2f} TP={:.2f}",
            plan.symbol, plan.direction.name, plan.quantity,
            fill_price, plan.stop_loss, plan.take_profit,
        )
        return managed

    def _place_protective(self, managed: ManagedPosition) -> None:
        """Sklada pare SL (stop-market) + TP (limit) - emulacja OCO."""
        pos = managed.position
        exit_side = OrderSide.SELL if pos.direction == Direction.LONG else OrderSide.BUY
        managed.stop_order = self.connector.create_order(
            Order(pos.symbol, exit_side, OrderType.STOP_MARKET, pos.quantity,
                  stop_price=pos.stop_loss)
        )
        managed.tp_order = self.connector.create_order(
            Order(pos.symbol, exit_side, OrderType.LIMIT, pos.quantity,
                  price=pos.take_profit)
        )

    def update_stop(self, symbol: str, new_stop: float) -> None:
        """Przesuwa stop (trailing): anuluj stary, zloz nowy."""
        managed = self.open_positions.get(symbol)
        if managed is None:
            return
        pos = managed.position
        if managed.stop_order and managed.stop_order.status == OrderStatus.OPEN:
            self.connector.cancel_order(managed.stop_order.order_id, symbol)
        exit_side = OrderSide.SELL if pos.direction == Direction.LONG else OrderSide.BUY
        managed.stop_order = self.connector.create_order(
            Order(symbol, exit_side, OrderType.STOP_MARKET, pos.quantity,
                  stop_price=new_stop)
        )
        pos.stop_loss = new_stop

    def poll_exits(self) -> list[tuple[str, float, str, "ManagedPosition"]]:
        """Sprawdza czy SL/TP zostaly wypelnione.

        Zwraca [(symbol, cena_wyjscia, powod, pozycja)]. Po wypelnieniu
        jednej nogi OCO druga jest anulowana.
        """
        closed: list[tuple[str, float, str, ManagedPosition]] = []
        for symbol, managed in list(self.open_positions.items()):
            for order, other, reason in (
                (managed.stop_order, managed.tp_order, "stop_loss"),
                (managed.tp_order, managed.stop_order, "take_profit"),
            ):
                if order is None:
                    continue
                latest = self.connector.fetch_order(order.order_id, symbol)
                if latest is not None and latest.status == OrderStatus.FILLED:
                    if other is not None and other.status == OrderStatus.OPEN:
                        self.connector.cancel_order(other.order_id, symbol)
                    closed.append((symbol, latest.avg_fill_price, reason, managed))
                    del self.open_positions[symbol]
                    logger.info("Pozycja {} zamknieta ({}) @ {:.2f}",
                                symbol, reason, latest.avg_fill_price)
                    break
        return closed

    def close_position(self, symbol: str, reason: str = "manual") -> Optional[float]:
        """Zamyka pozycje market orderem, anuluje zlecenia ochronne."""
        managed = self.open_positions.pop(symbol, None)
        if managed is None:
            return None
        for order in (managed.stop_order, managed.tp_order):
            if order and order.status == OrderStatus.OPEN:
                self.connector.cancel_order(order.order_id, symbol)
        pos = managed.position
        exit_side = OrderSide.SELL if pos.direction == Direction.LONG else OrderSide.BUY
        exit_order = self.connector.create_order(
            Order(symbol, exit_side, OrderType.MARKET, pos.quantity)
        )
        logger.info("Pozycja {} zamknieta recznie ({})", symbol, reason)
        return exit_order.avg_fill_price or None
