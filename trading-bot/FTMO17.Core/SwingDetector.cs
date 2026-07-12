using System.Collections.Generic;

namespace FTMO17.Core
{
    public sealed class SwingPoint
    {
        public int BarIndex;        // index of the swing bar itself
        public int ConfirmedAt;     // BarIndex + K — first bar at which it is usable
        public double Price;
        public bool IsHigh;
        public bool Swept;
    }

    /// <summary>
    /// Fractal swing detection with strict extremes (K bars each side).
    /// Bar j is a swing high iff High[j] is STRICTLY greater than every other
    /// high in [j-K, j+K]; it becomes usable ("confirmed") only at bar j+K.
    /// Note: by the strict-fractal definition, bars j+1..j+K cannot pierce
    /// the swing level, so a level can never be swept before confirmation.
    /// </summary>
    public sealed class SwingDetector
    {
        private readonly int _k;

        public SwingDetector(int k) { _k = k; }

        /// <summary>
        /// Call after bar i has been appended to 'bars'. Checks whether the
        /// candidate at i-K is a swing; returns confirmed swings (0..2).
        /// </summary>
        public IEnumerable<SwingPoint> OnBarClosed(IReadOnlyList<Bar> bars)
        {
            int i = bars.Count - 1;
            int j = i - _k;
            if (j < _k) yield break; // need K bars on both sides

            bool isHigh = true, isLow = true;
            for (int m = j - _k; m <= j + _k; m++)
            {
                if (m == j) continue;
                if (bars[m].High >= bars[j].High) isHigh = false;
                if (bars[m].Low <= bars[j].Low) isLow = false;
                if (!isHigh && !isLow) break;
            }

            if (isHigh)
                yield return new SwingPoint { BarIndex = j, ConfirmedAt = i, Price = bars[j].High, IsHigh = true };
            if (isLow)
                yield return new SwingPoint { BarIndex = j, ConfirmedAt = i, Price = bars[j].Low, IsHigh = false };
        }
    }
}
