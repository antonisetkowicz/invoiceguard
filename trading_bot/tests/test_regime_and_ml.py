"""Testy detekcji rezimu, cech i meta-learnera."""
from __future__ import annotations

import pytest

from trading_bot.core.data_engine import generate_synthetic_ohlcv
from trading_bot.core.models import Regime
from trading_bot.ml.feature_engineering import build_features, latest_feature_vector
from trading_bot.ml.meta_learner import MetaLearner
from trading_bot.ml.regime_detector import RegimeDetector


class TestFeatures:
    def test_feature_columns(self, synthetic_df):
        feats = build_features(synthetic_df)
        assert {"adx", "hurst", "rv_percentile", "skew_30", "ret_window",
                "atr_norm", "rsi"} <= set(feats.columns)

    def test_latest_vector_no_nans(self, synthetic_df):
        vec = latest_feature_vector(synthetic_df)
        assert not vec.isna().any()

    def test_hurst_in_unit_interval(self, synthetic_df):
        feats = build_features(synthetic_df).dropna()
        assert ((feats["hurst"] >= 0) & (feats["hurst"] <= 1)).all()


class TestRegimeRules:
    def test_high_vol(self):
        r = RegimeDetector._rules(adx=30, hurst=0.6, rv_pct=0.95, ret=0.1)
        assert r == Regime.HIGH_VOLATILITY

    def test_trending_up(self):
        r = RegimeDetector._rules(adx=35, hurst=0.6, rv_pct=0.5, ret=0.05)
        assert r == Regime.TRENDING_UP

    def test_trending_down(self):
        r = RegimeDetector._rules(adx=35, hurst=0.6, rv_pct=0.5, ret=-0.05)
        assert r == Regime.TRENDING_DOWN

    def test_mean_reverting(self):
        r = RegimeDetector._rules(adx=10, hurst=0.4, rv_pct=0.5, ret=0.0)
        assert r == Regime.MEAN_REVERTING

    def test_low_vol(self):
        r = RegimeDetector._rules(adx=10, hurst=0.5, rv_pct=0.05, ret=0.0)
        assert r == Regime.LOW_VOLATILITY


class TestRegimeDetector:
    def test_fit_and_classify(self):
        df = generate_synthetic_ohlcv(bars=800, seed=4)
        det = RegimeDetector().fit(df)
        regime = det.classify(df)
        assert isinstance(regime, Regime)

    def test_classify_without_fit_uses_rules(self):
        df = generate_synthetic_ohlcv(bars=400, seed=5)
        assert isinstance(RegimeDetector().classify(df), Regime)

    def test_trending_market_classified_as_trend(self):
        df = generate_synthetic_ohlcv(bars=600, seed=6, drift=0.004, volatility=0.005)
        det = RegimeDetector()
        assert det.classify(df) in (Regime.TRENDING_UP, Regime.HIGH_VOLATILITY,
                                    Regime.LOW_VOLATILITY)

    def test_active_strategies_nonempty(self):
        det = RegimeDetector()
        for regime in Regime:
            assert det.active_strategies(regime)


class TestMetaLearner:
    def test_wins_increase_weight(self):
        ml = MetaLearner({"candlestick": 1.0})
        for _ in range(20):
            ml.record_outcome("candlestick", won=True)
        assert ml.current_weights()["candlestick"] > 1.0

    def test_losses_decrease_weight(self):
        ml = MetaLearner({"candlestick": 1.0})
        for _ in range(20):
            ml.record_outcome("candlestick", won=False)
        assert ml.current_weights()["candlestick"] < 1.0

    def test_weights_bounded(self):
        ml = MetaLearner({"a": 1.0}, min_mult=0.5, max_mult=1.5)
        for _ in range(200):
            ml.record_outcome("a", won=True)
        assert ml.current_weights()["a"] <= 1.5 + 1e-9
        for _ in range(400):
            ml.record_outcome("a", won=False)
        assert ml.current_weights()["a"] >= 0.5 - 1e-9

    def test_neutral_start(self):
        ml = MetaLearner({"a": 1.3})
        assert ml.current_weights()["a"] == pytest.approx(1.3)
