using System;
using cAlgo.API;
using cAlgo.API.Internals;
using FTMO17.Core;

namespace cAlgo.Robots
{
    /// <summary>
    /// FTMO17 — Supply/Demand + Liquidity Sweep (M15).
    ///
    /// The bot does NOT use native chart bars: it rebuilds UTC-aligned M15
    /// (and H4) bars from M1, exactly like the Python validation engine
    /// (resample "15min", label="left", closed="left"). The server-to-UTC
    /// offset is recomputed on EVERY M1 bar (the 2026-07-11 DST fix — a
    /// startup-cached offset goes stale after each DST transition and shifts
    /// every bar boundary by an hour).
    ///
    /// Attach to any chart of the traded symbol; the chart timeframe is
    /// irrelevant. Run one instance per symbol (EURUSD, GBPUSD, XAUUSD).
    /// </summary>
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None, AddIndicators = false)]
    public class FTMO17Bot : Robot
    {
        // ---- risk ----
        [Parameter("Risk % per Trade", Group = "Risk", DefaultValue = 1.0, MinValue = 0.1, MaxValue = 5.0, Step = 0.1)]
        public double RiskPercent { get; set; }

        [Parameter("Risk:Reward", Group = "Risk", DefaultValue = 2.0, MinValue = 0.5, Step = 0.1)]
        public double RiskReward { get; set; }

        [Parameter("SL Buffer (x ATR)", Group = "Risk", DefaultValue = 0.15, MinValue = 0.0, Step = 0.05)]
        public double SlBufferAtrMult { get; set; }

        [Parameter("Min SL Distance (x ATR)", Group = "Risk", DefaultValue = 0.3, MinValue = 0.0, Step = 0.05)]
        public double MinSlAtrMult { get; set; }

        [Parameter("Max Concurrent Positions", Group = "Risk", DefaultValue = 8, MinValue = 1)]
        public int MaxConcurrentPositions { get; set; }

        [Parameter("Max Concurrent Same Direction", Group = "Risk", DefaultValue = 3, MinValue = 1)]
        public int MaxConcurrentSameDirection { get; set; }

        [Parameter("Max Daily Loss %", Group = "Risk", DefaultValue = 4.0, MinValue = 0.5, Step = 0.5)]
        public double MaxDailyLossPercent { get; set; }

        [Parameter("Max Total Loss %", Group = "Risk", DefaultValue = 9.0, MinValue = 1.0, Step = 0.5)]
        public double MaxTotalLossPercent { get; set; }

        // ---- strategy ----
        [Parameter("ATR Period", Group = "Strategy", DefaultValue = 14, MinValue = 2)]
        public int AtrPeriod { get; set; }

        [Parameter("ATR Smoothing", Group = "Strategy", DefaultValue = AtrSmoothing.Wilder)]
        public AtrSmoothing AtrSmoothingMode { get; set; }

        [Parameter("Impulse Threshold (x ATR)", Group = "Strategy", DefaultValue = 1.2, MinValue = 0.1, Step = 0.1)]
        public double ImpulseAtrMult { get; set; }

        [Parameter("Impulse Min Body Ratio", Group = "Strategy", DefaultValue = 0.55, MinValue = 0.0, MaxValue = 1.0, Step = 0.05)]
        public double BodyRatioMin { get; set; }

        [Parameter("Max Zone Age (bars)", Group = "Strategy", DefaultValue = 200, MinValue = 1)]
        public int MaxZoneAgeBars { get; set; }

        [Parameter("Max Retests Allowed", Group = "Strategy", DefaultValue = 999, MinValue = 0)]
        public int MaxRetestsAllowed { get; set; }

        [Parameter("Swing Fractal K", Group = "Strategy", DefaultValue = 2, MinValue = 1)]
        public int SwingFractalK { get; set; }

        [Parameter("Liquidity Recency (bars)", Group = "Strategy", DefaultValue = 80, MinValue = 5)]
        public int RecencyBars { get; set; }

        // ---- optional filters (validated config: ALL OFF) ----
        [Parameter("Require Candle Confirm", Group = "Filters (default OFF)", DefaultValue = false)]
        public bool RequireCandleConfirm { get; set; }

        [Parameter("Require BOS After Sweep", Group = "Filters (default OFF)", DefaultValue = false)]
        public bool RequireBosAfterSweep { get; set; }

        [Parameter("BOS Lookback (bars)", Group = "Filters (default OFF)", DefaultValue = 3, MinValue = 1)]
        public int BosLookbackBars { get; set; }

        [Parameter("H4 Trend Filter", Group = "Filters (default OFF)", DefaultValue = H4FilterMode.None)]
        public H4FilterMode H4Filter { get; set; }

        [Parameter("Session Filter", Group = "Filters (default OFF)", DefaultValue = SessionFilterMode.None)]
        public SessionFilterMode SessionFilter { get; set; }

        private EngineConfig _cfg;
        private SignalEngine _engine;
        private BarAggregator _m15Agg;
        private BarAggregator _h4Agg;
        private Bars _m1;
        private string _label;
        private bool _warmupDone;

        private double _startEquity;
        private double _dayStartEquity;
        private DateTime _currentUtcDate;
        private bool _dailyBlocked;
        private bool _hardStopped;

        protected override void OnStart()
        {
            _cfg = new EngineConfig
            {
                AtrPeriod = AtrPeriod,
                AtrSmoothing = AtrSmoothingMode,
                ImpulseAtrMult = ImpulseAtrMult,
                BodyRatioMin = BodyRatioMin,
                MaxZoneAgeBars = MaxZoneAgeBars,
                MaxRetestsAllowed = MaxRetestsAllowed,
                SwingFractalK = SwingFractalK,
                RecencyBars = RecencyBars,
                RiskReward = RiskReward,
                SlBufferAtrMult = SlBufferAtrMult,
                MinSlAtrMult = MinSlAtrMult,
                RequireCandleConfirm = RequireCandleConfirm,
                RequireBosAfterSweep = RequireBosAfterSweep,
                BosLookbackBars = BosLookbackBars,
                H4Filter = H4Filter,
                SessionFilter = SessionFilter
            };

            _engine = new SignalEngine(_cfg);
            _m15Agg = new BarAggregator(TimeSpan.FromMinutes(15));
            _h4Agg = new BarAggregator(TimeSpan.FromHours(4));
            _label = "FTMO17-" + SymbolName;

            _startEquity = Account.Equity;
            _dayStartEquity = Account.Equity;
            _currentUtcDate = Server.TimeInUtc.Date;

            _m1 = MarketData.GetBars(TimeFrame.Minute);

            // enough M1 history for ATR warmup + recency window + max zone age
            // on M15 (~300 bars = ~4500 M1), plus H4 EMA50 when that filter is on
            int neededM1 = (AtrPeriod + RecencyBars + MaxZoneAgeBars + 20) * 15;
            if (H4Filter != H4FilterMode.None)
                neededM1 = Math.Max(neededM1, (_cfg.H4EmaPeriod + 5) * 240);
            int guard = 0;
            while (_m1.Count < neededM1 && guard++ < 100)
            {
                int before = _m1.Count;
                _m1.LoadMoreHistory();
                if (_m1.Count == before) break;
            }

            // Warm up the engine on history. NOTE: history is converted with the
            // CURRENT server-UTC offset; bars from before the most recent DST
            // transition may be shifted by 1h until they age out of the windows.
            for (int i = 0; i < _m1.Count - 1; i++)
                FeedM1(_m1[i], execute: false);
            _warmupDone = true;

            _m1.BarOpened += OnM1BarOpened;

            Print("FTMO17 started. Label={0}, warmup M1 bars={1}, M15 bars built={2}, equity={3:F2}",
                _label, _m1.Count, _engine.BarCount, _startEquity);
        }

        private void OnM1BarOpened(BarOpenedEventArgs args)
        {
            if (_hardStopped) return;
            // the bar that just CLOSED is one behind the newly opened bar
            if (args.Bars.Count < 2) return;
            FeedM1(args.Bars.Last(1), execute: true);
        }

        /// <summary>
        /// Server-to-UTC offset, recomputed on every call (2026-07-11 DST fix).
        /// Rounded to whole minutes to absorb clock jitter between the two reads.
        /// </summary>
        private TimeSpan CurrentServerUtcOffset()
        {
            var raw = Server.Time - Server.TimeInUtc;
            return TimeSpan.FromMinutes(Math.Round(raw.TotalMinutes));
        }

        private void FeedM1(cAlgo.API.Bar m1, bool execute)
        {
            var utcOpen = m1.OpenTime - CurrentServerUtcOffset();

            var h4 = _h4Agg.AddM1(utcOpen, m1.Open, m1.High, m1.Low, m1.Close);
            if (h4.HasValue) _engine.OnH4BarClosed(h4.Value);

            var m15 = _m15Agg.AddM1(utcOpen, m1.Open, m1.High, m1.Low, m1.Close);
            if (!m15.HasValue) return;

            var signal = _engine.OnM15BarClosed(m15.Value);
            if (signal == null || !execute || !_warmupDone) return;

            // we are at the open of the bar AFTER the signal bar — execute now
            ExecuteSignal(signal);
        }

        private void ExecuteSignal(Signal signal)
        {
            if (!RiskGatesOpen()) return;

            var tradeType = signal.Direction == TradeDirection.Buy ? TradeType.Buy : TradeType.Sell;

            int total = 0, sameDir = 0;
            foreach (var p in Positions.FindAll(_label, SymbolName))
            {
                total++;
                if (p.TradeType == tradeType) sameDir++;
            }
            if (total >= MaxConcurrentPositions)
            {
                Print("Signal skipped: max concurrent positions ({0}) reached.", MaxConcurrentPositions);
                return;
            }
            if (sameDir >= MaxConcurrentSameDirection)
            {
                Print("Signal skipped: max same-direction positions ({0}) reached.", MaxConcurrentSameDirection);
                return;
            }

            double entryRef = tradeType == TradeType.Buy ? Symbol.Ask : Symbol.Bid;
            if (!signal.TryGetExitPrices(_cfg, entryRef, Symbol.PipSize, out double sl, out double tp))
            {
                Print("Signal REJECTED: SL distance below max(1 pip, {0} x ATR). ATR={1}", MinSlAtrMult, signal.Atr);
                return;
            }

            double slPips = Math.Abs(entryRef - sl) / Symbol.PipSize;
            double tpPips = RiskReward * slPips;
            double riskAmount = Account.Balance * RiskPercent / 100.0;
            double volume = Symbol.NormalizeVolumeInUnits(riskAmount / (slPips * Symbol.PipValue), RoundingMode.Down);
            if (volume < Symbol.VolumeInUnitsMin)
            {
                Print("Signal skipped: computed volume {0} below minimum {1}.", volume, Symbol.VolumeInUnitsMin);
                return;
            }
            volume = Math.Min(volume, Symbol.VolumeInUnitsMax);

            var result = ExecuteMarketOrder(tradeType, SymbolName, volume, _label,
                Math.Round(slPips, 1), Math.Round(tpPips, 1));
            if (!result.IsSuccessful)
            {
                Print("Order FAILED: {0}", result.Error);
                return;
            }

            // Re-anchor exits: SL at the absolute zone-based price, TP at
            // RR x actual SL distance from the REAL fill price.
            var pos = result.Position;
            double dist = tradeType == TradeType.Buy ? pos.EntryPrice - sl : sl - pos.EntryPrice;
            if (dist > 0)
            {
                double tpAbs = tradeType == TradeType.Buy
                    ? pos.EntryPrice + RiskReward * dist
                    : pos.EntryPrice - RiskReward * dist;
                pos.ModifyStopLossPrice(Math.Round(sl, Symbol.Digits));
                pos.ModifyTakeProfitPrice(Math.Round(tpAbs, Symbol.Digits));
            }

            Print("{0} {1} vol={2} entry={3} SL={4} TP={5} (zone {6}-{7}, ATR {8})",
                tradeType, SymbolName, volume, pos.EntryPrice, sl, tp,
                signal.ZoneBottom, signal.ZoneTop, signal.Atr);
        }

        /// <summary>Daily 4% / total 9% equity safety nets (independent of signal logic).</summary>
        private bool RiskGatesOpen()
        {
            var utcDate = Server.TimeInUtc.Date;
            if (utcDate != _currentUtcDate)
            {
                _currentUtcDate = utcDate;
                _dayStartEquity = Account.Equity;
                _dailyBlocked = false;
            }

            if (Account.Equity <= _startEquity * (1 - MaxTotalLossPercent / 100.0))
            {
                _hardStopped = true;
                Print("MAX TOTAL LOSS {0}% breached (equity {1:F2} / start {2:F2}). Bot stopped PERMANENTLY — manual restart required.",
                    MaxTotalLossPercent, Account.Equity, _startEquity);
                Stop();
                return false;
            }

            if (_dailyBlocked) return false;
            if (Account.Equity <= _dayStartEquity * (1 - MaxDailyLossPercent / 100.0))
            {
                _dailyBlocked = true;
                Print("MAX DAILY LOSS {0}% breached (equity {1:F2} / day start {2:F2}). New entries blocked until next UTC day.",
                    MaxDailyLossPercent, Account.Equity, _dayStartEquity);
                return false;
            }

            return true;
        }
    }
}
