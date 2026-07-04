"""Zarzadzanie ryzykiem: sizing (Kelly), SL/TP, limity dzienne, filtry.

Zasady (config.risk):
- Position sizing: pol-Kelly z twardym capem max_position_pct kapitalu,
- Stop Loss: 2x ATR14 lub poziom strukturalny formacji (dalszy z dwoch
  NIE jest wybierany - wybieramy CIASNIEJSZY, by nie zwiekszac ryzyka),
- Take Profit: minimum rr_min * ryzyko; trailing po osiagnieciu 1R,
- Max Daily Loss 3%: przekroczenie wylacza handel do nastepnego dnia UTC,
- Filtr korelacji: max N pozycji o korelacji > threshold,
- Filtr zmiennosci: brak wejsc gdy ATR > atr_filter_multiple * srednia ATR.

Przyklad:
    >>> from trading_bot.core.risk_manager import RiskManager, kelly_fraction
    >>> round(kelly_fraction(win_rate=0.5, avg_win=2.0, avg_loss=1.0), 3)
    0.25
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import pandas as pd
from loguru import logger

from trading_bot.core.config import RiskConfig
from trading_bot.core.indicators import atr
from trading_bot.core.models import Direction, Position


def kelly_fraction(win_rate: float, avg_win: float, avg_loss: float) -> float:
    """Pelne Kelly: f* = W - (1-W)/R, gdzie R = avg_win/avg_loss.

    Zwraca 0 dla ujemnej przewagi (nie gramy).
    """
    if avg_loss <= 0 or not 0 < win_rate < 1:
        return 0.0
    r = avg_win / avg_loss
    f = win_rate - (1 - win_rate) / r
    return max(0.0, f)


@dataclass(slots=True)
class TradePlan:
    """Kompletny plan transakcji zwracany przez risk managera."""

    symbol: str
    direction: Direction
    quantity: float
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_amount: float           # kwota ryzykowana (kapital * frakcja)
    reason: str = ""


class RiskManager:
    """Centralny punkt decyzji o wielkosci i dopuszczalnosci pozycji."""

    def __init__(self, config: RiskConfig) -> None:
        self.config = config
        self.capital = config.initial_capital
        self.daily_pnl = 0.0
        self._daily_anchor: Optional[datetime] = None
        self.halted_until_next_day = False
        # historia do estymacji Kelly (aktualizowana zamyknietymi trade'ami)
        self._wins: list[float] = []
        self._losses: list[float] = []

    # ------------------------------------------------------------- dzienne
    def on_new_bar(self, now: datetime) -> None:
        """Reset dziennego licznika strat o polnocy UTC."""
        day = now.astimezone(timezone.utc).date()
        if self._daily_anchor is None or day != self._daily_anchor.date():
            self._daily_anchor = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
            self.daily_pnl = 0.0
            if self.halted_until_next_day:
                logger.info("Nowy dzien UTC - odblokowuje handel")
            self.halted_until_next_day = False

    def record_trade(self, pnl: float) -> None:
        """Ksieguje zamkniety trade: kapital, dzienny PnL, statystyki Kelly."""
        self.capital += pnl
        self.daily_pnl += pnl
        if pnl >= 0:
            self._wins.append(pnl)
        else:
            self._losses.append(-pnl)
        if self.daily_pnl < -self.config.max_daily_loss_pct * self.capital:
            self.halted_until_next_day = True
            logger.warning(
                "Dzienny limit straty przekroczony ({:.2f}) - handel wstrzymany do jutra",
                self.daily_pnl,
            )

    # -------------------------------------------------------------- filtry
    def volatility_ok(self, df: pd.DataFrame) -> bool:
        """False gdy ATR14 > atr_filter_multiple * srednia ATR (chaos)."""
        series = atr(df, 14).dropna()
        if len(series) < self.config.atr_filter_lookback:
            return True
        current = float(series.iloc[-1])
        avg = float(series.iloc[-self.config.atr_filter_lookback:].mean())
        ok = current <= self.config.atr_filter_multiple * avg
        if not ok:
            logger.info("Filtr zmiennosci: ATR {:.4f} > {:.1f}x srednia {:.4f}",
                        current, self.config.atr_filter_multiple, avg)
        return ok

    def correlation_ok(
        self,
        candidate_symbol: str,
        open_positions: list[Position],
        closes: dict[str, pd.Series],
    ) -> bool:
        """Max N otwartych pozycji skorelowanych z kandydatem > threshold."""
        if candidate_symbol not in closes:
            return True
        cand = closes[candidate_symbol].pct_change().dropna()
        correlated = 0
        for pos in open_positions:
            other = closes.get(pos.symbol)
            if other is None or pos.symbol == candidate_symbol:
                correlated += 1 if pos.symbol == candidate_symbol else 0
                continue
            joined = pd.concat([cand, other.pct_change().dropna()], axis=1).dropna()
            if len(joined) < 20:
                continue
            corr = joined.corr().iloc[0, 1]
            if abs(corr) > self.config.correlation_threshold:
                correlated += 1
        ok = correlated < self.config.max_correlated_positions
        if not ok:
            logger.info("Filtr korelacji: {} skorelowanych pozycji", correlated)
        return ok

    # -------------------------------------------------------------- sizing
    def estimate_kelly(self) -> float:
        """Pol-Kelly z historii; konserwatywny default przy malej probie."""
        if len(self._wins) + len(self._losses) < 20:
            # brak historii: zakladamy win rate 45% i R:R = rr_min (1:2)
            f = kelly_fraction(0.45, self.config.rr_min, 1.0)
        else:
            win_rate = len(self._wins) / (len(self._wins) + len(self._losses))
            avg_win = sum(self._wins) / len(self._wins) if self._wins else 0.0
            avg_loss = sum(self._losses) / len(self._losses) if self._losses else 1.0
            f = kelly_fraction(win_rate, avg_win, avg_loss)
        return min(f * self.config.kelly_fraction, self.config.max_position_pct)

    def plan_trade(
        self,
        symbol: str,
        direction: Direction,
        df: pd.DataFrame,
        structure_stop: Optional[float] = None,
    ) -> Optional[TradePlan]:
        """Buduje plan transakcji lub None, gdy filtry blokuja wejscie.

        Args:
            structure_stop: poziom SL z formacji (np. pod neckline);
                wybierany jest CIASNIEJSZY z {ATR stop, structure stop}.
        """
        if direction == Direction.HOLD:
            return None
        if self.halted_until_next_day:
            logger.debug("Handel wstrzymany (dzienny limit strat)")
            return None
        if not self.volatility_ok(df):
            return None

        entry = float(df["close"].iloc[-1])
        atr_value = float(atr(df, 14).iloc[-1])
        if not atr_value > 0:
            return None
        atr_stop = entry - direction * self.config.atr_stop_multiplier * atr_value

        stop = atr_stop
        if structure_stop is not None:
            valid = structure_stop < entry if direction == Direction.LONG else structure_stop > entry
            if valid:
                stop = max(atr_stop, structure_stop) if direction == Direction.LONG else min(atr_stop, structure_stop)

        risk_per_unit = abs(entry - stop)
        if risk_per_unit <= 0:
            return None
        take_profit = entry + direction * self.config.rr_min * risk_per_unit

        fraction = self.estimate_kelly()
        if fraction <= 0:
            return None
        risk_amount = self.capital * fraction
        quantity = risk_amount / risk_per_unit
        # cap notional: pozycja nie moze przekroczyc kapitalu
        max_quantity = self.capital / entry
        quantity = min(quantity, max_quantity)
        if quantity <= 0:
            return None

        return TradePlan(
            symbol=symbol,
            direction=direction,
            quantity=quantity,
            entry_price=entry,
            stop_loss=stop,
            take_profit=take_profit,
            risk_amount=risk_amount,
            reason=f"kelly={fraction:.4f} atr={atr_value:.4f}",
        )

    # ------------------------------------------------------------ trailing
    def update_trailing(self, position: Position, price: float, atr_value: float) -> Position:
        """Aktywuje i przesuwa trailing stop po osiagnieciu 1R zysku."""
        r = position.unrealized_r(price)
        if not position.trailing_active and r >= self.config.trailing_activation_r:
            position.trailing_active = True
            position.trailing_stop = position.entry_price  # break-even
            logger.debug("Trailing aktywny dla {} @ {:.2f}", position.symbol, price)
        if position.trailing_active:
            candidate = price - position.direction * self.config.atr_stop_multiplier * atr_value
            if position.trailing_stop is None:
                position.trailing_stop = candidate
            elif position.direction == Direction.LONG:
                position.trailing_stop = max(position.trailing_stop, candidate)
            else:
                position.trailing_stop = min(position.trailing_stop, candidate)
        return position

    def effective_stop(self, position: Position) -> float:
        """Aktualny stop: trailing (jesli aktywny) albo pierwotny SL."""
        if position.trailing_active and position.trailing_stop is not None:
            if position.direction == Direction.LONG:
                return max(position.stop_loss, position.trailing_stop)
            return min(position.stop_loss, position.trailing_stop)
        return position.stop_loss
