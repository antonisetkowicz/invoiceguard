using System;
using System.Collections.Generic;

namespace FTMO17.Core
{
    /// <summary>
    /// Optional signal filters. ALL are disabled in the validated final
    /// configuration; definitions here are reasonable interpretations and
    /// were not part of the validation — re-validate before enabling any.
    /// </summary>
    public static class Filters
    {
        /// <summary>Bullish/bearish pin bar or engulfing on the signal bar.</summary>
        public static bool CandleConfirm(IReadOnlyList<Bar> bars, int i, bool isLong)
        {
            var b = bars[i];
            double range = b.Range;
            if (range <= 0) return false;

            if (isLong)
            {
                double lowerWick = Math.Min(b.Open, b.Close) - b.Low;
                bool pin = lowerWick >= 2 * b.Body && lowerWick >= 0.5 * range;
                bool engulf = i >= 1 && b.IsBullish && bars[i - 1].IsBearish
                              && b.Open <= Math.Min(bars[i - 1].Open, bars[i - 1].Close)
                              && b.Close >= Math.Max(bars[i - 1].Open, bars[i - 1].Close);
                return pin || engulf;
            }
            else
            {
                double upperWick = b.High - Math.Max(b.Open, b.Close);
                bool pin = upperWick >= 2 * b.Body && upperWick >= 0.5 * range;
                bool engulf = i >= 1 && b.IsBearish && bars[i - 1].IsBullish
                              && b.Open >= Math.Max(bars[i - 1].Open, bars[i - 1].Close)
                              && b.Close <= Math.Min(bars[i - 1].Open, bars[i - 1].Close);
                return pin || engulf;
            }
        }

        /// <summary>
        /// BOS/CHOCH in trade direction within the last 'lookback' closed bars
        /// (window ends at the signal bar): some close breaks the most recent
        /// confirmed swing high (long) / low (short) as known at that bar.
        /// </summary>
        public static bool BosAfterSweep(IReadOnlyList<Bar> bars, int i, bool isLong,
                                         LiquidityTracker liquidity, int lookback)
        {
            for (int k = Math.Max(0, i - lookback + 1); k <= i; k++)
            {
                if (isLong)
                {
                    var level = liquidity.LastConfirmedHigh(k);
                    if (level.HasValue && bars[k].Close > level.Value) return true;
                }
                else
                {
                    var level = liquidity.LastConfirmedLow(k);
                    if (level.HasValue && bars[k].Close < level.Value) return true;
                }
            }
            return false;
        }

        /// <summary>H4 EMA trend gate. Trend: close &gt; EMA = up, close &lt; EMA = down.</summary>
        public static bool H4TrendOk(H4FilterMode mode, bool isLong, double? h4Close, double? h4Ema)
        {
            if (mode == H4FilterMode.None) return true;
            if (!h4Close.HasValue || !h4Ema.HasValue) return false; // no trend info yet -> block
            int trend = h4Close.Value > h4Ema.Value ? 1 : h4Close.Value < h4Ema.Value ? -1 : 0;
            int dir = isLong ? 1 : -1;
            return mode == H4FilterMode.Align ? trend == dir : trend != -dir;
        }

        /// <summary>Session windows in UTC hours, checked on the signal bar's open time.</summary>
        public static bool SessionOk(SessionFilterMode mode, DateTime barOpenUtc)
        {
            int h = barOpenUtc.Hour;
            switch (mode)
            {
                case SessionFilterMode.None: return true;
                case SessionFilterMode.LondonKillzone: return h >= 7 && h < 10;
                case SessionFilterMode.NyKillzone: return h >= 12 && h < 15;
                case SessionFilterMode.LondonSession: return h >= 7 && h < 16;
                case SessionFilterMode.NySession: return h >= 12 && h < 21;
                case SessionFilterMode.AnyMajor: return h >= 7 && h < 21;
                default: return true;
            }
        }
    }
}
