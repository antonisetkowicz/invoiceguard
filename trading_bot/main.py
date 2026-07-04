"""Entry point bota tradingowego.

Uzycie:
    python -m trading_bot.main --mode backtest --symbol BTC/USDT
    python -m trading_bot.main --mode paper
    python -m trading_bot.main --mode backtest --synthetic  # bez sieci

Tryby:
    paper    - symulacja na zywo (domyslny; realne dane, wirtualne srodki),
    live     - realne zlecenia; kazda transakcja wymaga potwierdzenia [y/N],
    backtest - walk-forward + raport HTML w reports/.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from loguru import logger

from trading_bot.backtest.backtest_engine import BacktestEngine
from trading_bot.backtest.report import generate_html_report
from trading_bot.core.config import Settings, load_settings
from trading_bot.core.data_engine import DataEngine, generate_synthetic_ohlcv
from trading_bot.execution.paper_trader import PaperTrader


def setup_logging(settings: Settings) -> None:
    """Konfiguruje loguru: konsola + plik z rotacja i retencja."""
    logger.remove()
    logger.add(sys.stderr, level=settings.logging.level)
    log_path = Path(settings.logging.file)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logger.add(
        log_path,
        level=settings.logging.level,
        rotation=settings.logging.rotation,
        retention=settings.logging.retention,
    )


def run_backtest(settings: Settings, symbol: str, synthetic: bool) -> None:
    """Walk-forward backtest + raport HTML."""
    if synthetic:
        df = generate_synthetic_ohlcv(bars=8760, seed=42, drift=0.0002,
                                      volatility=0.015, freq="1h")
        logger.info("Dane syntetyczne: {} swiec", len(df))
    else:
        engine_data = DataEngine(settings.data)
        df = engine_data.get_ohlcv(symbol, settings.timeframes[0])
    engine = BacktestEngine(settings)
    result = engine.walk_forward(df, symbol=symbol)
    rep = result.report
    logger.info(
        "Wynik: Sharpe={:.2f} Sortino={:.2f} MaxDD={:.1%} PF={:.2f} WR={:.1%} trades={}",
        rep.sharpe, rep.sortino, rep.max_dd, rep.profit_factor, rep.win_rate, rep.n_trades,
    )
    out = Path(settings.backtest.report_dir) / f"{symbol.replace('/', '-')}_walkforward.html"
    generate_html_report(result, out, title=f"Walk-forward {symbol}")
    logger.info("Raport HTML: {}", out)


def run_paper(settings: Settings, symbol: str, synthetic: bool, max_bars: int = 500) -> None:
    """Paper trading: symulacja pipeline'u na strumieniu swiec."""
    trader = PaperTrader(settings)
    if synthetic:
        df = generate_synthetic_ohlcv(bars=max_bars + 300, seed=7, freq=settings.timeframes[0])
    else:
        engine_data = DataEngine(settings.data)
        df = engine_data.get_ohlcv(symbol, settings.timeframes[0], bars=max_bars + 300)
    warm = 300
    trader.warmup({settings.timeframes[0]: df.iloc[:warm]})
    for i in range(warm, len(df)):
        frames = {settings.timeframes[0]: df.iloc[max(0, i - 300) : i + 1]}
        trader.on_bar(symbol, frames)
    trader.close_all({symbol: float(df["close"].iloc[-1])})
    logger.info("Paper trading zakonczony: kapital={:.2f}, transakcji={}",
                trader.risk.capital, len(trader.trades))


def confirm_live(plan) -> bool:
    """Interaktywne potwierdzenie transakcji w trybie live."""
    answer = input(
        f"Potwierdz {plan.direction.name} {plan.symbol} qty={plan.quantity:.6f} "
        f"@ {plan.entry_price:.2f} SL={plan.stop_loss:.2f} TP={plan.take_profit:.2f} [y/N]: "
    )
    return answer.strip().lower() == "y"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pattern-recognition trading bot")
    parser.add_argument("--mode", choices=["paper", "live", "backtest"], default=None,
                        help="nadpisuje mode z settings.yaml")
    parser.add_argument("--symbol", default=None, help="np. BTC/USDT")
    parser.add_argument("--config", default=None, help="sciezka do settings.yaml")
    parser.add_argument("--synthetic", action="store_true",
                        help="dane syntetyczne zamiast gieldy (offline)")
    args = parser.parse_args(argv)

    settings = load_settings(args.config)
    if args.mode:
        settings = settings.model_copy(update={"mode": args.mode})
    setup_logging(settings)
    symbol = args.symbol or settings.symbols[0]
    logger.info("Start: mode={} symbol={}", settings.mode, symbol)

    if settings.mode == "backtest":
        run_backtest(settings, symbol, args.synthetic)
    elif settings.mode == "paper":
        run_paper(settings, symbol, args.synthetic)
    else:
        logger.error(
            "Tryb live wymaga skonfigurowanych kluczy API (exchanges.yaml + env) "
            "oraz swiadomej zgody - uruchom z wlasnym connectorem i callbackiem "
            "confirm_live(). Zaczynij od trybu paper."
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
