namespace FTMO17.Core
{
    public enum H4FilterMode { None, Align, NotAgainst }

    public enum SessionFilterMode { None, LondonKillzone, NyKillzone, LondonSession, NySession, AnyMajor }

    /// <summary>
    /// All strategy parameters. Defaults = final FTMO17 configuration
    /// (section 8 of the strategy overview). Optional filters default OFF.
    /// </summary>
    public sealed class EngineConfig
    {
        // core
        public int AtrPeriod = 14;
        public AtrSmoothing AtrSmoothing = AtrSmoothing.Wilder;
        public double ImpulseAtrMult = 1.2;
        public double BodyRatioMin = 0.55;
        public int MaxZoneAgeBars = 200;
        public int MaxRetestsAllowed = 999;
        public int SwingFractalK = 2;
        public int RecencyBars = 80;

        // exits (used by executors, carried here so bot + harness share one source of truth)
        public double RiskReward = 2.0;
        public double SlBufferAtrMult = 0.15;
        public double MinSlAtrMult = 0.3;

        // optional filters — all default OFF per the validated configuration
        public bool RequireCandleConfirm = false;
        public bool RequireBosAfterSweep = false;
        public int BosLookbackBars = 3;
        public H4FilterMode H4Filter = H4FilterMode.None;
        public SessionFilterMode SessionFilter = SessionFilterMode.None;
        public int H4EmaPeriod = 50;
    }
}
