"""Klasyfikacja rezimu rynku: K-Means (domyslnie) z fallbackiem regulowym.

Rezimy: trending_up / trending_down / mean_reverting / high_volatility /
low_volatility. Klastry K-Means sa mapowane na rezimy po centroidach
(interpretowalne etykiety zamiast surowych numerow klastrow).

Przyklad:
    >>> from trading_bot.core.data_engine import generate_synthetic_ohlcv
    >>> from trading_bot.ml.regime_detector import RegimeDetector
    >>> det = RegimeDetector()
    >>> df = generate_synthetic_ohlcv(500, seed=2, drift=0.003)
    >>> det.fit(df).classify(df)  # doctest: +SKIP
    <Regime.TRENDING_UP: 'trending_up'>
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from loguru import logger
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

from trading_bot.core.config import RegimeConfig
from trading_bot.core.models import Regime
from trading_bot.ml.feature_engineering import build_features, latest_feature_vector

_FEATURES = ["adx", "hurst", "rv_percentile", "skew_30", "ret_window"]


class RegimeDetector:
    """Detektor rezimu z K-Means + heurystyczne mapowanie klastrow."""

    def __init__(self, config: Optional[RegimeConfig] = None) -> None:
        self.config = config or RegimeConfig()
        self._scaler = StandardScaler()
        self._model: Optional[KMeans] = None
        self._cluster_to_regime: dict[int, Regime] = {}

    # ------------------------------------------------------------------ fit
    def fit(self, df: pd.DataFrame) -> "RegimeDetector":
        """Trenuje K-Means na cechach historii i mapuje klastry na rezimy."""
        feats = build_features(df, self.config.feature_window)[_FEATURES].dropna()
        if len(feats) < self.config.n_regimes * 10:
            logger.warning("Za malo danych do K-Means ({}), zostaje fallback regulowy", len(feats))
            return self
        X = self._scaler.fit_transform(feats)
        self._model = KMeans(n_clusters=self.config.n_regimes, n_init=10, random_state=42)
        labels = self._model.fit_predict(X)
        self._cluster_to_regime = self._map_clusters(feats, labels)
        return self

    def _map_clusters(self, feats: pd.DataFrame, labels: np.ndarray) -> dict[int, Regime]:
        """Etykietuje klastry po srednich cechach centroidu."""
        mapping: dict[int, Regime] = {}
        stats = feats.assign(cluster=labels).groupby("cluster").mean()
        vol_median = stats["rv_percentile"].median()
        for cluster, row in stats.iterrows():
            mapping[int(cluster)] = self._rules(
                adx=row["adx"], hurst=row["hurst"],
                rv_pct=row["rv_percentile"], ret=row["ret_window"],
                vol_reference=vol_median,
            )
        logger.info("Mapowanie klastrow: {}", {k: v.value for k, v in mapping.items()})
        return mapping

    # ------------------------------------------------------------- classify
    def classify(self, df: pd.DataFrame) -> Regime:
        """Klasyfikuje AKTUALNY rezim na podstawie ostatniego wektora cech.

        Uzywa szybkiej sciezki latest_feature_vector (bez rolling Hursta),
        dzieki czemu nadaje sie do wolania w petli bar-po-barze.
        """
        try:
            last = latest_feature_vector(df, self.config.feature_window)[_FEATURES]
        except ValueError:
            return Regime.MEAN_REVERTING
        if last.isna().any():
            return Regime.MEAN_REVERTING
        if self._model is not None:
            X = self._scaler.transform(last.to_frame().T)
            cluster = int(self._model.predict(X)[0])
            return self._cluster_to_regime.get(cluster, Regime.MEAN_REVERTING)
        return self._rules(
            adx=last["adx"], hurst=last["hurst"],
            rv_pct=last["rv_percentile"], ret=last["ret_window"],
        )

    @staticmethod
    def _rules(
        adx: float, hurst: float, rv_pct: float, ret: float, vol_reference: float = 0.5
    ) -> Regime:
        """Deterministyczne reguly klasyfikacji (fallback + etykiety klastrow)."""
        if rv_pct >= max(0.8, vol_reference + 0.25):
            return Regime.HIGH_VOLATILITY
        if rv_pct <= min(0.2, vol_reference - 0.25):
            return Regime.LOW_VOLATILITY
        trending = adx >= 25 or hurst >= 0.55
        if trending and ret > 0:
            return Regime.TRENDING_UP
        if trending and ret < 0:
            return Regime.TRENDING_DOWN
        return Regime.MEAN_REVERTING

    # ------------------------------------------------------------ strategie
    #: strategie rekomendowane per rezim (uzywane przez main do filtracji)
    REGIME_STRATEGIES: dict[Regime, tuple[str, ...]] = {
        # "xauusd" wszedzie: strategia sama adaptuje sie do rezimu przez
        # style sub-sygnalow (breakout=trend, fade/fakeout=mean-reversion)
        Regime.TRENDING_UP: ("chart", "candlestick", "xauusd"),
        Regime.TRENDING_DOWN: ("chart", "candlestick", "xauusd"),
        Regime.MEAN_REVERTING: ("harmonic", "microstructure", "candlestick", "xauusd"),
        Regime.HIGH_VOLATILITY: ("microstructure", "xauusd"),
        Regime.LOW_VOLATILITY: ("harmonic", "chart", "microstructure", "xauusd"),
    }

    def active_strategies(self, regime: Regime) -> tuple[str, ...]:
        """Podzbior strategii pasujacych do rezimu."""
        return self.REGIME_STRATEGIES.get(regime, ("candlestick",))
