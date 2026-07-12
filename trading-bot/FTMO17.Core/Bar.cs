using System;

namespace FTMO17.Core
{
    /// <summary>
    /// A closed OHLC bar. OpenTimeUtc is the period START (pandas resample
    /// label="left", closed="left" semantics, matching the Python validator).
    /// </summary>
    public readonly struct Bar
    {
        public DateTime OpenTimeUtc { get; }
        public double Open { get; }
        public double High { get; }
        public double Low { get; }
        public double Close { get; }

        public Bar(DateTime openTimeUtc, double open, double high, double low, double close)
        {
            OpenTimeUtc = openTimeUtc;
            Open = open;
            High = high;
            Low = low;
            Close = close;
        }

        public double Range => High - Low;
        public double Body => Math.Abs(Close - Open);
        public bool IsBullish => Close > Open;
        public bool IsBearish => Close < Open;
    }

    /// <summary>
    /// Builds fixed-period UTC-aligned bars (e.g. M15, H4) from M1 bars.
    /// A bar is emitted as CLOSED only when the first M1 bar of the NEXT
    /// period arrives — identical to how the bar becomes observable live.
    /// Gaps (weekends) simply start a new bucket; no synthetic bars are made.
    /// </summary>
    public sealed class BarAggregator
    {
        private readonly TimeSpan _period;
        private DateTime _bucketStart;
        private double _o, _h, _l, _c;
        private bool _hasBucket;

        public BarAggregator(TimeSpan period)
        {
            if (period <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(period));
            _period = period;
        }

        private DateTime Floor(DateTime t)
        {
            long ticks = t.Ticks - (t.Ticks % _period.Ticks);
            return new DateTime(ticks, DateTimeKind.Utc);
        }

        /// <summary>
        /// Feed one CLOSED M1 bar (openTimeUtc = its UTC open time).
        /// Returns the completed higher-timeframe bar when this M1 bar
        /// starts a new period, otherwise null.
        /// </summary>
        public Bar? AddM1(DateTime openTimeUtc, double open, double high, double low, double close)
        {
            var bucket = Floor(openTimeUtc);
            Bar? completed = null;

            if (!_hasBucket)
            {
                _hasBucket = true;
                _bucketStart = bucket;
                _o = open; _h = high; _l = low; _c = close;
                return null;
            }

            if (bucket != _bucketStart)
            {
                completed = new Bar(_bucketStart, _o, _h, _l, _c);
                _bucketStart = bucket;
                _o = open; _h = high; _l = low; _c = close;
            }
            else
            {
                if (high > _h) _h = high;
                if (low < _l) _l = low;
                _c = close;
            }

            return completed;
        }
    }
}
