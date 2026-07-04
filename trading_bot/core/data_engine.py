"""Pobieranie i buforowanie danych OHLCV.

- wielowatkowe pobieranie wielu symboli/timeframe'ow (ThreadPoolExecutor),
- cache Parquet (pyarrow) z TTL,
- automatyczne uzupelnianie luk (gap fill),
- wyrownanie multi-timeframe (1m..1d) do wspolnej osi czasu.

ccxt jest importowane leniwie - moduly dzialaja offline (testy, backtest
na danych syntetycznych) bez zainstalowanego ccxt.

Przyklad:
    >>> from trading_bot.core.data_engine import generate_synthetic_ohlcv
    >>> df = generate_synthetic_ohlcv(bars=100, seed=42)
    >>> list(df.columns)
    ['open', 'high', 'low', 'close', 'volume']
"""
from __future__ import annotations

import concurrent.futures as cf
import time
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from loguru import logger

from trading_bot.core.config import DataConfig

TIMEFRAME_MINUTES: dict[str, int] = {
    "1m": 1, "5m": 5, "15m": 15, "30m": 30,
    "1h": 60, "4h": 240, "1d": 1440,
}


def timeframe_to_pandas_freq(timeframe: str) -> str:
    """Mapa timeframe ccxt -> czestotliwosc pandas ('1h' -> '60min')."""
    if timeframe not in TIMEFRAME_MINUTES:
        raise ValueError(f"Nieznany timeframe: {timeframe}")
    return f"{TIMEFRAME_MINUTES[timeframe]}min"


def fill_gaps(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """Uzupelnia brakujace swiece w indeksie czasowym.

    Braki OHLC wypelniane sa poprzednim close (rynek stal), volume zerem.
    """
    if df.empty:
        return df
    freq = timeframe_to_pandas_freq(timeframe)
    full_index = pd.date_range(df.index[0], df.index[-1], freq=freq, tz=df.index.tz)
    out = df.reindex(full_index)
    missing = out["close"].isna()
    if missing.any():
        logger.debug("Gap fill: {} brakujacych swiec", int(missing.sum()))
        out["close"] = out["close"].ffill()
        for col in ("open", "high", "low"):
            out[col] = out[col].fillna(out["close"])
        out["volume"] = out["volume"].fillna(0.0)
    return out


def resample_ohlcv(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """Agreguje OHLCV do wyzszego timeframe'u."""
    freq = timeframe_to_pandas_freq(timeframe)
    out = df.resample(freq).agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    )
    return out.dropna(subset=["close"])


def align_timeframes(frames: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    """Przycina wszystkie timeframe'y do wspolnego zakresu czasowego.

    Gwarantuje, ze sygnaly z roznych interwalow odnosza sie do tego samego
    okresu (bez lookahead na koncach).
    """
    if not frames:
        return frames
    start = max(df.index[0] for df in frames.values() if not df.empty)
    end = min(df.index[-1] for df in frames.values() if not df.empty)
    return {tf: df.loc[(df.index >= start) & (df.index <= end)] for tf, df in frames.items()}


def generate_synthetic_ohlcv(
    bars: int = 1000,
    start_price: float = 100.0,
    volatility: float = 0.02,
    drift: float = 0.0,
    seed: Optional[int] = None,
    freq: str = "1h",
    start: str = "2020-01-01",
) -> pd.DataFrame:
    """Generuje realistyczne dane OHLCV (GBM) do testow i dem.

    Przyklad:
        >>> df = generate_synthetic_ohlcv(bars=50, seed=1)
        >>> len(df)
        50
    """
    rng = np.random.default_rng(seed)
    log_ret = rng.normal(drift, volatility, bars)
    close = start_price * np.exp(np.cumsum(log_ret))
    open_ = np.concatenate([[start_price], close[:-1]])
    spread = np.abs(rng.normal(0, volatility / 2, bars)) * close
    high = np.maximum(open_, close) + spread
    low = np.minimum(open_, close) - spread
    volume = rng.lognormal(mean=10, sigma=0.5, size=bars)
    index = pd.date_range(start, periods=bars, freq=timeframe_to_pandas_freq(freq), tz="UTC")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=index,
    )


class DataEngine:
    """Fasada danych: fetch (ccxt) -> gap fill -> cache Parquet -> align.

    Przyklad (offline, z wstrzyknietym fetcherem):
        >>> import pandas as pd
        >>> eng = DataEngine(DataConfig(cache_dir="/tmp/x"),
        ...                  fetcher=lambda s, tf, n: generate_synthetic_ohlcv(n, seed=0))
        >>> df = eng.get_ohlcv("BTC/USDT", "1h", bars=100)
        >>> len(df)
        100
    """

    def __init__(
        self,
        config: DataConfig,
        exchange_id: str = "binance",
        market_type: str = "spot",
        fetcher=None,
    ) -> None:
        self._config = config
        self._exchange_id = exchange_id
        self._market_type = market_type
        self._fetcher = fetcher  # do testow: (symbol, timeframe, bars) -> DataFrame
        self._cache_dir = Path(config.cache_dir)
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._exchange = None

    # ------------------------------------------------------------------ cache
    def _cache_path(self, symbol: str, timeframe: str) -> Path:
        safe = symbol.replace("/", "-")
        return self._cache_dir / f"{self._exchange_id}_{safe}_{timeframe}.parquet"

    def _read_cache(self, symbol: str, timeframe: str) -> Optional[pd.DataFrame]:
        path = self._cache_path(symbol, timeframe)
        if not path.exists():
            return None
        age_min = (time.time() - path.stat().st_mtime) / 60.0
        if age_min > self._config.cache_ttl_minutes:
            return None
        try:
            return pd.read_parquet(path)
        except Exception as exc:  # uszkodzony plik cache nie moze zabic bota
            logger.warning("Cache nieczytelny ({}): {}", path, exc)
            return None

    def _write_cache(self, df: pd.DataFrame, symbol: str, timeframe: str) -> None:
        df.to_parquet(self._cache_path(symbol, timeframe))

    # ------------------------------------------------------------------ fetch
    def _get_exchange(self):
        if self._exchange is None:
            import ccxt  # import leniwy - opcjonalna zaleznosc

            klass = getattr(ccxt, self._exchange_id)
            self._exchange = klass({"enableRateLimit": True})
        return self._exchange

    def _fetch_remote(self, symbol: str, timeframe: str, bars: int) -> pd.DataFrame:
        if self._fetcher is not None:
            return self._fetcher(symbol, timeframe, bars)
        exchange = self._get_exchange()
        limit = 1000
        ms_per_bar = TIMEFRAME_MINUTES[timeframe] * 60_000
        since = exchange.milliseconds() - bars * ms_per_bar
        rows: list[list[float]] = []
        while len(rows) < bars:
            chunk = exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=limit)
            if not chunk:
                break
            rows.extend(chunk)
            since = chunk[-1][0] + ms_per_bar
            if len(chunk) < limit:
                break
        df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
        df["ts"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
        return df.set_index("ts").tail(bars)

    # ------------------------------------------------------------------ api
    def get_ohlcv(self, symbol: str, timeframe: str, bars: Optional[int] = None) -> pd.DataFrame:
        """Zwraca OHLCV z cache lub z gieldy, zawsze po gap-fillu."""
        bars = bars or self._config.history_bars
        cached = self._read_cache(symbol, timeframe)
        if cached is not None and len(cached) >= bars:
            return cached.tail(bars)
        df = self._fetch_remote(symbol, timeframe, bars)
        df = fill_gaps(df, timeframe)
        self._write_cache(df, symbol, timeframe)
        return df

    def get_multi(
        self, symbols: list[str], timeframes: list[str], bars: Optional[int] = None
    ) -> dict[str, dict[str, pd.DataFrame]]:
        """Rownolegle pobiera wiele symboli x timeframe'ow.

        Zwraca {symbol: {timeframe: DataFrame}} z wyrownanymi zakresami.
        """
        result: dict[str, dict[str, pd.DataFrame]] = {s: {} for s in symbols}
        with cf.ThreadPoolExecutor(max_workers=self._config.max_workers) as pool:
            futures = {
                pool.submit(self.get_ohlcv, s, tf, bars): (s, tf)
                for s in symbols
                for tf in timeframes
            }
            for fut in cf.as_completed(futures):
                sym, tf = futures[fut]
                try:
                    result[sym][tf] = fut.result()
                except Exception as exc:
                    logger.error("Blad pobierania {} {}: {}", sym, tf, exc)
        for sym in result:
            result[sym] = align_timeframes(result[sym])
        return result
