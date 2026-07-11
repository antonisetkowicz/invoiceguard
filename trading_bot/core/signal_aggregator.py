"""Silnik konfluencji - glosowanie wazone sygnalow wielu strategii.

Formula:
    final = suma(w_i * score_i) / suma(w_i)

gdzie w_i = waga_bazowa(strategia)
          * mnoznik_rezimu(styl strategii, aktualny rezim)
          * mnoznik_confidence (0.5 + confidence, zakres 0.5-1.5)

a score_i = kierunek * confidence w [-1, 1].

Po agregacji: kara za sprzeczne sygnaly miedzy timeframe'ami
(final *= 1 - penalty * stopien_konfliktu).

Progi decyzyjne (config.signals):
    final >  long_threshold  -> LONG
    final <  short_threshold -> SHORT
    hold_low <= final <= hold_high -> HOLD
    pozostale -> WEAK (brak akcji, logowane)

Przyklad:
    >>> from trading_bot.core.signal_aggregator import SignalAggregator
    >>> from trading_bot.core.models import Signal, Direction, Regime
    >>> agg = SignalAggregator({"candlestick": 1.0}, {})
    >>> s = Signal("candlestick", "bullish_engulfing", Direction.LONG, 0.9,
    ...            "1h", "BTC/USDT")
    >>> agg.aggregate([s], Regime.TRENDING_UP).decision
    'LONG'
"""
from __future__ import annotations

from dataclasses import dataclass, field

from loguru import logger

from trading_bot.core.config import SignalConfig
from trading_bot.core.models import Direction, Regime, Signal


@dataclass(slots=True)
class AggregatedSignal:
    """Wynik konfluencji dla jednego symbolu."""

    symbol: str
    score: float                 # finalny wynik [-1, 1]
    decision: str                # "LONG" | "SHORT" | "HOLD" | "WEAK"
    regime: Regime
    contributing: list[Signal] = field(default_factory=list)
    conflict_penalty: float = 0.0


class SignalAggregator:
    """Laczy sygnaly strategii w jedna decyzje na symbol."""

    def __init__(
        self,
        strategy_weights: dict[str, float],
        regime_multipliers: dict[str, dict[str, float]],
        config: SignalConfig | None = None,
    ) -> None:
        self.strategy_weights = strategy_weights
        self.regime_multipliers = regime_multipliers
        self.config = config or SignalConfig()

    def aggregate(self, signals: list[Signal], regime: Regime) -> AggregatedSignal:
        """Glosowanie wazone + kara za konflikt miedzy timeframe'ami."""
        symbol = signals[0].symbol if signals else ""
        if not signals:
            return AggregatedSignal(symbol, 0.0, "HOLD", regime)

        num = 0.0
        den = 0.0
        for sig in signals:
            weight = self._weight(sig, regime)
            num += weight * sig.score
            den += weight
        raw = num / den if den else 0.0

        penalty = self._timeframe_conflict(signals)
        final = raw * (1.0 - penalty)
        decision = self._decide(final)
        logger.debug(
            "Konfluencja {}: raw={:.3f} kara={:.2f} final={:.3f} -> {}",
            symbol, raw, penalty, final, decision,
        )
        return AggregatedSignal(
            symbol=symbol,
            score=final,
            decision=decision,
            regime=regime,
            contributing=list(signals),
            conflict_penalty=penalty,
        )

    # ------------------------------------------------------------------
    def _weight(self, sig: Signal, regime: Regime) -> float:
        base = self.strategy_weights.get(sig.strategy, 1.0)
        regime_mult = (
            self.regime_multipliers.get(regime.value, {}).get(sig.style.value, 1.0)
        )
        confidence_mult = 0.5 + sig.confidence  # 0.5 - 1.5
        return base * regime_mult * confidence_mult

    def _timeframe_conflict(self, signals: list[Signal]) -> float:
        """Stopien konfliktu miedzy timeframe'ami [0, 1] * penalty.

        Dla kazdego timeframe liczymy kierunek netto; konflikt = udzial
        par timeframe'ow o przeciwnych kierunkach.
        """
        by_tf: dict[str, float] = {}
        for sig in signals:
            by_tf[sig.timeframe] = by_tf.get(sig.timeframe, 0.0) + sig.score
        directions = [v for v in by_tf.values() if abs(v) > 1e-9]
        if len(directions) < 2:
            return 0.0
        pairs = 0
        conflicts = 0
        for i in range(len(directions)):
            for j in range(i + 1, len(directions)):
                pairs += 1
                if directions[i] * directions[j] < 0:
                    conflicts += 1
        return (conflicts / pairs) * self.config.timeframe_conflict_penalty if pairs else 0.0

    def _decide(self, score: float) -> str:
        cfg = self.config
        if score > cfg.long_threshold:
            return "LONG"
        if score < cfg.short_threshold:
            return "SHORT"
        if cfg.hold_low <= score <= cfg.hold_high:
            return "HOLD"
        return "WEAK"
