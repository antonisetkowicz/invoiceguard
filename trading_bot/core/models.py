"""Wspolne modele danych calego bota.

Przyklad:
    >>> from trading_bot.core.models import Signal, Direction
    >>> s = Signal(strategy="candlestick", pattern="bullish_engulfing",
    ...            direction=Direction.LONG, confidence=0.8,
    ...            timeframe="1h", symbol="BTC/USDT")
    >>> s.score
    0.8
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


class Direction(enum.IntEnum):
    """Kierunek sygnalu; wartosc liczbowa uzywana w glosowaniu wazonym."""

    LONG = 1
    HOLD = 0
    SHORT = -1


class Regime(str, enum.Enum):
    """Rezim rynku wykrywany przez ml.regime_detector."""

    TRENDING_UP = "trending_up"
    TRENDING_DOWN = "trending_down"
    MEAN_REVERTING = "mean_reverting"
    HIGH_VOLATILITY = "high_volatility"
    LOW_VOLATILITY = "low_volatility"


class StrategyStyle(str, enum.Enum):
    """Styl strategii - decyduje o mnozniku rezimu."""

    TREND_FOLLOWING = "trend_following"
    MEAN_REVERSION = "mean_reversion"


class OrderType(str, enum.Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP_MARKET = "stop_market"
    STOP_LIMIT = "stop_limit"
    OCO = "oco"


class OrderSide(str, enum.Enum):
    BUY = "buy"
    SELL = "sell"


class OrderStatus(str, enum.Enum):
    NEW = "new"
    OPEN = "open"
    FILLED = "filled"
    PARTIALLY_FILLED = "partially_filled"
    CANCELED = "canceled"
    REJECTED = "rejected"


@dataclass(slots=True)
class Signal:
    """Pojedynczy sygnal wyemitowany przez strategie.

    Attributes:
        strategy: nazwa strategii (klucz wagi w configu).
        pattern: nazwa wykrytej formacji.
        direction: LONG / SHORT / HOLD.
        confidence: pewnosc detektora w zakresie [0, 1].
        timeframe: interwal, na ktorym wykryto formacje.
        symbol: instrument.
        style: styl strategii (trend/mean-reversion) dla mnoznika rezimu.
        bar_index: indeks swiecy, na ktorej domknieto formacje.
        meta: dodatkowe dane (poziomy formacji, PRZ itd.).
    """

    strategy: str
    pattern: str
    direction: Direction
    confidence: float
    timeframe: str
    symbol: str
    style: StrategyStyle = StrategyStyle.TREND_FOLLOWING
    bar_index: int = -1
    timestamp: Optional[datetime] = None
    meta: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"confidence poza [0,1]: {self.confidence}")

    @property
    def score(self) -> float:
        """Kierunek wazony pewnoscia: [-1, 1]."""
        return float(self.direction) * self.confidence


@dataclass(slots=True)
class PatternMatch:
    """Geometryczny opis dopasowanej formacji (do raportow/wykresow)."""

    name: str
    direction: Direction
    confidence: float
    start_index: int
    end_index: int
    points: dict[str, tuple[int, float]] = field(default_factory=dict)
    meta: dict = field(default_factory=dict)


@dataclass(slots=True)
class Order:
    """Zlecenie przekazywane do exchange connectora."""

    symbol: str
    side: OrderSide
    order_type: OrderType
    quantity: float
    price: Optional[float] = None
    stop_price: Optional[float] = None
    order_id: str = ""
    status: OrderStatus = OrderStatus.NEW
    filled_quantity: float = 0.0
    avg_fill_price: float = 0.0
    created_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError("quantity musi byc > 0")
        if self.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT) and self.price is None:
            raise ValueError(f"{self.order_type.value} wymaga ceny")
        if self.order_type in (OrderType.STOP_MARKET, OrderType.STOP_LIMIT) and self.stop_price is None:
            raise ValueError(f"{self.order_type.value} wymaga stop_price")


@dataclass(slots=True)
class Position:
    """Otwarta pozycja zarzadzana przez risk managera."""

    symbol: str
    direction: Direction
    quantity: float
    entry_price: float
    stop_loss: float
    take_profit: float
    opened_at: Optional[datetime] = None
    trailing_active: bool = False
    trailing_stop: Optional[float] = None

    @property
    def risk_per_unit(self) -> float:
        """Odleglosc do stop-lossa (1R w cenie)."""
        return abs(self.entry_price - self.stop_loss)

    def unrealized_r(self, price: float) -> float:
        """Aktualny wynik w jednostkach R."""
        if self.risk_per_unit == 0:
            return 0.0
        pnl = (price - self.entry_price) * float(self.direction)
        return pnl / self.risk_per_unit


@dataclass(slots=True)
class Trade:
    """Zamknieta transakcja (rekord do metryk backtestu)."""

    symbol: str
    direction: Direction
    quantity: float
    entry_price: float
    exit_price: float
    entry_time: Optional[datetime] = None
    exit_time: Optional[datetime] = None
    commission: float = 0.0
    slippage: float = 0.0
    exit_reason: str = ""
    entry_logic: str = ""

    @property
    def pnl(self) -> float:
        gross = (self.exit_price - self.entry_price) * float(self.direction) * self.quantity
        return gross - self.commission - self.slippage

    @property
    def return_pct(self) -> float:
        notional = self.entry_price * self.quantity
        return self.pnl / notional if notional else 0.0
