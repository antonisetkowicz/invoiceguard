using System;
using System.Collections.Generic;

namespace FTMO17.Core
{
    public enum AtrSmoothing
    {
        /// <summary>Wilder RMA: seed = SMA of first N TRs, then atr = (prev*(N-1)+tr)/N.</summary>
        Wilder,
        /// <summary>Simple rolling mean of the last N true ranges (pandas tr.rolling(N).mean()).</summary>
        Sma
    }

    /// <summary>
    /// ATR over closed bars. Value after Update(bar i) INCLUDES bar i's true
    /// range — the standard inclusive convention. If the Python validator
    /// uses atr.shift(1) for impulse detection, reconcile there.
    /// </summary>
    public sealed class Atr
    {
        private readonly int _period;
        private readonly AtrSmoothing _smoothing;
        private readonly Queue<double> _window = new Queue<double>();
        private double _sum;
        private double _wilder;
        private int _count;
        private double _prevClose;
        private bool _hasPrev;

        public Atr(int period, AtrSmoothing smoothing)
        {
            if (period < 1) throw new ArgumentOutOfRangeException(nameof(period));
            _period = period;
            _smoothing = smoothing;
        }

        /// <summary>Current ATR, or null until 'period' true ranges have been seen.</summary>
        public double? Value { get; private set; }

        public void Update(in Bar bar)
        {
            double tr = bar.High - bar.Low;
            if (_hasPrev)
            {
                tr = Math.Max(tr, Math.Max(Math.Abs(bar.High - _prevClose), Math.Abs(bar.Low - _prevClose)));
            }
            _prevClose = bar.Close;
            _hasPrev = true;
            _count++;

            if (_smoothing == AtrSmoothing.Sma)
            {
                _window.Enqueue(tr);
                _sum += tr;
                if (_window.Count > _period) _sum -= _window.Dequeue();
                Value = _window.Count == _period ? _sum / _period : (double?)null;
            }
            else
            {
                if (_count <= _period)
                {
                    _sum += tr;
                    if (_count == _period)
                    {
                        _wilder = _sum / _period;
                        Value = _wilder;
                    }
                }
                else
                {
                    _wilder = (_wilder * (_period - 1) + tr) / _period;
                    Value = _wilder;
                }
            }
        }
    }
}
