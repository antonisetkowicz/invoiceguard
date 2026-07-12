using System;
using System.Collections.Generic;
using FTMO17.Core;

namespace FTMO17.Backtest
{
    /// <summary>
    /// Deterministic engine tests built from handcrafted M15 bar sequences.
    /// The base scenario: 14 warmup bars -> swing low @99.0 (bar 14, confirmed
    /// bar 16) -> demand zone [99.8, 100.4] from origin bar 17 / impulse bar 18
    /// -> sweep-and-reclaim of 99.0 on bar 22 while touching the zone
    /// => Buy signal at the close of bar 22, entry at the open of bar 23.
    /// </summary>
    public static class SelfTest
    {
        private static int _failures;
        private static readonly DateTime T0 = new DateTime(2026, 1, 5, 0, 0, 0, DateTimeKind.Utc);

        private static void Check(bool ok, string name)
        {
            Console.WriteLine("{0} {1}", ok ? "PASS" : "FAIL", name);
            if (!ok) _failures++;
        }

        private static Bar B(int idx, double o, double h, double l, double c) =>
            new Bar(T0.AddMinutes(15 * idx), o, h, l, c);

        /// <summary>Bars 0..22 of the base long scenario (M15).</summary>
        private static List<Bar> LongScenario()
        {
            var bars = new List<Bar>();
            for (int i = 0; i < 14; i++) bars.Add(B(i, 100.0, 100.6, 99.6, 100.1)); // ATR14 -> 1.0
            bars.Add(B(14, 100.1, 100.6, 99.0, 100.0));   // swing low 99.0
            bars.Add(B(15, 100.0, 100.6, 99.6, 100.1));
            bars.Add(B(16, 100.0, 100.6, 99.6, 100.1));   // swing low confirmed here
            bars.Add(B(17, 100.1, 100.4, 99.8, 100.2));   // origin candle -> zone [99.8, 100.4]
            bars.Add(B(18, 100.2, 101.9, 100.1, 101.8));  // bullish impulse -> DEMAND zone formed
            bars.Add(B(19, 101.8, 101.85, 100.9, 101.0));
            bars.Add(B(20, 101.0, 101.1, 100.5, 100.6));  // bar-18 swing high (101.9) confirmed here
            bars.Add(B(21, 100.6, 100.7, 100.2, 100.45));
            bars.Add(B(22, 100.4, 100.45, 98.8, 99.9));   // sweeps 99.0, closes back above, touches zone
            return bars;
        }

        private static Bar Mirror(Bar b) =>
            new Bar(b.OpenTimeUtc, 200 - b.Open, 200 - b.Low, 200 - b.High, 200 - b.Close);

        private static Signal RunEngine(IEnumerable<Bar> bars, out List<int> signalBars, EngineConfig cfg = null)
        {
            var engine = new SignalEngine(cfg ?? new EngineConfig());
            Signal last = null;
            signalBars = new List<int>();
            int i = 0;
            foreach (var b in bars)
            {
                var s = engine.OnM15BarClosed(b);
                if (s != null) { last = s; signalBars.Add(i); }
                i++;
            }
            return last;
        }

        public static int Run()
        {
            var cfg = new EngineConfig();

            // ---- 1. long signal fires on the right bar, with the right anatomy ----
            var sig = RunEngine(LongScenario(), out var sigBars);
            Check(sigBars.Count == 1 && sigBars[0] == 22, "long: exactly one signal, at bar 22");
            Check(sig != null && sig.Direction == TradeDirection.Buy, "long: direction is Buy");
            Check(sig != null && Math.Abs(sig.ZoneBottom - 99.8) < 1e-9 && Math.Abs(sig.ZoneTop - 100.4) < 1e-9,
                "long: zone bounds are the ORIGIN candle's [Low, High]");
            Check(sig != null && Math.Abs(sig.Atr - 1.032219) < 1e-4, "long: ATR14 (Wilder) at signal bar ~1.0322");

            // SL/TP math: SL = zoneBottom - 0.15*ATR; TP = entry + 2*(entry-SL)
            if (sig != null)
            {
                double expectedSl = 99.8 - 0.15 * sig.Atr;
                Check(Math.Abs(sig.StopLossPrice(cfg) - expectedSl) < 1e-9, "long: SL = zone.Bottom - 0.15*ATR");
                bool ok = sig.TryGetExitPrices(cfg, 100.1, 0.0001, out double sl, out double tp);
                Check(ok, "long: SL distance passes min check at entry 100.1");
                Check(ok && Math.Abs(tp - (100.1 + 2.0 * (100.1 - sl))) < 1e-9, "long: TP = entry + RR*(entry-SL)");

                // ---- 2. min-SL-distance rejection ----
                bool rejected = !sig.TryGetExitPrices(cfg, 99.9, 0.0001, out _, out _);
                Check(rejected, "min-SL: entry too close to SL (0.255 < 0.3*ATR) is rejected");
            }

            // ---- 3. causality: no signal exists before bar 22 on any prefix ----
            var full = LongScenario();
            bool causal = true;
            for (int len = 1; len <= full.Count; len++)
            {
                RunEngine(full.GetRange(0, len), out var sb);
                foreach (var s in sb) if (s != 22) causal = false;
                if (len < 23 && sb.Count > 0) causal = false;
            }
            Check(causal, "causality: prefixes produce no signal before bar 22, full run unchanged");

            // ---- 4. ambiguous double sweep is rejected ----
            var dbl = LongScenario();
            dbl[22] = B(22, 100.4, 102.2, 98.8, 100.0); // pierces BOTH 99.0 and 101.9, closes inside
            RunEngine(dbl, out var dblBars);
            Check(dblBars.Count == 0, "double sweep on one bar -> ambiguous -> no signal");

            // ---- 5. broken zone produces no signal ----
            var broken = LongScenario();
            broken.Insert(22, B(22, 100.4, 100.5, 99.2, 99.7)); // close 99.7 < zone bottom 99.8 -> zone broken
            RunEngine(broken, out var brokenBars);
            Check(brokenBars.Count == 0, "zone broken by close before sweep -> no signal");

            // ---- 6. short mirror: reflected prices produce the mirrored Sell signal ----
            var mirrored = new List<Bar>();
            foreach (var b in LongScenario()) mirrored.Add(Mirror(b));
            var shortSig = RunEngine(mirrored, out var shortBars);
            Check(shortBars.Count == 1 && shortBars[0] == 22 && shortSig.Direction == TradeDirection.Sell,
                "short: mirrored scenario -> one Sell signal at bar 22");
            Check(shortSig != null && Math.Abs(shortSig.ZoneTop - 100.2) < 1e-9 && Math.Abs(shortSig.ZoneBottom - 99.6) < 1e-9,
                "short: mirrored zone bounds");
            if (shortSig != null)
                Check(Math.Abs(shortSig.StopLossPrice(cfg) - (100.2 + 0.15 * shortSig.Atr)) < 1e-9,
                    "short: SL = zone.Top + 0.15*ATR");

            // ---- 7. aggregator: OHLC + UTC boundary alignment ----
            var agg = new BarAggregator(TimeSpan.FromMinutes(15));
            var completed = new List<Bar>();
            for (int k = 0; k <= 30; k++)
            {
                var done = agg.AddM1(T0.AddMinutes(k), k, k + 0.5, k - 0.5, k + 0.25);
                if (done.HasValue) completed.Add(done.Value);
            }
            Check(completed.Count == 2, "aggregator: 31 M1 bars -> 2 completed M15 bars");
            Check(completed.Count == 2
                  && completed[0].OpenTimeUtc == T0 && completed[0].Open == 0
                  && completed[0].High == 14.5 && completed[0].Low == -0.5 && completed[0].Close == 14.25
                  && completed[1].OpenTimeUtc == T0.AddMinutes(15) && completed[1].Open == 15
                  && completed[1].High == 29.5 && completed[1].Low == 14.5 && completed[1].Close == 29.25,
                "aggregator: OHLC and label=left period starts are correct");

            // gap handling: no synthetic bars, next bucket starts cleanly after a weekend
            var gapAgg = new BarAggregator(TimeSpan.FromMinutes(15));
            var friday = new DateTime(2026, 1, 9, 21, 58, 0, DateTimeKind.Utc);
            gapAgg.AddM1(friday, 1, 2, 0, 1);
            gapAgg.AddM1(friday.AddMinutes(1), 1, 2, 0, 1);
            var afterGap = gapAgg.AddM1(new DateTime(2026, 1, 11, 22, 5, 0, DateTimeKind.Utc), 5, 6, 4, 5);
            Check(afterGap.HasValue && afterGap.Value.OpenTimeUtc == new DateTime(2026, 1, 9, 21, 45, 0, DateTimeKind.Utc),
                "aggregator: weekend gap closes the pending bar, no synthetic bars");

            // ---- 8. end-to-end simulator: entry at next bar open, TP exit, +2R ----
            var sim = new TradeSimulator(new EngineConfig(), 0.0001, 1.0, 100_000);
            var simBars = LongScenario();
            simBars.Add(B(23, 100.1, 100.2, 99.9, 100.0));   // entry bar: open 100.1
            simBars.Add(B(24, 100.0, 101.1, 99.95, 101.05)); // hits TP ~101.0097, SL untouched
            foreach (var b in simBars) sim.OnM1(b.OpenTimeUtc, b.Open, b.High, b.Low, b.Close);
            Check(sim.Closed.Count == 1 && sim.Open.Count == 0, "sim: exactly one trade, closed");
            if (sim.Closed.Count == 1)
            {
                var t = sim.Closed[0];
                Check(Math.Abs(t.Entry - 100.1) < 1e-9, "sim: entry = open of bar AFTER the signal bar");
                Check(t.EntryTimeUtc == T0.AddMinutes(15 * 23), "sim: entry time = signal bar close time");
                Check(t.ExitReason == "TP" && Math.Abs(t.R - 2.0) < 1e-9, "sim: TP exit, +2R");
                Check(Math.Abs(t.BalanceAfter - 102_000) < 1e-6, "sim: 1% risk -> balance 102,000 after +2R");
            }

            // ---- 9. simulator: SL-first on a bar touching both SL and TP ----
            var sim2 = new TradeSimulator(new EngineConfig(), 0.0001, 1.0, 100_000);
            var simBars2 = LongScenario();
            simBars2.Add(B(23, 100.1, 100.2, 99.9, 100.0));
            simBars2.Add(B(24, 100.0, 101.2, 99.5, 100.8)); // touches BOTH TP (101.01) and SL (99.645)
            foreach (var b in simBars2) sim2.OnM1(b.OpenTimeUtc, b.Open, b.High, b.Low, b.Close);
            Check(sim2.Closed.Count == 1 && sim2.Closed[0].ExitReason == "SL" && Math.Abs(sim2.Closed[0].R + 1.0) < 1e-9,
                "sim: SL checked first when one bar spans both SL and TP -> -1R");

            Console.WriteLine();
            Console.WriteLine(_failures == 0 ? "ALL SELF-TESTS PASSED" : _failures + " SELF-TEST(S) FAILED");
            return _failures == 0 ? 0 : 1;
        }
    }
}
