"""Silnik backtestu: petla bar-po-barze + walk-forward analysis.

Realizm symulacji:
- wejscie na OTWARCIU nastepnej swiecy po sygnale (zero lookahead),
- slippage: 0.05% market / 0.02% limit (config.backtest),
- prowizja per transakcja (config.backtest.commission),
- SL/TP sprawdzane intrabar na high/low; przy trafieniu obu w jednej
  swiecy konserwatywnie zakladamy najpierw stop loss,
- detekcja na kroczacym oknie ostatnich `lookback` swiec (wydajnosc).

Walk-forward: przesuwne okna train/test/validation (miesiace, config).
Model rezimu trenowany WYLACZNIE na oknie train, oceniany na test.

Przyklad:
    >>> from trading_bot.core.config import load_settings
    >>> from trading_bot.core.data_engine import generate_synthetic_ohlcv
    >>> from trading_bot.backtest.backtest_engine import BacktestEngine
    >>> engine = BacktestEngine(load_settings())
    >>> result = engine.run(generate_synthetic_ohlcv(500, seed=9),
    ...                     symbol="BTC/USDT")  # doctest: +SKIP
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd
from loguru import logger

from trading_bot.backtest.performance_metrics import (
    PerformanceReport,
    compute_report,
    monte_carlo,
)
from trading_bot.core.config import Settings
from trading_bot.core.data_engine import resample_ohlcv
from trading_bot.core.indicators import atr
from trading_bot.core.models import Direction, Position, Regime, Trade
from trading_bot.core.pattern_detector import PatternDetector
from trading_bot.core.risk_manager import RiskManager
from trading_bot.core.signal_aggregator import SignalAggregator
from trading_bot.ml.regime_detector import RegimeDetector


@dataclass(slots=True)
class BacktestResult:
    """Wynik pojedynczego przebiegu backtestu."""

    equity: pd.Series
    trades: list[Trade]
    report: PerformanceReport
    monte_carlo: dict[str, float] = field(default_factory=dict)
    windows: list[dict] = field(default_factory=list)  # wyniki per okno WF


class BacktestEngine:
    """Backtest sygnalowy z pelnym pipeline'em konfluencji i ryzyka."""

    def __init__(
        self,
        settings: Settings,
        detector: Optional[PatternDetector] = None,
        lookback: int = 240,
        higher_timeframes: tuple[str, ...] = ("4h",),
        regime_refresh: int = 24,
    ) -> None:
        self.settings = settings
        self.detector = detector or PatternDetector.from_settings(settings)
        self.lookback = lookback
        self.higher_timeframes = higher_timeframes
        #: co ile swiec odswiezac klasyfikacje rezimu (rezim zmienia sie wolno)
        self.regime_refresh = regime_refresh

    # ------------------------------------------------------------- run
    def run(
        self,
        df: pd.DataFrame,
        symbol: str = "",
        regime_detector: Optional[RegimeDetector] = None,
        with_monte_carlo: bool = True,
    ) -> BacktestResult:
        """Backtest na calym przekazanym DataFrame (bez walk-forward)."""
        cfg = self.settings
        risk = RiskManager(cfg.risk)
        aggregator = SignalAggregator(
            cfg.strategy_weights or {}, cfg.regime_multipliers, cfg.signals
        )
        regime_det = regime_detector or RegimeDetector(cfg.regime)
        atr_series = atr(df, 14)

        capital = cfg.risk.initial_capital
        equity_values: list[float] = []
        trades: list[Trade] = []
        position: Optional[Position] = None
        pending_direction: Optional[Direction] = None
        pending_stop: Optional[float] = None

        higher = {
            tf: resample_ohlcv(df, tf) for tf in self.higher_timeframes
        }

        min_bars = max(s.min_bars for s in self.detector.strategies)
        regime = Regime.MEAN_REVERTING
        for i in range(min_bars, len(df)):
            bar = df.iloc[i]
            ts = df.index[i]
            risk.on_new_bar(ts.to_pydatetime())

            # 1) realizacja wejscia zaplanowanego na poprzedniej swiecy
            if pending_direction is not None and position is None:
                direction = pending_direction
                window_df = df.iloc[max(0, i - self.lookback) : i]
                plan = risk.plan_trade(symbol, direction, window_df, pending_stop)
                if plan is not None:
                    entry = float(bar["open"])
                    slip = entry * cfg.backtest.slippage_market * direction
                    entry += slip
                    stop = entry - direction * abs(plan.entry_price - plan.stop_loss)
                    tp = entry + direction * cfg.risk.rr_min * abs(entry - stop)
                    position = Position(
                        symbol=symbol, direction=direction,
                        quantity=plan.quantity, entry_price=entry,
                        stop_loss=stop, take_profit=tp, opened_at=ts,
                    )
                pending_direction = None
                pending_stop = None

            # 2) zarzadzanie otwarta pozycja (intrabar SL/TP + trailing)
            if position is not None:
                position = risk.update_trailing(
                    position, float(bar["close"]), float(atr_series.iloc[i])
                )
                exit_price, reason = self._check_exit(position, bar, risk)
                if exit_price is not None:
                    trade = self._close(position, exit_price, ts, reason, cfg)
                    trades.append(trade)
                    risk.record_trade(trade.pnl)
                    capital = risk.capital
                    position = None

            # 3) nowe sygnaly (tylko bez otwartej pozycji)
            if position is None and pending_direction is None and not risk.halted_until_next_day:
                window_df = df.iloc[max(0, i - self.lookback) : i + 1]
                frames = {"1h": window_df}
                for tf, hdf in higher.items():
                    frames[tf] = hdf[hdf.index <= ts].tail(self.lookback)
                if (i - min_bars) % self.regime_refresh == 0:
                    regime = self._safe_regime(regime_det, window_df)
                signals = self.detector.detect_all(frames, symbol=symbol)
                active = set(regime_det.active_strategies(regime))
                signals = [s for s in signals if s.strategy in active]
                result = aggregator.aggregate(signals, regime)
                if result.decision == "LONG":
                    pending_direction = Direction.LONG
                elif result.decision == "SHORT":
                    pending_direction = Direction.SHORT

            mark = float(bar["close"])
            unrealized = (
                (mark - position.entry_price) * position.direction * position.quantity
                if position is not None else 0.0
            )
            equity_values.append(risk.capital + unrealized)

        equity = pd.Series(equity_values, index=df.index[min_bars:], name="equity")
        periods = self._periods_per_year(df)
        report = compute_report(equity, trades, periods_per_year=periods)
        mc = (
            monte_carlo(trades, cfg.risk.initial_capital, cfg.backtest.monte_carlo_runs)
            if with_monte_carlo else {}
        )
        return BacktestResult(equity=equity, trades=trades, report=report, monte_carlo=mc)

    # ----------------------------------------------------------- helpers
    @staticmethod
    def _safe_regime(det: RegimeDetector, df: pd.DataFrame) -> Regime:
        try:
            return det.classify(df)
        except Exception:
            return Regime.MEAN_REVERTING

    @staticmethod
    def _check_exit(
        position: Position, bar: pd.Series, risk: RiskManager
    ) -> tuple[Optional[float], str]:
        """Intrabar SL/TP; konserwatywnie: stop przed take-profitem."""
        stop = risk.effective_stop(position)
        if position.direction == Direction.LONG:
            if bar["low"] <= stop:
                return stop, "stop_loss"
            if bar["high"] >= position.take_profit:
                return position.take_profit, "take_profit"
        else:
            if bar["high"] >= stop:
                return stop, "stop_loss"
            if bar["low"] <= position.take_profit:
                return position.take_profit, "take_profit"
        return None, ""

    def _close(
        self, position: Position, exit_price: float, ts, reason: str, cfg: Settings
    ) -> Trade:
        slip_pct = cfg.backtest.slippage_market
        slippage = exit_price * slip_pct * position.quantity
        notional = (position.entry_price + exit_price) * position.quantity
        commission = notional * cfg.backtest.commission
        return Trade(
            symbol=position.symbol,
            direction=position.direction,
            quantity=position.quantity,
            entry_price=position.entry_price,
            exit_price=exit_price,
            entry_time=position.opened_at,
            exit_time=ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts,
            commission=commission,
            slippage=slippage,
            exit_reason=reason,
        )

    @staticmethod
    def _periods_per_year(df: pd.DataFrame) -> int:
        if len(df) < 2:
            return 252
        delta = (df.index[1] - df.index[0]).total_seconds()
        return max(int(365 * 24 * 3600 / delta), 1)

    # ------------------------------------------------------ walk-forward
    def walk_forward(
        self, df: pd.DataFrame, symbol: str = ""
    ) -> BacktestResult:
        """Walk-forward: train (fit rezimu) -> test (handel) -> przesun okno.

        Okna wg config.backtest: train_months / test_months /
        validation_months. Wyniki testowe sa sklejane w jedna krzywa.
        """
        cfg = self.settings.backtest
        train = pd.DateOffset(months=cfg.train_months)
        test = pd.DateOffset(months=cfg.test_months)
        validation = pd.DateOffset(months=cfg.validation_months)

        start = df.index[0]
        all_trades: list[Trade] = []
        equity_parts: list[pd.Series] = []
        windows: list[dict] = []

        while start + train + test <= df.index[-1]:
            train_df = df[(df.index >= start) & (df.index < start + train)]
            test_df = df[(df.index >= start + train) & (df.index < start + train + test)]
            if len(test_df) < 50 or len(train_df) < 100:
                break
            regime_det = RegimeDetector(self.settings.regime)
            try:
                regime_det.fit(train_df)
            except Exception as exc:
                logger.warning("Fit rezimu nieudany: {}", exc)
            # kontekst: koncowka train + test, handel liczony tylko na test
            context = pd.concat([train_df.tail(self.lookback), test_df])
            result = self.run(context, symbol=symbol, regime_detector=regime_det,
                              with_monte_carlo=False)
            test_equity = result.equity[result.equity.index >= test_df.index[0]]
            test_trades = [
                t for t in result.trades
                if t.entry_time is not None and t.entry_time >= test_df.index[0]
            ]
            all_trades.extend(test_trades)
            if not test_equity.empty:
                equity_parts.append(test_equity)
            windows.append({
                "train_start": str(start), "test_start": str(start + train),
                "n_trades": len(test_trades),
                "sharpe": result.report.sharpe,
            })
            start = start + test  # przesuniecie o okno testowe

        if equity_parts:
            # sklejenie czesci: normalizacja do ciaglej krzywej kapitalu
            base = self.settings.risk.initial_capital
            chained: list[pd.Series] = []
            for part in equity_parts:
                factor = base / part.iloc[0]
                chained.append(part * factor)
                base = chained[-1].iloc[-1]
            equity = pd.concat(chained)
            equity = equity[~equity.index.duplicated(keep="first")]
        else:
            equity = pd.Series(dtype=float)

        periods = self._periods_per_year(df)
        report = compute_report(equity, all_trades, periods_per_year=periods) if not equity.empty else compute_report(
            pd.Series([self.settings.risk.initial_capital]), all_trades
        )
        mc = monte_carlo(all_trades, self.settings.risk.initial_capital, cfg.monte_carlo_runs)
        logger.info("Walk-forward: {} okien, {} transakcji, Sharpe={:.2f}",
                    len(windows), len(all_trades), report.sharpe)
        return BacktestResult(
            equity=equity, trades=all_trades, report=report,
            monte_carlo=mc, windows=windows,
        )
