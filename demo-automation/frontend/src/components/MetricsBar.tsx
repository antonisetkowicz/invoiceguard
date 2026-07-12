import { Sparkles, Timer, TrendingUp } from "lucide-react";
import { useCountUp } from "../hooks/useCountUp";

interface MetricsBarProps {
  processedToday: number;
  avgResponseSeconds: number;
  hotLeadsToday: number;
}

function StatCard({
  icon,
  label,
  value,
  suffix,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  accent: string;
}) {
  return (
    <div className="relative flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-20 blur-2xl"
        style={{ background: accent }}
      />
      <div className="relative flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${accent}22`, color: accent }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-white/50">
            {label}
          </p>
          <p className="text-2xl font-semibold tabular-nums text-white">
            {value}
            {suffix && <span className="ml-1 text-sm font-normal text-white/40">{suffix}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

export function MetricsBar({ processedToday, avgResponseSeconds, hotLeadsToday }: MetricsBarProps) {
  const animatedProcessed = useCountUp(processedToday);
  const animatedAvg = useCountUp(avgResponseSeconds * 10) / 10;
  const animatedHot = useCountUp(hotLeadsToday);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        icon={<Sparkles size={18} />}
        label="Leadów przetworzonych dzisiaj"
        value={Math.round(animatedProcessed).toString()}
        accent="#8b5cf6"
      />
      <StatCard
        icon={<Timer size={18} />}
        label="Średni czas odpowiedzi"
        value={animatedAvg.toFixed(1)}
        suffix="s"
        accent="#22d3ee"
      />
      <StatCard
        icon={<TrendingUp size={18} />}
        label="Hot leadów dzisiaj (score > 60)"
        value={Math.round(animatedHot).toString()}
        accent="#ec4899"
      />
    </div>
  );
}
