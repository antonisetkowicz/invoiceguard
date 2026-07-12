using System;
using System.Collections.Generic;
using FTMO17.Core;

namespace FTMO17.Backtest
{
    public sealed class OpenPosition
    {
        public TradeDirection Direction;
        public double Entry, Sl, Tp;
        public DateTime SignalBarOpenUtc, EntryTimeUtc;
        public double RiskAmount;
    }

    public sealed class ClosedTrade
    {
        public TradeDirection Direction;
        public double Entry, Sl, Tp;
        public DateTime SignalBarOpenUtc, EntryTimeUtc, ExitTimeUtc;
        public double R;               // -1 or +RiskReward
        public string ExitReason;      // "SL" or "TP"
        public double BalanceAfter;
    }

    /// <summary>
    /// Causal trade simulator mirroring the bot's execution model:
    ///  - signal at close of M15 bar i -> market entry at the OPEN of the next
    ///    M1 bar (== open of M15 bar i+1 on continuous data),
    ///  - exits evaluated on M1 bars, SL checked FIRST on any bar that touches
    ///    both SL and TP (conservative rule from the spec),
    ///  - entries evaluated at bar open before intra-bar exits of that bar,
    ///  - concurrency limits: MaxConcurrent total / MaxSameDirection per side,
    ///  - fixed fractional risk sizing, balance compounds.
    /// No spread/commission/slippage — cost modelling lives in the Python
    /// validator; this harness exists for SIGNAL PARITY checks.
    /// </summary>
    public sealed class TradeSimulator
    {
        private readonly EngineConfig _cfg;
        private readonly SignalEngine _engine;
        private readonly BarAggregator _m15Agg = new BarAggregator(TimeSpan.FromMinutes(15));
        private readonly BarAggregator _h4Agg = new BarAggregator(TimeSpan.FromHours(4));
        private readonly double _pipSize;
        private readonly double _riskPercent;

        public int MaxConcurrent = 8;
        public int MaxSameDirection = 3;

        public double Balance { get; private set; }
        public readonly List<OpenPosition> Open = new List<OpenPosition>();
        public readonly List<ClosedTrade> Closed = new List<ClosedTrade>();
        public int SignalsRejectedMinSl { get; private set; }
        public int SignalsSkippedConcurrency { get; private set; }

        public TradeSimulator(EngineConfig cfg, double pipSize, double riskPercent, double startBalance)
        {
            _cfg = cfg;
            _engine = new SignalEngine(cfg);
            _pipSize = pipSize;
            _riskPercent = riskPercent;
            Balance = startBalance;
        }

        public void OnM1(DateTime openUtc, double o, double h, double l, double c)
        {
            var h4 = _h4Agg.AddM1(openUtc, o, h, l, c);
            if (h4.HasValue) _engine.OnH4BarClosed(h4.Value);

            var m15 = _m15Agg.AddM1(openUtc, o, h, l, c);
            Signal signal = null;
            if (m15.HasValue) signal = _engine.OnM15BarClosed(m15.Value);

            // the M15 bar closed exactly at this M1 bar's open -> enter here
            if (signal != null) TryOpen(signal, openUtc, o);

            CheckExits(openUtc, h, l);
        }

        private void TryOpen(Signal signal, DateTime entryTimeUtc, double entryPrice)
        {
            if (!signal.TryGetExitPrices(_cfg, entryPrice, _pipSize, out double sl, out double tp))
            {
                SignalsRejectedMinSl++;
                return;
            }

            int sameDir = 0;
            foreach (var p in Open)
                if (p.Direction == signal.Direction) sameDir++;
            if (Open.Count >= MaxConcurrent || sameDir >= MaxSameDirection)
            {
                SignalsSkippedConcurrency++;
                return;
            }

            Open.Add(new OpenPosition
            {
                Direction = signal.Direction,
                Entry = entryPrice,
                Sl = sl,
                Tp = tp,
                SignalBarOpenUtc = signal.SignalBarOpenUtc,
                EntryTimeUtc = entryTimeUtc,
                RiskAmount = Balance * _riskPercent / 100.0
            });
        }

        private void CheckExits(DateTime timeUtc, double high, double low)
        {
            for (int n = Open.Count - 1; n >= 0; n--)
            {
                var p = Open[n];
                bool slHit, tpHit;
                if (p.Direction == TradeDirection.Buy)
                {
                    slHit = low <= p.Sl;
                    tpHit = high >= p.Tp;
                }
                else
                {
                    slHit = high >= p.Sl;
                    tpHit = low <= p.Tp;
                }
                if (!slHit && !tpHit) continue;

                bool isLoss = slHit; // SL first on conflict (conservative spec rule)
                double r = isLoss ? -1.0 : _cfg.RiskReward;
                Balance += r * p.RiskAmount;
                Closed.Add(new ClosedTrade
                {
                    Direction = p.Direction,
                    Entry = p.Entry,
                    Sl = p.Sl,
                    Tp = p.Tp,
                    SignalBarOpenUtc = p.SignalBarOpenUtc,
                    EntryTimeUtc = p.EntryTimeUtc,
                    ExitTimeUtc = timeUtc,
                    R = r,
                    ExitReason = isLoss ? "SL" : "TP",
                    BalanceAfter = Balance
                });
                Open.RemoveAt(n);
            }
        }
    }
}
