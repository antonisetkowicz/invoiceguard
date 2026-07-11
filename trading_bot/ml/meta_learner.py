"""Meta-learner: dynamiczna adaptacja wag strategii na bazie ich wynikow.

Algorytm: wykladniczo wazona srednia trafnosci (EWMA hit-rate) per
strategia; wagi skalowane wokol wag bazowych w bezpiecznym pasmie
[min_mult, max_mult], zeby zadna strategia nie zostala wylaczona ani
nie zdominowala konfluencji.

Przyklad:
    >>> from trading_bot.ml.meta_learner import MetaLearner
    >>> ml = MetaLearner({"candlestick": 1.0})
    >>> for _ in range(10):
    ...     ml.record_outcome("candlestick", won=True)
    >>> ml.current_weights()["candlestick"] > 1.0
    True
"""
from __future__ import annotations

from loguru import logger


class MetaLearner:
    """Sledzenie skutecznosci strategii i korekta wag konfluencji."""

    def __init__(
        self,
        base_weights: dict[str, float],
        alpha: float = 0.1,
        min_mult: float = 0.5,
        max_mult: float = 1.5,
    ) -> None:
        self.base_weights = dict(base_weights)
        self.alpha = alpha           # szybkosc adaptacji EWMA
        self.min_mult = min_mult
        self.max_mult = max_mult
        # startowy neutralny hit-rate 0.5
        self._hit_rate: dict[str, float] = {k: 0.5 for k in base_weights}

    def record_outcome(self, strategy: str, won: bool) -> None:
        """Aktualizuje EWMA trafnosci strategii po zamknieciu transakcji."""
        prev = self._hit_rate.get(strategy, 0.5)
        self._hit_rate[strategy] = (1 - self.alpha) * prev + self.alpha * (1.0 if won else 0.0)

    def current_weights(self) -> dict[str, float]:
        """Wagi bazowe przeskalowane biezacym hit-rate.

        hit-rate 0.5 -> mnoznik 1.0; 1.0 -> max_mult; 0.0 -> min_mult.
        """
        weights: dict[str, float] = {}
        for strategy, base in self.base_weights.items():
            hr = self._hit_rate.get(strategy, 0.5)
            if hr >= 0.5:
                mult = 1.0 + (hr - 0.5) * 2 * (self.max_mult - 1.0)
            else:
                mult = 1.0 - (0.5 - hr) * 2 * (1.0 - self.min_mult)
            weights[strategy] = base * mult
        logger.debug("Meta-learner wagi: {}", weights)
        return weights

    def hit_rates(self) -> dict[str, float]:
        """Aktualne EWMA hit-rate per strategia (do dashboardu)."""
        return dict(self._hit_rate)
