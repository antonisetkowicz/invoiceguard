interface ScoreBadgeProps {
  score: number | null;
}

function scoreTier(score: number): { label: string; classes: string; dot: string } {
  if (score < 40) {
    return {
      label: "Zimny",
      classes: "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30",
      dot: "bg-red-400",
    };
  }
  if (score <= 70) {
    return {
      label: "Ciepły",
      classes: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30",
      dot: "bg-amber-400",
    };
  }
  return {
    label: "Gorący",
    classes: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30",
    dot: "bg-emerald-400",
  };
}

export function ScoreBadge({ score }: ScoreBadgeProps) {
  if (score === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-white/40 ring-1 ring-inset ring-white/10">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/40" />
        Ocena w toku
      </span>
    );
  }

  const tier = scoreTier(score);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tier.classes}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tier.dot}`} />
      {tier.label} · {score}/100
    </span>
  );
}
