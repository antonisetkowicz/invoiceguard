"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TIERS, formatPln } from "@/lib/audit/config";
import type { AuditArea, AuditSeverity, AuditTier, CategoryScores, ReportDTO } from "@/types/audit";

const STAGE_LABELS: Record<string, string> = {
  queued: "W kolejce",
  scrape: "Pobieram stronę",
  lighthouse: "Mierzę szybkość",
  heuristics: "Sprawdzam reguły",
  analyze: "Claude analizuje treść",
  pricing: "Wyceniam wdrożenie",
  report: "Składam raport",
  done: "Gotowe",
  failed: "Błąd",
};

const STAGE_ORDER = ["scrape", "lighthouse", "heuristics", "analyze", "pricing", "report"];

const SEVERITY_STYLE: Record<AuditSeverity, { label: string; chip: string; bar: string }> = {
  critical: { label: "Krytyczne", chip: "bg-red-100 text-red-800 border-red-200", bar: "bg-red-500" },
  high: { label: "Wysokie", chip: "bg-orange-100 text-orange-800 border-orange-200", bar: "bg-orange-500" },
  medium: { label: "Średnie", chip: "bg-amber-100 text-amber-800 border-amber-200", bar: "bg-amber-500" },
  low: { label: "Niskie", chip: "bg-sky-100 text-sky-800 border-sky-200", bar: "bg-sky-500" },
};

const AREA_LABEL: Record<AuditArea, string> = {
  ux: "UX",
  seo: "SEO",
  copy: "Treść",
  performance: "Szybkość",
  trust: "Zaufanie",
  conversion: "Konwersja",
  tech: "Technika",
};

const CATEGORY_VIEW: { key: keyof CategoryScores; label: string }[] = [
  { key: "conversion", label: "Konwersja" },
  { key: "ux", label: "UX" },
  { key: "seo", label: "SEO" },
  { key: "copy", label: "Treść" },
  { key: "trust", label: "Zaufanie" },
  { key: "performance", label: "Szybkość" },
];

function scoreTone(value: number) {
  if (value >= 80) return { text: "text-emerald-600", ring: "stroke-emerald-500", bg: "bg-emerald-500" };
  if (value >= 60) return { text: "text-amber-600", ring: "stroke-amber-500", bg: "bg-amber-500" };
  if (value >= 40) return { text: "text-orange-600", ring: "stroke-orange-500", bg: "bg-orange-500" };
  return { text: "text-red-600", ring: "stroke-red-500", bg: "bg-red-500" };
}

function ScoreDial({ value }: { value: number }) {
  const tone = scoreTone(value);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="11" className="stroke-slate-200" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="11"
          strokeLinecap="round"
          className={tone.ring}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={"text-4xl font-extrabold " + tone.text}>{value}</span>
        <span className="text-xs text-slate-400">/ 100</span>
      </div>
    </div>
  );
}

function RunningPanel({ report }: { report: ReportDTO }) {
  const run = report.run;
  const currentStage = run?.stage ?? "queued";
  const currentIndex = STAGE_ORDER.indexOf(currentStage);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        <h2 className="text-xl font-bold text-slate-900">{STAGE_LABELS[currentStage] ?? "Pracuję"}…</h2>
      </div>
      <p className="mt-2 text-slate-600">
        Analizujemy <span className="font-medium text-slate-900">{report.url}</span>. Zwykle zajmuje to 1–3 minuty —
        możesz zamknąć tę stronę, link mamy w e-mailu.
      </p>

      <div className="mt-7 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all duration-700"
          style={{ width: `${Math.max(5, run?.progress ?? 0)}%` }}
        />
      </div>

      <ol className="mt-7 space-y-3">
        {STAGE_ORDER.map((stage, index) => {
          const done = currentIndex > index;
          const active = currentIndex === index;
          return (
            <li key={stage} className="flex items-center gap-3 text-sm">
              <span
                className={
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold " +
                  (done ? "bg-emerald-100 text-emerald-700" : active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400")
                }
              >
                {done ? "✓" : index + 1}
              </span>
              <span className={done ? "text-slate-500" : active ? "font-semibold text-slate-900" : "text-slate-400"}>
                {STAGE_LABELS[stage]}
              </span>
            </li>
          );
        })}
      </ol>

      {report.events.length > 0 && (
        <div className="mt-7 max-h-44 overflow-y-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-300">
          {report.events.slice(-14).map((event, index) => (
            <div key={index} className={event.level === "warn" ? "text-amber-300" : event.level === "error" ? "text-red-300" : ""}>
              <span className="text-slate-500">
                {new Date(event.at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>{" "}
              {event.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpgradeButton({ token, tier, label, priceGrosz }: { token: string; tier: AuditTier; label: string; priceGrosz: number }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upgrade() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/audit/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, tier }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Nie udało się rozpocząć płatności.");
        setLoading(false);
        return;
      }
      window.location.href = payload.data.redirectTo;
    } catch {
      setError("Brak połączenia z serwerem.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={upgrade}
        disabled={loading}
        className="w-full rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {loading ? "Przekierowuję…" : `${label} — ${formatPln(priceGrosz)}`}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function FindingCard({ finding, index, showPrice }: { finding: ReportDTO["findings"][number]; index: number; showPrice: boolean }) {
  const style = SEVERITY_STYLE[finding.severity];

  if (finding.locked) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
        <div className="flex items-center gap-2">
          <span className={"rounded border px-2 py-0.5 text-xs font-semibold " + style.chip}>{style.label}</span>
          <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-500">
            {AREA_LABEL[finding.area]}
          </span>
          <svg className="ml-auto h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h3 className="mt-3 font-semibold text-slate-400 blur-[3px] select-none">{finding.title}</h3>
        <div className="mt-2 space-y-1.5">
          <div className="h-2.5 w-full rounded bg-slate-200" />
          <div className="h-2.5 w-4/5 rounded bg-slate-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={"rounded border px-2 py-0.5 text-xs font-semibold " + style.chip}>{style.label}</span>
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
              {AREA_LABEL[finding.area]}
            </span>
            <span className="text-xs text-slate-400">wpływ {finding.impact}/5</span>
          </div>
          <h3 className="mt-2.5 text-lg font-semibold text-slate-900">
            {index}. {finding.title}
          </h3>
        </div>
        {showPrice && (
          <div className="text-right">
            <div className="text-lg font-bold text-slate-900">{formatPln(finding.priceGrosz)}</div>
            <div className="text-xs text-slate-400">{finding.effortHours} h wdrożenia</div>
          </div>
        )}
      </div>

      <p className="mt-3 leading-relaxed text-slate-600">{finding.problem}</p>

      <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Co zrobić</p>
        <p className="mt-1.5 leading-relaxed text-slate-700">{finding.recommendation}</p>
      </div>

      {finding.evidence && (
        <p className="mt-3 border-l-2 border-slate-200 pl-3 text-sm text-slate-500">
          <span className="font-medium text-slate-600">Dowód: </span>
          {finding.evidence}
          {finding.pageUrl && <span className="ml-1 text-slate-400">({finding.pageUrl})</span>}
        </p>
      )}
    </div>
  );
}

export default function ReportView({ token }: { token: string }) {
  const [report, setReport] = useState<ReportDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState<AuditArea | "all">("all");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/audit/report/${token}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Nie udało się pobrać raportu.");
        return null;
      }
      setReport(payload.data as ReportDTO);
      return payload.data as ReportDTO;
    } catch {
      setError("Brak połączenia z serwerem.");
      return null;
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    // Odpytujemy tak długo, jak audyt trwa — panel pokazuje etapy na żywo.
    async function poll() {
      const data = await load();
      if (cancelled) return;
      const status = data?.run?.status;
      if (status === "queued" || status === "running" || !data?.run) {
        timerRef.current = setTimeout(poll, 2500);
      }
    }
    void poll();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <h2 className="text-xl font-bold text-red-900">{error}</h2>
        <a href="/audyt" className="mt-4 inline-block text-sm font-semibold text-red-700 underline">
          Wróć i zamów audyt
        </a>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const status = report.run?.status;

  if (status === "failed") {
    return (
      <div className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Nie udało się przeanalizować tej strony</h2>
        <p className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-slate-700">
          {report.run?.error ?? "Nieznany błąd."}
        </p>
        <p className="mt-4 leading-relaxed text-slate-600">
          Najczęstsze przyczyny: strona blokuje roboty, wymaga logowania, przekierowuje w pętli albo była chwilowo
          niedostępna.
          {report.paid && " Płatność została zarejestrowana — napisz do nas, uruchomimy audyt ponownie lub zwrócimy pieniądze."}
        </p>
        <a href="/audyt" className="mt-6 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">
          Spróbuj z innym adresem
        </a>
      </div>
    );
  }

  if (status !== "done") {
    return <RunningPanel report={report} />;
  }

  const scores = report.scores;
  const visibleFindings = report.findings.filter(
    (finding) => areaFilter === "all" || finding.area === areaFilter
  );
  const areasPresent = [...new Set(report.findings.map((f) => f.area))];
  let visibleIndex = 0;

  return (
    <div className="space-y-8">
      {/* Nagłówek + ocena ogólna */}
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
              Raport z audytu · pakiet {TIERS[report.tier].label}
            </p>
            <h1 className="mt-1 break-words text-2xl font-bold text-slate-900">{report.siteUrl}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Przeanalizowano {report.pagesAnalyzed} {report.pagesAnalyzed === 1 ? "stronę" : "podstron"} ·{" "}
              {new Date(report.createdAt).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          {report.capabilities.pdf && (
            <a
              href={`/api/audit/report/${report.token}/pdf`}
              className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Pobierz PDF
            </a>
          )}
        </div>

        {scores && (
          <div className="mt-8 flex flex-col items-center gap-8 sm:flex-row sm:items-start">
            <ScoreDial value={scores.overall} />
            <div className="w-full flex-1 space-y-3">
              {CATEGORY_VIEW.map((category) => {
                const value = scores[category.key] as number;
                const tone = scoreTone(value);
                return (
                  <div key={category.key} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm font-medium text-slate-600">{category.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className={"h-full rounded-full " + tone.bg} style={{ width: `${value}%` }} />
                    </div>
                    <span className={"w-9 text-right text-sm font-bold " + tone.text}>{value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          {(Object.keys(SEVERITY_STYLE) as AuditSeverity[]).map((severity) => (
            <div key={severity} className="rounded-lg border border-slate-200 px-4 py-2">
              <span className="text-xl font-bold text-slate-900">{report.severityCounts[severity]}</span>
              <span className="ml-2 text-sm text-slate-500">{SEVERITY_STYLE[severity].label.toLowerCase()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Podsumowanie */}
      {report.summary && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Podsumowanie</h2>
          <p className="mt-4 leading-relaxed text-slate-700">{report.summary.executiveSummary}</p>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-5">
              <h3 className="text-sm font-semibold text-slate-900">Pierwsze wrażenie</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{report.summary.firstImpression}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-5">
              <h3 className="text-sm font-semibold text-slate-900">Do kogo mówi ta strona</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{report.summary.targetAudience}</p>
            </div>
          </div>

          {report.summary.quickWins.length > 0 && (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-6">
              <h3 className="font-semibold text-emerald-900">Zrób to najpierw — każde poniżej godziny</h3>
              <ol className="mt-3 space-y-2">
                {report.summary.quickWins.map((win, index) => (
                  <li key={index} className="flex gap-3 text-sm text-emerald-900">
                    <span className="font-bold">{index + 1}.</span>
                    <span>{win}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Wycena */}
      {report.quote && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Wycena wdrożenia</h2>
          <p className="mt-1 text-sm text-slate-500">
            Szacunek przy stawce {formatPln(report.quote.hourlyRateGrosz)}/h. To punkt odniesienia dla rozmowy z
            wykonawcą, nie oferta wiążąca.
          </p>

          <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <div className="text-4xl font-extrabold text-indigo-600">{formatPln(report.quote.totalGrosz)}</div>
              <div className="mt-1 text-sm text-slate-500">
                widełki {formatPln(report.quote.minGrosz)} – {formatPln(report.quote.maxGrosz)}
              </div>
            </div>
            <div className="text-sm text-slate-500">
              <span className="font-semibold text-slate-900">{report.quote.totalHours} h</span> łącznej pracy
            </div>
          </div>

          <div className="mt-6 space-y-2">
            {report.quote.byArea.map((row) => {
              const share = report.quote!.totalGrosz > 0 ? (row.priceGrosz / report.quote!.totalGrosz) * 100 : 0;
              return (
                <div key={row.area} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 font-medium text-slate-600">{AREA_LABEL[row.area]}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${share}%` }} />
                  </div>
                  <span className="w-8 text-right text-xs text-slate-400">{row.count}×</span>
                  <span className="w-24 text-right font-semibold text-slate-900">{formatPln(row.priceGrosz)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upsell */}
      {report.findingsLocked > 0 && report.upsell.length > 0 && (
        <div className="rounded-2xl border-2 border-indigo-600 bg-indigo-50/50 p-8">
          <h2 className="text-xl font-bold text-slate-900">
            Zablokowane: {report.findingsLocked} {report.findingsLocked === 1 ? "znalezisko" : "znalezisk"}
          </h2>
          <p className="mt-2 max-w-2xl leading-relaxed text-slate-600">
            Darmowy skan pokazuje trzy największe problemy. Pełny audyt odblokowuje pozostałe wraz z instrukcją
            wdrożenia, wyceną każdej poprawki i raportem PDF, który możesz przekazać wykonawcy.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {report.upsell.map((option) => (
              <div key={option.tier} className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="font-semibold text-slate-900">{TIERS[option.tier].label}</h3>
                <p className="mt-1 mb-4 text-sm text-slate-500">{TIERS[option.tier].tagline}</p>
                <UpgradeButton token={report.token} tier={option.tier} label="Odblokuj" priceGrosz={option.priceGrosz} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Znaleziska */}
      <div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">Lista poprawek ({report.findingsTotal})</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setAreaFilter("all")}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition " +
                (areaFilter === "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
              }
            >
              Wszystkie
            </button>
            {areasPresent.map((area) => (
              <button
                key={area}
                onClick={() => setAreaFilter(area)}
                className={
                  "rounded-full border px-3 py-1 text-xs font-medium transition " +
                  (areaFilter === area ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
                }
              >
                {AREA_LABEL[area]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {visibleFindings.map((finding) => {
            if (!finding.locked) visibleIndex += 1;
            return (
              <FindingCard
                key={finding.id}
                finding={finding}
                index={visibleIndex}
                showPrice={report.capabilities.quote}
              />
            );
          })}
        </div>
      </div>

      {/* Komentarze per obszar */}
      {report.summary && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Obszar po obszarze</h2>
          <dl className="mt-5 space-y-4">
            {CATEGORY_VIEW.map((category) => {
              const note = report.summary!.categoryNotes[category.key as keyof typeof report.summary.categoryNotes];
              if (!note) return null;
              return (
                <div key={category.key} className="border-l-2 border-slate-200 pl-4">
                  <dt className="flex items-center gap-2 font-semibold text-slate-900">
                    {category.label}
                    {scores && (
                      <span className={"text-sm font-bold " + scoreTone(scores[category.key] as number).text}>
                        {scores[category.key]}/100
                      </span>
                    )}
                  </dt>
                  <dd className="mt-1 text-sm leading-relaxed text-slate-600">{note}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      {/* Gotowe teksty (Pro) */}
      {report.copyRewrites.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Gotowe teksty do wklejenia</h2>
          <p className="mt-1 text-sm text-slate-500">Nie wymagają zmian w kodzie — wystarczy edytor treści.</p>
          <div className="mt-6 space-y-5">
            {report.copyRewrites.map((rewrite, index) => (
              <div key={index} className="rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-900">{rewrite.location}</h3>
                <p className="mt-2 text-sm text-slate-400 line-through">{rewrite.before || "(obecnie brak)"}</p>
                <p className="mt-2 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-900">{rewrite.after}</p>
                <p className="mt-2 text-xs text-slate-500">{rewrite.why}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Roadmapa (Pro) */}
      {report.roadmap.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Plan wdrożenia</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {report.roadmap.map((phase) => (
              <div key={phase.horizon} className="rounded-xl border border-slate-200 p-5">
                <h3 className="font-semibold text-indigo-600">Pierwsze {phase.horizon} dni</h3>
                <ul className="mt-3 space-y-2">
                  {phase.items.map((item, index) => (
                    <li key={index} className="flex gap-2 text-sm text-slate-600">
                      <span className="text-indigo-400">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lighthouse */}
      {report.lighthouse?.available && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Pomiary wydajności</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {report.lighthouse.results.map((result) => (
              <div key={result.strategy} className="rounded-xl border border-slate-200 p-5">
                <h3 className="font-semibold text-slate-900">
                  {result.strategy === "mobile" ? "Telefon" : "Komputer"}
                </h3>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: "Wydajność", value: result.performance },
                    { label: "Dostępność", value: result.accessibility },
                    { label: "Dobre praktyki", value: result.bestPractices },
                    { label: "SEO", value: result.seo },
                  ].map((item) => (
                    <div key={item.label} className="flex items-baseline justify-between gap-2">
                      <span className="text-slate-500">{item.label}</span>
                      <span className={"font-bold " + (item.value == null ? "text-slate-400" : scoreTone(item.value).text)}>
                        {item.value ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <div className="flex justify-between">
                    <dt>LCP</dt>
                    <dd>{result.metrics.lcpMs ? (result.metrics.lcpMs / 1000).toFixed(1) + " s" : "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>CLS</dt>
                    <dd>{result.metrics.clsScore ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Odpowiedź serwera</dt>
                    <dd>{result.metrics.ttfbMs ? result.metrics.ttfbMs + " ms" : "—"}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="pb-8 text-center text-xs leading-relaxed text-slate-400">
        Raport powstał automatycznie na podstawie publicznie dostępnej treści strony.
        {report.capabilities.quote && " Wycena jest szacunkiem, nie ofertą w rozumieniu Kodeksu cywilnego."}
      </p>
    </div>
  );
}
