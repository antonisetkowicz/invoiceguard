using System;
using System.Globalization;
using System.IO;
using System.Linq;
using FTMO17.Core;

namespace FTMO17.Backtest
{
    /// <summary>
    /// CSV M1 runner for cross-checking the C# engine against the Python
    /// validation engine, plus built-in self-tests.
    ///
    ///   dotnet run -- selftest
    ///   dotnet run -- run data.csv [--pip 0.0001] [--risk 1.0] [--balance 100000] [--out trades.csv]
    ///
    /// CSV: timestamp,open,high,low,close[,volume] — one CLOSED M1 bar per
    /// line, timestamp = bar OPEN time in UTC, chronological order.
    /// </summary>
    public static class Program
    {
        public static int Main(string[] args)
        {
            if (args.Length >= 1 && args[0] == "selftest")
                return SelfTest.Run();

            if (args.Length >= 2 && args[0] == "run")
                return RunCsv(args);

            Console.WriteLine("usage: FTMO17.Backtest selftest");
            Console.WriteLine("       FTMO17.Backtest run <m1.csv> [--pip 0.0001] [--risk 1.0] [--balance 100000] [--out trades.csv]");
            return 2;
        }

        private static string Opt(string[] args, string name, string dflt)
        {
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == name) return args[i + 1];
            return dflt;
        }

        private static int RunCsv(string[] args)
        {
            string path = args[1];
            double pip = double.Parse(Opt(args, "--pip", "0.0001"), CultureInfo.InvariantCulture);
            double risk = double.Parse(Opt(args, "--risk", "1.0"), CultureInfo.InvariantCulture);
            double balance = double.Parse(Opt(args, "--balance", "100000"), CultureInfo.InvariantCulture);
            string outPath = Opt(args, "--out", null);

            var sim = new TradeSimulator(new EngineConfig(), pip, risk, balance);

            DateTime? first = null, last = null;
            long lines = 0;
            foreach (var line in File.ReadLines(path))
            {
                var parts = line.Split(',');
                if (parts.Length < 5) continue;
                if (!DateTime.TryParse(parts[0], CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var t))
                    continue; // header or malformed line
                double o = double.Parse(parts[1], CultureInfo.InvariantCulture);
                double h = double.Parse(parts[2], CultureInfo.InvariantCulture);
                double l = double.Parse(parts[3], CultureInfo.InvariantCulture);
                double c = double.Parse(parts[4], CultureInfo.InvariantCulture);
                sim.OnM1(t, o, h, l, c);
                first ??= t; last = t; lines++;
            }

            if (outPath != null)
            {
                using var w = new StreamWriter(outPath);
                w.WriteLine("signal_bar_open_utc,entry_time_utc,direction,entry,sl,tp,exit_time_utc,exit,r,balance_after");
                foreach (var t in sim.Closed)
                    w.WriteLine(string.Join(",",
                        t.SignalBarOpenUtc.ToString("yyyy-MM-dd HH:mm:ss"),
                        t.EntryTimeUtc.ToString("yyyy-MM-dd HH:mm:ss"),
                        t.Direction,
                        t.Entry.ToString("G10", CultureInfo.InvariantCulture),
                        t.Sl.ToString("G10", CultureInfo.InvariantCulture),
                        t.Tp.ToString("G10", CultureInfo.InvariantCulture),
                        t.ExitTimeUtc.ToString("yyyy-MM-dd HH:mm:ss"),
                        t.ExitReason,
                        t.R.ToString(CultureInfo.InvariantCulture),
                        t.BalanceAfter.ToString("F2", CultureInfo.InvariantCulture)));
            }

            var closed = sim.Closed;
            int wins = closed.Count(t => t.R > 0), losses = closed.Count(t => t.R < 0);
            double grossWin = closed.Where(t => t.R > 0).Sum(t => t.R);
            double grossLoss = -closed.Where(t => t.R < 0).Sum(t => t.R);
            double weeks = first.HasValue && last.HasValue
                ? Math.Max((last.Value - first.Value).TotalDays / 7.0, 1e-9) : 0;

            Console.WriteLine("M1 bars processed ....... {0}", lines);
            Console.WriteLine("Period .................. {0:yyyy-MM-dd} -> {1:yyyy-MM-dd}", first, last);
            Console.WriteLine("Closed trades ........... {0}  (open at end: {1})", closed.Count, sim.Open.Count);
            Console.WriteLine("Win rate ................ {0:P1}", closed.Count > 0 ? (double)wins / closed.Count : 0);
            Console.WriteLine("Profit factor ........... {0}", grossLoss > 0 ? (grossWin / grossLoss).ToString("F2") : "inf");
            Console.WriteLine("Expectancy [R] .......... {0:F3}", closed.Count > 0 ? closed.Average(t => t.R) : 0);
            Console.WriteLine("Trades / week ........... {0:F2}", weeks > 0 ? closed.Count / weeks : 0);
            Console.WriteLine("Final balance ........... {0:F2}", sim.Balance);
            Console.WriteLine("Rejected (min SL) ....... {0}", sim.SignalsRejectedMinSl);
            Console.WriteLine("Skipped (concurrency) ... {0}", sim.SignalsSkippedConcurrency);
            if (outPath != null) Console.WriteLine("Trade log ............... {0}", outPath);
            return 0;
        }
    }
}
