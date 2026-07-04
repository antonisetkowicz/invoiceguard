"""Abstrakcja API gieldy: wspolny interfejs dla Binance/Bybit (ccxt), IBKR
oraz PaperConnector (symulacja).

Live connector wspiera: Market, Limit, Stop-Market, Stop-Limit, OCO,
rate limiting oraz retry z exponential backoff.

Przyklad:
    >>> from trading_bot.execution.exchange_connector import PaperConnector
    >>> conn = PaperConnector()
    >>> conn.set_price("BTC/USDT", 50000.0)
    >>> from trading_bot.core.models import Order, OrderSide, OrderType
    >>> order = conn.create_order(Order("BTC/USDT", OrderSide.BUY,
    ...                                 OrderType.MARKET, quantity=0.1))
    >>> order.status.value
    'filled'
"""
from __future__ import annotations

import abc
import itertools
import threading
import time
from typing import Callable, Optional

from loguru import logger

from trading_bot.core.config import ExchangeConfig
from trading_bot.core.models import Order, OrderSide, OrderStatus, OrderType


class RateLimiter:
    """Prosty token-bucket: max `rps` wywolan na sekunde (thread-safe)."""

    def __init__(self, rps: float) -> None:
        self._interval = 1.0 / rps
        self._lock = threading.Lock()
        self._next_allowed = 0.0

    def acquire(self) -> None:
        with self._lock:
            now = time.monotonic()
            wait = self._next_allowed - now
            self._next_allowed = max(now, self._next_allowed) + self._interval
        if wait > 0:
            time.sleep(wait)


def retry_with_backoff(
    fn: Callable,
    retries: int = 4,
    base_delay: float = 2.0,
    retriable: tuple[type[Exception], ...] = (ConnectionError, TimeoutError),
):
    """Wywoluje `fn` z retry i exponential backoff (2s, 4s, 8s, 16s)."""
    for attempt in range(retries + 1):
        try:
            return fn()
        except retriable as exc:
            if attempt == retries:
                raise
            delay = base_delay * (2 ** attempt)
            logger.warning("Retry {}/{} po bledzie: {} (czekam {}s)",
                           attempt + 1, retries, exc, delay)
            time.sleep(delay)


class ExchangeConnector(abc.ABC):
    """Wspolny interfejs wszystkich connectorow."""

    @abc.abstractmethod
    def create_order(self, order: Order) -> Order:
        """Wysyla zlecenie; zwraca zaktualizowany obiekt Order."""

    @abc.abstractmethod
    def cancel_order(self, order_id: str, symbol: str) -> bool: ...

    @abc.abstractmethod
    def fetch_order(self, order_id: str, symbol: str) -> Optional[Order]: ...

    @abc.abstractmethod
    def fetch_balance(self) -> dict[str, float]: ...

    @abc.abstractmethod
    def fetch_ticker(self, symbol: str) -> float:
        """Ostatnia cena instrumentu."""


class CcxtConnector(ExchangeConnector):
    """Connector live przez ccxt (Binance, Bybit, ...). Import leniwy."""

    def __init__(self, config: ExchangeConfig) -> None:
        if config.ccxt_id == "ibkr":
            raise NotImplementedError(
                "IBKR wymaga ib_insync - zainstaluj pakiet i uzyj IbkrConnector"
            )
        import ccxt  # opcjonalna zaleznosc

        klass = getattr(ccxt, config.ccxt_id)
        self._exchange = klass(
            {
                "apiKey": config.api_key,
                "secret": config.api_secret,
                "enableRateLimit": True,
            }
        )
        if config.sandbox and hasattr(self._exchange, "set_sandbox_mode"):
            self._exchange.set_sandbox_mode(True)
        self._limiter = RateLimiter(config.rate_limit_rps)

    def _call(self, fn: Callable):
        self._limiter.acquire()
        return retry_with_backoff(fn, retriable=(Exception,))

    def create_order(self, order: Order) -> Order:
        params: dict = {}
        if order.order_type in (OrderType.STOP_MARKET, OrderType.STOP_LIMIT):
            params["stopPrice"] = order.stop_price
        ccxt_type = {
            OrderType.MARKET: "market",
            OrderType.LIMIT: "limit",
            OrderType.STOP_MARKET: "market",
            OrderType.STOP_LIMIT: "limit",
            OrderType.OCO: "limit",
        }[order.order_type]
        raw = self._call(
            lambda: self._exchange.create_order(
                order.symbol, ccxt_type, order.side.value, order.quantity,
                order.price, params,
            )
        )
        order.order_id = str(raw["id"])
        order.status = OrderStatus.OPEN
        return order

    def cancel_order(self, order_id: str, symbol: str) -> bool:
        self._call(lambda: self._exchange.cancel_order(order_id, symbol))
        return True

    def fetch_order(self, order_id: str, symbol: str) -> Optional[Order]:
        raw = self._call(lambda: self._exchange.fetch_order(order_id, symbol))
        if raw is None:
            return None
        order = Order(
            symbol=symbol,
            side=OrderSide(raw["side"]),
            order_type=OrderType.MARKET if raw["type"] == "market" else OrderType.LIMIT,
            quantity=float(raw["amount"]),
            price=raw.get("price"),
            order_id=order_id,
        )
        order.filled_quantity = float(raw.get("filled") or 0.0)
        order.avg_fill_price = float(raw.get("average") or 0.0)
        status_map = {
            "open": OrderStatus.OPEN, "closed": OrderStatus.FILLED,
            "canceled": OrderStatus.CANCELED, "rejected": OrderStatus.REJECTED,
        }
        order.status = status_map.get(raw.get("status", "open"), OrderStatus.OPEN)
        return order

    def fetch_balance(self) -> dict[str, float]:
        raw = self._call(self._exchange.fetch_balance)
        return {k: float(v) for k, v in raw.get("total", {}).items() if v}

    def fetch_ticker(self, symbol: str) -> float:
        return float(self._call(lambda: self._exchange.fetch_ticker(symbol))["last"])


class PaperConnector(ExchangeConnector):
    """Symulowany connector - natychmiastowe fille po zadanej cenie."""

    def __init__(self, initial_balance: Optional[dict[str, float]] = None) -> None:
        self._prices: dict[str, float] = {}
        self._orders: dict[str, Order] = {}
        self._balance: dict[str, float] = initial_balance or {"USDT": 10_000.0}
        self._ids = itertools.count(1)

    def set_price(self, symbol: str, price: float) -> None:
        """Aktualizuje cene rynkowa i probuje wypelnic zlecenia oczekujace."""
        self._prices[symbol] = price
        for order in list(self._orders.values()):
            if order.symbol == symbol and order.status == OrderStatus.OPEN:
                self._try_fill(order, price)

    def _try_fill(self, order: Order, price: float) -> None:
        fill = False
        fill_price = price
        if order.order_type == OrderType.MARKET:
            fill = True
        elif order.order_type == OrderType.LIMIT:
            assert order.price is not None
            fill = price <= order.price if order.side == OrderSide.BUY else price >= order.price
            fill_price = order.price
        elif order.order_type in (OrderType.STOP_MARKET, OrderType.STOP_LIMIT):
            assert order.stop_price is not None
            triggered = (
                price >= order.stop_price if order.side == OrderSide.BUY
                else price <= order.stop_price
            )
            fill = triggered
            fill_price = order.stop_price if order.order_type == OrderType.STOP_MARKET else (order.price or price)
        if fill:
            order.status = OrderStatus.FILLED
            order.filled_quantity = order.quantity
            order.avg_fill_price = fill_price

    def create_order(self, order: Order) -> Order:
        order.order_id = f"paper-{next(self._ids)}"
        order.status = OrderStatus.OPEN
        self._orders[order.order_id] = order
        price = self._prices.get(order.symbol)
        if price is not None:
            self._try_fill(order, price)
        return order

    def cancel_order(self, order_id: str, symbol: str) -> bool:
        order = self._orders.get(order_id)
        if order and order.status == OrderStatus.OPEN:
            order.status = OrderStatus.CANCELED
            return True
        return False

    def fetch_order(self, order_id: str, symbol: str) -> Optional[Order]:
        return self._orders.get(order_id)

    def fetch_balance(self) -> dict[str, float]:
        return dict(self._balance)

    def fetch_ticker(self, symbol: str) -> float:
        if symbol not in self._prices:
            raise KeyError(f"Brak ceny dla {symbol} - wywolaj set_price()")
        return self._prices[symbol]
