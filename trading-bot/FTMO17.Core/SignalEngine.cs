using System;
using System.Collections.Generic;

namespace FTMO17.Core
{
    public enum TradeDirection { Buy, Sell }

    /// <summary>
    /// A signal produced at the CLOSE of M15 bar SignalBarIndex. Execution is
    /// a market order at the OPEN of the NEXT bar — never on the signal bar.
    /// </summary>
    public sealed class Signal
    {
        public TradeDirection Direction;
        public int SignalBarIndex;
        public DateTime SignalBarOpenUtc;
        public double ZoneTop;
        public double ZoneBottom;
        public double Atr;               // ATR14 at the signal bar (for SL buffer / min distance)

        /// <summary>SL price before the entry-based minimum-distance check.</summary>
        public double StopLossPrice(EngineConfig cfg) =>
            Direction == TradeDirection.Buy
                ? ZoneBottom - cfg.SlBufferAtrMult * Atr
                : ZoneTop + cfg.SlBufferAtrMult * Atr;

        /// <summary>
        /// Validates the hard minimum SL distance and computes SL/TP from the
        /// actual entry price. Returns false when the signal must be REJECTED
        /// (SL closer than max(1 pip, MinSlAtrMult*ATR)).
        /// </summary>
        public bool TryGetExitPrices(EngineConfig cfg, double entryPrice, double pipSize,
                                     out double sl, out double tp)
        {
            sl = StopLossPrice(cfg);
            double dist = Direction == TradeDirection.Buy ? entryPrice - sl : sl - entryPrice;
            double minDist = Math.Max(pipSize, cfg.MinSlAtrMult * Atr);
            if (dist < minDist) { tp = 0; return false; }
            tp = Direction == TradeDirection.Buy
                ? entryPrice + cfg.RiskReward * dist
                : entryPrice - cfg.RiskReward * dist;
            return true;
        }
    }

    /// <summary>
    /// Causal, bar-by-bar FTMO17 engine. Feed CLOSED UTC-aligned M15 bars in
    /// order via OnM15BarClosed; feed closed H4 bars via OnH4BarClosed (only
    /// needed when the H4 filter is enabled). Never inspects future bars.
    /// </summary>
    public sealed class SignalEngine
    {
        private readonly EngineConfig _cfg;
        private readonly List<Bar> _bars = new List<Bar>();
        private readonly Atr _atr;
        private readonly SwingDetector _swings;
        private readonly LiquidityTracker _liquidity;
        private readonly ZoneTracker _zones;

        // H4 trend state (optional filter)
        private double? _h4Ema;
        private double? _h4Close;
        private int _h4Count;
        private double _h4SeedSum;

        public SignalEngine(EngineConfig cfg)
        {
            _cfg = cfg;
            _atr = new Atr(cfg.AtrPeriod, cfg.AtrSmoothing);
            _swings = new SwingDetector(cfg.SwingFractalK);
            _liquidity = new LiquidityTracker(cfg.RecencyBars);
            _zones = new ZoneTracker(cfg);
        }

        public int BarCount => _bars.Count;
        public IReadOnlyList<Bar> Bars => _bars;

        public void OnH4BarClosed(in Bar bar)
        {
            _h4Close = bar.Close;
            _h4Count++;
            if (_h4Count <= _cfg.H4EmaPeriod)
            {
                _h4SeedSum += bar.Close;
                if (_h4Count == _cfg.H4EmaPeriod) _h4Ema = _h4SeedSum / _cfg.H4EmaPeriod;
            }
            else
            {
                double k = 2.0 / (_cfg.H4EmaPeriod + 1);
                _h4Ema = bar.Close * k + _h4Ema.Value * (1 - k);
            }
        }

        /// <summary>Process one closed M15 bar; returns a Signal or null.</summary>
        public Signal OnM15BarClosed(in Bar bar)
        {
            _bars.Add(bar);
            int i = _bars.Count - 1;

            _atr.Update(bar);

            foreach (var swing in _swings.OnBarClosed(_bars))
                _liquidity.AddConfirmedSwing(swing);

            var sweep = _liquidity.OnBarClosed(bar, i);

            Signal signal = null;
            // both directions on one bar -> ambiguous, rejected
            if (sweep.SweepLow != sweep.SweepHigh && _atr.Value.HasValue)
            {
                bool isLong = sweep.SweepLow;
                var zone = _zones.FindSignalZone(isLong ? ZoneType.Demand : ZoneType.Supply, bar, i);
                if (zone != null && PassesFilters(i, isLong))
                {
                    signal = new Signal
                    {
                        Direction = isLong ? TradeDirection.Buy : TradeDirection.Sell,
                        SignalBarIndex = i,
                        SignalBarOpenUtc = bar.OpenTimeUtc,
                        ZoneTop = zone.Top,
                        ZoneBottom = zone.Bottom,
                        Atr = _atr.Value.Value
                    };
                }
            }

            // fold bar i into zone state AFTER signal evaluation:
            // a zone formed on bar i is only usable from i+1 (strictly-before rule)
            _zones.OnBarClosed(_bars, _atr.Value);

            return signal;
        }

        private bool PassesFilters(int i, bool isLong)
        {
            if (_cfg.RequireCandleConfirm && !Filters.CandleConfirm(_bars, i, isLong)) return false;
            if (_cfg.RequireBosAfterSweep && !Filters.BosAfterSweep(_bars, i, isLong, _liquidity, _cfg.BosLookbackBars)) return false;
            if (!Filters.H4TrendOk(_cfg.H4Filter, isLong, _h4Close, _h4Ema)) return false;
            if (!Filters.SessionOk(_cfg.SessionFilter, _bars[i].OpenTimeUtc)) return false;
            return true;
        }
    }
}
