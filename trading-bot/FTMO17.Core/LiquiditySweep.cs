using System.Collections.Generic;

namespace FTMO17.Core
{
    public readonly struct SweepResult
    {
        public readonly bool SweepLow;   // wick below ref low, close back ABOVE it (long setup)
        public readonly bool SweepHigh;  // wick above ref high, close back BELOW it (short setup)

        public SweepResult(bool sweepLow, bool sweepHigh)
        {
            SweepLow = sweepLow;
            SweepHigh = sweepHigh;
        }
    }

    /// <summary>
    /// Tracks liquidity reference levels (most recent UNSWEPT confirmed swing
    /// high/low within the recency window) and detects sweeps on closed bars.
    ///
    /// A level is marked swept as soon as price VIOLATES it (Low &lt; refLow /
    /// High &gt; refHigh) regardless of where the bar closes — once the stops
    /// behind it are taken, the level no longer holds liquidity. It only
    /// produces a signal-grade sweep when the close returns back inside.
    /// </summary>
    public sealed class LiquidityTracker
    {
        private readonly int _recencyBars;
        private readonly List<SwingPoint> _lows = new List<SwingPoint>();
        private readonly List<SwingPoint> _highs = new List<SwingPoint>();

        public LiquidityTracker(int recencyBars) { _recencyBars = recencyBars; }

        public void AddConfirmedSwing(SwingPoint swing)
        {
            (swing.IsHigh ? _highs : _lows).Add(swing);
        }

        private SwingPoint FindReference(List<SwingPoint> list, int currentBarIndex)
        {
            for (int n = list.Count - 1; n >= 0; n--)
            {
                var s = list[n];
                if (currentBarIndex - s.BarIndex > _recencyBars) break; // older entries only get older
                if (!s.Swept && s.ConfirmedAt <= currentBarIndex) return s;
            }
            return null;
        }

        /// <summary>
        /// Evaluate bar i against the current reference levels. Marks violated
        /// levels as swept. Must be called exactly once per closed bar, AFTER
        /// confirming swings for that bar.
        /// </summary>
        public SweepResult OnBarClosed(in Bar bar, int barIndex)
        {
            bool sweepLow = false, sweepHigh = false;

            var refLow = FindReference(_lows, barIndex);
            if (refLow != null && bar.Low < refLow.Price)
            {
                refLow.Swept = true;
                if (bar.Close > refLow.Price) sweepLow = true;
            }

            var refHigh = FindReference(_highs, barIndex);
            if (refHigh != null && bar.High > refHigh.Price)
            {
                refHigh.Swept = true;
                if (bar.Close < refHigh.Price) sweepHigh = true;
            }

            return new SweepResult(sweepLow, sweepHigh);
        }

        /// <summary>Most recent confirmed swing high level as of barIndex (for the BOS filter).</summary>
        public double? LastConfirmedHigh(int barIndex)
        {
            for (int n = _highs.Count - 1; n >= 0; n--)
                if (_highs[n].ConfirmedAt <= barIndex) return _highs[n].Price;
            return null;
        }

        /// <summary>Most recent confirmed swing low level as of barIndex (for the BOS filter).</summary>
        public double? LastConfirmedLow(int barIndex)
        {
            for (int n = _lows.Count - 1; n >= 0; n--)
                if (_lows[n].ConfirmedAt <= barIndex) return _lows[n].Price;
            return null;
        }
    }
}
