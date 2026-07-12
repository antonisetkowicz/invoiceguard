# FTMO17 — Supply/Demand + Liquidity Sweep (cTrader cAlgo bot)

Implementation of the FTMO17 strategy: a liquidity sweep of the most recent
unswept swing high/low that, on the **same closed M15 bar**, touches an active
supply/demand zone in the opposite direction → market entry at the open of the
**next** bar. Fully causal — all state (swings, zones, sweeps, ATR) is
reconstructed bar by bar on closed bars only, exactly as it becomes observable
live.

## Layout

| Project | Purpose |
|---|---|
| `FTMO17.Core` | Pure C# signal engine — no cAlgo dependency. Bars/aggregation, ATR, swings, liquidity sweeps, S/D zones, signal orchestration, optional filters. |
| `FTMO17.Bot` | The cAlgo Robot. Compiles the **same Core source files** into the bot assembly (not a DLL reference), so the `.algo` is self-contained and bot ≡ harness. |
| `FTMO17.Backtest` | Console harness: built-in self-tests + CSV M1 runner producing a trade log for cross-checking against the Python validation engine. |

## Build & test

```bash
dotnet build                                        # builds all three + FTMO17Bot.algo
dotnet run --project FTMO17.Backtest -- selftest    # 23 deterministic engine/simulator tests
```

(On a machine with only the .NET 8 runtime, prefix with `DOTNET_ROLL_FORWARD=Major`.)

## Deploy to cTrader

Either copy `FTMO17.Bot/bin/Debug/net6.0/FTMO17Bot.algo` into cTrader
(double-click installs it), or copy the three `FTMO17.Bot` + `FTMO17.Core`
source files into a cBot project inside the cTrader IDE and build there.

Attach one instance per symbol (EURUSD, GBPUSD, XAUUSD) to **any** chart of
that symbol — the chart timeframe is irrelevant: the bot subscribes to M1 and
builds its own UTC-aligned M15/H4 bars.

## Time handling (the DST fix)

The bot never uses native chart bars. It converts every M1 bar to UTC using
the server↔UTC offset **recomputed on every M1 bar** (`Server.Time −
Server.TimeInUtc`, rounded to whole minutes) — the 2026-07-11 fix: a
startup-cached offset goes stale at each DST transition and shifts every bar
boundary by an hour. The Robot also sets `TimeZone = TimeZones.UTC`, under
which the offset is simply ~0. One residual limitation: **history warmup**
converts old bars with the *current* offset, so bars from before the most
recent DST change may sit an hour off until they age out of the lookback
windows (recency 80 / zone age 200 bars ≈ 2 days of M15). If you restart the
bot right after a DST weekend, expect signal parity to be exact only once the
warmup horizon has refreshed.

## Reconciliation notes vs the Python validator

Interpretation choices that must match the validator — verify these first if
trade logs diverge:

1. **ATR smoothing** — default is Wilder (RMA, seeded with the SMA of the
   first 14 TRs). If the validator uses `tr.rolling(14).mean()`, switch the
   `ATR Smoothing` parameter to `Sma`.
2. **ATR inclusivity** — the ATR used for impulse detection and SL sizing at
   bar *i* **includes** bar *i*'s true range. If the validator uses
   `atr.shift(1)`, signals near the impulse threshold will differ.
3. **Sweep marking** — a reference level is marked *swept* whenever price
   violates it (wick through), even when the close doesn't reclaim it (no
   signal in that case). A full close-through also marks it swept.
4. **Zone lifecycle ordering** — a zone broken by bar *i*'s close was still
   usable for a signal on bar *i* itself; a zone formed on bar *i* is usable
   from *i+1* (strictly-before rule). Touches are counted on bars after
   formation and before the signal bar.
5. **Optional filters** — all OFF in the validated config. The precise
   definitions in `Filters.cs` (pin bar/engulfing, BOS window ending at the
   signal bar, H4 EMA50 seeded with SMA, session hours in UTC) are reasonable
   interpretations and were NOT validated — re-validate before enabling any.

## Execution model

- Signal at close of M15 bar *i* → market order at the open of bar *i+1*
  (first M1 bar of the new period). Never on the signal bar.
- SL = zone bottom − 0.15×ATR (long) / zone top + 0.15×ATR (short); hard
  minimum distance `max(1 pip, 0.3×ATR)` or the signal is **rejected**.
- TP at fixed RR 2.0 from the actual fill. The bot places pip-based SL/TP
  atomically with the order, then re-anchors SL to the absolute zone-based
  price and TP to RR × the actual SL distance from the real fill.
- Sizing: fixed fractional — SL hit loses exactly `Risk % per Trade`
  (default 1.0%) of current balance.
- Limits: max 8 concurrent positions per symbol, max 3 in the same direction.
- Safety nets: −4% equity from UTC-day start blocks new entries until the next
  day; −9% from bot start stops the bot **permanently** (manual restart; open
  positions are left with their SL/TP in place). Note: restarting the bot
  resets the total-loss baseline to current equity.

## Cross-checking against the validator

```bash
dotnet run --project FTMO17.Backtest -- run eurusd_m1.csv \
    --pip 0.0001 --risk 1.0 --balance 100000 --out trades.csv
```

CSV input: `timestamp,open,high,low,close[,volume]`, one **closed M1 bar** per
line, timestamp = bar open time in **UTC**, chronological. A header line is
skipped automatically. For XAUUSD use `--pip 0.01` (or your broker's pip size).

The harness mirrors the bot's execution (entry at next M1 open, M1-precision
exits, SL-first on conflict, concurrency limits) but models **no costs** —
spread/commission/slippage live in the Python validator. Compare the
`trades.csv` signal timestamps/prices against the validator's trade list; they
should match bar for bar on identical M1 input.

> **Status reminder (from the strategy doc):** the DST fix is not yet verified
> on a fresh demo/Strategy Tester run, and the strategy is not approved for
> live deployment. Run the parity check + demo verification first.
