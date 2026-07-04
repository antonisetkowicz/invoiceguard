"""Testy warstwy egzekucji: PaperConnector, OrderManager, rate limiter."""
from __future__ import annotations

import pytest

from trading_bot.core.models import (
    Direction,
    Order,
    OrderSide,
    OrderStatus,
    OrderType,
)
from trading_bot.core.risk_manager import TradePlan
from trading_bot.execution.exchange_connector import (
    PaperConnector,
    RateLimiter,
    retry_with_backoff,
)
from trading_bot.execution.order_manager import OrderManager


@pytest.fixture
def connector() -> PaperConnector:
    conn = PaperConnector()
    conn.set_price("BTC/USDT", 100.0)
    return conn


def plan(direction=Direction.LONG) -> TradePlan:
    if direction == Direction.LONG:
        return TradePlan("BTC/USDT", direction, 1.0, 100.0, 95.0, 110.0, 500.0)
    return TradePlan("BTC/USDT", direction, 1.0, 100.0, 105.0, 90.0, 500.0)


class TestPaperConnector:
    def test_market_order_fills_immediately(self, connector):
        order = connector.create_order(
            Order("BTC/USDT", OrderSide.BUY, OrderType.MARKET, 1.0)
        )
        assert order.status == OrderStatus.FILLED
        assert order.avg_fill_price == 100.0

    def test_limit_buy_waits_for_price(self, connector):
        order = connector.create_order(
            Order("BTC/USDT", OrderSide.BUY, OrderType.LIMIT, 1.0, price=95.0)
        )
        assert order.status == OrderStatus.OPEN
        connector.set_price("BTC/USDT", 94.0)
        assert order.status == OrderStatus.FILLED
        assert order.avg_fill_price == 95.0

    def test_stop_market_sell_triggers(self, connector):
        order = connector.create_order(
            Order("BTC/USDT", OrderSide.SELL, OrderType.STOP_MARKET, 1.0, stop_price=90.0)
        )
        assert order.status == OrderStatus.OPEN
        connector.set_price("BTC/USDT", 89.0)
        assert order.status == OrderStatus.FILLED

    def test_cancel(self, connector):
        order = connector.create_order(
            Order("BTC/USDT", OrderSide.BUY, OrderType.LIMIT, 1.0, price=50.0)
        )
        assert connector.cancel_order(order.order_id, "BTC/USDT")
        assert order.status == OrderStatus.CANCELED

    def test_order_validation(self):
        with pytest.raises(ValueError):
            Order("X", OrderSide.BUY, OrderType.LIMIT, 1.0)  # limit bez ceny
        with pytest.raises(ValueError):
            Order("X", OrderSide.BUY, OrderType.MARKET, 0.0)  # zerowa ilosc


class TestOrderManager:
    def test_execute_plan_places_protective_orders(self, connector):
        om = OrderManager(connector)
        managed = om.execute_plan(plan(), strategy_names=["harmonic"])
        assert managed is not None
        assert managed.stop_order is not None and managed.tp_order is not None
        assert "BTC/USDT" in om.open_positions

    def test_take_profit_closes_and_cancels_stop(self, connector):
        om = OrderManager(connector)
        om.execute_plan(plan())
        connector.set_price("BTC/USDT", 111.0)  # TP 110 osiagniety
        closed = om.poll_exits()
        assert len(closed) == 1
        symbol, price, reason, managed = closed[0]
        assert reason == "take_profit"
        assert price == pytest.approx(110.0)
        assert om.open_positions == {}
        assert managed.stop_order.status == OrderStatus.CANCELED

    def test_stop_loss_closes(self, connector):
        om = OrderManager(connector)
        om.execute_plan(plan())
        connector.set_price("BTC/USDT", 94.0)
        closed = om.poll_exits()
        assert closed[0][2] == "stop_loss"

    def test_live_mode_requires_confirmation(self, connector):
        om = OrderManager(connector, live_mode=True, confirm=lambda p: False)
        assert om.execute_plan(plan()) is None
        assert om.open_positions == {}

    def test_update_stop_replaces_order(self, connector):
        om = OrderManager(connector)
        om.execute_plan(plan())
        old_stop = om.open_positions["BTC/USDT"].stop_order
        om.update_stop("BTC/USDT", 99.0)
        new_stop = om.open_positions["BTC/USDT"].stop_order
        assert old_stop.status == OrderStatus.CANCELED
        assert new_stop.stop_price == 99.0


class TestRetryAndRateLimit:
    def test_retry_succeeds_after_failures(self, monkeypatch):
        monkeypatch.setattr("time.sleep", lambda s: None)
        attempts = {"n": 0}

        def flaky():
            attempts["n"] += 1
            if attempts["n"] < 3:
                raise ConnectionError("boom")
            return "ok"

        assert retry_with_backoff(flaky, retries=4, base_delay=0.0) == "ok"
        assert attempts["n"] == 3

    def test_retry_exhausts(self, monkeypatch):
        monkeypatch.setattr("time.sleep", lambda s: None)

        def always_fails():
            raise TimeoutError("x")

        with pytest.raises(TimeoutError):
            retry_with_backoff(always_fails, retries=2, base_delay=0.0)

    def test_rate_limiter_spacing(self):
        import time

        limiter = RateLimiter(rps=1000.0)
        start = time.monotonic()
        for _ in range(5):
            limiter.acquire()
        assert time.monotonic() - start >= 0.004  # ~1ms odstepu miedzy calami
