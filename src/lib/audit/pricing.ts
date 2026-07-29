import type { AnalysisFinding, AuditArea, ReportQuote } from "@/types/audit";
import { HOURLY_RATE_GROSZ } from "./config";

/**
 * Mnożnik trudności per obszar. Wdrożenie zmiany w tekście jest tańsze
 * w obsłudze niż grzebanie w wydajności czy szablonie.
 */
const AREA_MULTIPLIER: Record<AuditArea, number> = {
  copy: 0.9,
  seo: 1,
  trust: 1,
  conversion: 1.1,
  ux: 1.15,
  performance: 1.25,
  tech: 1.25,
};

/** Minimalna jednostka rozliczeniowa — nikt nie fakturuje 9 minut. */
const MIN_HOURS = 0.5;

export function priceFinding(finding: AnalysisFinding): { hours: number; priceGrosz: number } {
  const hours = Math.max(MIN_HOURS, finding.effort_hours * (AREA_MULTIPLIER[finding.area] ?? 1));
  const rounded = Math.round(hours * 4) / 4; // do kwadransa
  return { hours: rounded, priceGrosz: Math.round(rounded * HOURLY_RATE_GROSZ) };
}

export function buildQuote(
  findings: { area: AuditArea; effortHours: number; priceGrosz: number }[]
): ReportQuote {
  const totalGrosz = findings.reduce((sum, f) => sum + f.priceGrosz, 0);
  const totalHours = Number(findings.reduce((sum, f) => sum + f.effortHours, 0).toFixed(2));

  const byAreaMap = new Map<AuditArea, { hours: number; priceGrosz: number; count: number }>();
  for (const finding of findings) {
    const entry = byAreaMap.get(finding.area) ?? { hours: 0, priceGrosz: 0, count: 0 };
    entry.hours += finding.effortHours;
    entry.priceGrosz += finding.priceGrosz;
    entry.count += 1;
    byAreaMap.set(finding.area, entry);
  }

  return {
    totalGrosz,
    // Widełki ±25 % — wycena jest estymatą, a nie ofertą wiążącą.
    minGrosz: Math.round(totalGrosz * 0.75),
    maxGrosz: Math.round(totalGrosz * 1.25),
    totalHours,
    hourlyRateGrosz: HOURLY_RATE_GROSZ,
    byArea: [...byAreaMap.entries()]
      .map(([area, value]) => ({
        area,
        hours: Number(value.hours.toFixed(2)),
        priceGrosz: value.priceGrosz,
        count: value.count,
      }))
      .sort((a, b) => b.priceGrosz - a.priceGrosz),
  };
}
