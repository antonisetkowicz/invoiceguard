using System.Collections.Generic;

namespace FTMO17.Core
{
    public enum ZoneType { Demand, Supply }

    public sealed class Zone
    {
        public ZoneType Type;
        public double Top;
        public double Bottom;
        public int FormedIndex;   // index of the IMPULSE bar (zone known at its close)
        public int Touches;       // touches on bars AFTER formation, before the current bar
        public bool Active = true;
    }

    /// <summary>
    /// Supply/Demand zones, "origin candle" method:
    ///  - impulse bar i: (High-Low) >= ImpulseAtrMult*ATR14 AND |Close-Open| >= BodyRatioMin*(High-Low)
    ///  - zone = FULL [Low, High] range of bar i-1 (the bar BEFORE the impulse)
    ///  - bullish impulse -> DEMAND, bearish -> SUPPLY
    ///  - deactivated when a CLOSE goes through it (demand: Close &lt; Bottom;
    ///    supply: Close &gt; Top), it exceeds MaxZoneAgeBars, or its touch
    ///    count exceeds MaxRetestsAllowed.
    /// </summary>
    public sealed class ZoneTracker
    {
        private readonly EngineConfig _cfg;
        private readonly List<Zone> _zones = new List<Zone>();

        public ZoneTracker(EngineConfig cfg) { _cfg = cfg; }

        private static bool Touches(in Bar bar, Zone z) => bar.Low <= z.Top && bar.High >= z.Bottom;

        /// <summary>
        /// Newest eligible zone for a signal on bar i: formed STRICTLY before i,
        /// still active entering bar i, within age/retest limits, touched by bar i.
        /// </summary>
        public Zone FindSignalZone(ZoneType type, in Bar bar, int barIndex)
        {
            Zone best = null;
            foreach (var z in _zones)
            {
                if (z.Type != type || !z.Active) continue;
                if (z.FormedIndex >= barIndex) continue;
                if (barIndex - z.FormedIndex > _cfg.MaxZoneAgeBars) continue;
                if (z.Touches > _cfg.MaxRetestsAllowed) continue;
                if (!Touches(bar, z)) continue;
                if (best == null || z.FormedIndex > best.FormedIndex) best = z;
            }
            return best;
        }

        /// <summary>
        /// Fold bar i into zone state. Called AFTER signal evaluation for bar i,
        /// so a zone broken by bar i's close was still usable on bar i itself,
        /// and a zone formed on bar i (FormedIndex = i) is only usable from i+1.
        /// </summary>
        public void OnBarClosed(IReadOnlyList<Bar> bars, double? atr)
        {
            int i = bars.Count - 1;
            var bar = bars[i];

            foreach (var z in _zones)
            {
                if (!z.Active) continue;
                if (i - z.FormedIndex > _cfg.MaxZoneAgeBars) { z.Active = false; continue; }
                if (z.FormedIndex < i && Touches(bar, z)) z.Touches++;
                bool broken = z.Type == ZoneType.Demand ? bar.Close < z.Bottom : bar.Close > z.Top;
                if (broken) z.Active = false;
            }

            if (i >= 1 && atr.HasValue && atr.Value > 0)
            {
                double range = bar.Range;
                if (range >= _cfg.ImpulseAtrMult * atr.Value && bar.Body >= _cfg.BodyRatioMin * range)
                {
                    var origin = bars[i - 1];
                    _zones.Add(new Zone
                    {
                        Type = bar.IsBullish ? ZoneType.Demand : ZoneType.Supply,
                        Top = origin.High,
                        Bottom = origin.Low,
                        FormedIndex = i
                    });
                }
            }

            // keep the list bounded: drop zones that can never be eligible again
            if (_zones.Count > 64)
                _zones.RemoveAll(z => !z.Active || i - z.FormedIndex > _cfg.MaxZoneAgeBars);
        }
    }
}
