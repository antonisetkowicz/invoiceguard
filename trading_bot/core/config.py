"""Ladowanie i walidacja konfiguracji (pydantic + YAML).

Przyklad:
    >>> from trading_bot.core.config import load_settings
    >>> cfg = load_settings()
    >>> cfg.signals.long_threshold
    0.6
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, field_validator

_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
_ENV_PREFIX = "TRADINGBOT_"


class DataConfig(BaseModel):
    cache_dir: str = ".cache/ohlcv"
    cache_ttl_minutes: int = Field(30, ge=0)
    max_workers: int = Field(4, ge=1, le=32)
    history_bars: int = Field(5000, ge=100)


class SignalConfig(BaseModel):
    long_threshold: float = Field(0.6, gt=0, le=1)
    short_threshold: float = Field(-0.6, lt=0, ge=-1)
    hold_low: float = -0.2
    hold_high: float = 0.2
    timeframe_conflict_penalty: float = Field(0.5, ge=0, le=1)

    @field_validator("hold_high")
    @classmethod
    def _hold_band_valid(cls, v: float, info) -> float:
        if "hold_low" in info.data and v < info.data["hold_low"]:
            raise ValueError("hold_high < hold_low")
        return v


class RiskConfig(BaseModel):
    initial_capital: float = Field(10000.0, gt=0)
    kelly_fraction: float = Field(0.5, gt=0, le=1)
    max_position_pct: float = Field(0.05, gt=0, le=1)
    atr_stop_multiplier: float = Field(2.0, gt=0)
    rr_min: float = Field(2.0, ge=1)
    trailing_activation_r: float = Field(1.0, gt=0)
    max_daily_loss_pct: float = Field(0.03, gt=0, le=1)
    max_correlated_positions: int = Field(3, ge=1)
    correlation_threshold: float = Field(0.7, ge=0, le=1)
    atr_filter_multiple: float = Field(1.5, gt=0)
    atr_filter_lookback: int = Field(100, ge=10)


class PatternConfig(BaseModel):
    fib_tolerance: float = Field(0.02, gt=0, le=0.1)
    sr_min_touches: int = Field(3, ge=2)
    pivot_window: int = Field(5, ge=2)
    min_confidence: float = Field(0.3, ge=0, le=1)


class BacktestConfig(BaseModel):
    train_months: int = Field(6, ge=1)
    test_months: int = Field(2, ge=1)
    validation_months: int = Field(1, ge=1)
    slippage_market: float = Field(0.0005, ge=0)
    slippage_limit: float = Field(0.0002, ge=0)
    commission: float = Field(0.001, ge=0)
    monte_carlo_runs: int = Field(1000, ge=10)
    report_dir: str = "reports"


class RegimeConfig(BaseModel):
    method: Literal["kmeans", "hmm"] = "kmeans"
    n_regimes: int = Field(5, ge=2, le=10)
    feature_window: int = Field(30, ge=10)


class LoggingConfig(BaseModel):
    level: str = "INFO"
    rotation: str = "10 MB"
    retention: str = "14 days"
    file: str = "logs/bot.log"


class AlertsConfig(BaseModel):
    telegram_enabled: bool = False
    telegram_token: str = ""
    telegram_chat_id: str = ""
    discord_webhook: str = ""


class Settings(BaseModel):
    """Zwalidowana konfiguracja calego bota (config/settings.yaml)."""

    mode: Literal["paper", "live", "backtest"] = "paper"
    symbols: list[str] = ["BTC/USDT"]
    timeframes: list[str] = ["1h", "4h", "1d"]
    data: DataConfig = DataConfig()
    signals: SignalConfig = SignalConfig()
    strategy_weights: dict[str, float] = {}
    regime_multipliers: dict[str, dict[str, float]] = {}
    risk: RiskConfig = RiskConfig()
    patterns: PatternConfig = PatternConfig()
    backtest: BacktestConfig = BacktestConfig()
    regime: RegimeConfig = RegimeConfig()
    logging: LoggingConfig = LoggingConfig()
    alerts: AlertsConfig = AlertsConfig()


class ExchangeConfig(BaseModel):
    ccxt_id: str
    market_type: Literal["spot", "futures", "stocks"] = "spot"
    taker_fee: float = Field(0.001, ge=0)
    maker_fee: float = Field(0.001, ge=0)
    rate_limit_rps: float = Field(10, gt=0)
    api_key: str = ""
    api_secret: str = ""
    sandbox: bool = True


class ExchangesFile(BaseModel):
    default_exchange: str
    exchanges: dict[str, ExchangeConfig]


def _apply_env_overrides(raw: dict, prefix: str = _ENV_PREFIX) -> dict:
    """Nadpisuje wartosci z env: TRADINGBOT_RISK__RR_MIN=3 itd.

    Zagniezdzenie oznaczane podwojnym podkresleniem.
    """
    for key, value in os.environ.items():
        if not key.startswith(prefix):
            continue
        path = key[len(prefix):].lower().split("__")
        node = raw
        for part in path[:-1]:
            node = node.setdefault(part, {})
            if not isinstance(node, dict):
                break
        else:
            node[path[-1]] = yaml.safe_load(value)
    return raw


def load_settings(path: str | Path | None = None) -> Settings:
    """Wczytuje settings.yaml, aplikuje env overrides i waliduje."""
    path = Path(path) if path else _CONFIG_DIR / "settings.yaml"
    raw = yaml.safe_load(path.read_text()) or {}
    raw = _apply_env_overrides(raw)
    return Settings.model_validate(raw)


def load_exchanges(path: str | Path | None = None) -> ExchangesFile:
    """Wczytuje exchanges.yaml (klucze API dolaczane wylacznie z env)."""
    path = Path(path) if path else _CONFIG_DIR / "exchanges.yaml"
    raw = yaml.safe_load(path.read_text()) or {}
    raw = _apply_env_overrides(raw, _ENV_PREFIX)
    return ExchangesFile.model_validate(raw)
