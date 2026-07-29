import type { AuditTier } from "@/types/audit";

export interface TierDefinition {
  id: AuditTier;
  label: string;
  priceGrosz: number;
  tagline: string;
  maxPages: number;
  strategies: ("mobile" | "desktop")[];
  maxVisibleFindings: number | null;
  pdf: boolean;
  quote: boolean;
  copyRewrites: boolean;
  roadmap: boolean;
  features: string[];
}

export const TIERS: Record<AuditTier, TierDefinition> = {
  free: {
    id: "free",
    label: "Skan darmowy",
    priceGrosz: 0,
    tagline: "Zobacz 3 największe problemy w 2 minuty",
    maxPages: 1,
    strategies: ["mobile"],
    maxVisibleFindings: 3,
    pdf: false,
    quote: false,
    copyRewrites: false,
    roadmap: false,
    features: [
      "Strona główna",
      "Ocena 6 obszarów (UX, SEO, copy, szybkość, zaufanie, konwersja)",
      "3 najważniejsze znaleziska",
      "Wynik Lighthouse (mobile)",
    ],
  },
  basic: {
    id: "basic",
    label: "Audyt",
    priceGrosz: 9900,
    tagline: "Pełna lista poprawek z wyceną wdrożenia",
    maxPages: 3,
    strategies: ["mobile", "desktop"],
    maxVisibleFindings: null,
    pdf: true,
    quote: true,
    copyRewrites: false,
    roadmap: false,
    features: [
      "Do 3 podstron",
      "Wszystkie znaleziska z priorytetami",
      "Wycena wdrożenia każdej poprawki",
      "Raport PDF do pobrania",
      "Lighthouse mobile + desktop",
    ],
  },
  pro: {
    id: "pro",
    label: "Audyt Pro",
    priceGrosz: 29900,
    tagline: "Audyt + gotowe teksty + plan na 90 dni",
    maxPages: 8,
    strategies: ["mobile", "desktop"],
    maxVisibleFindings: null,
    pdf: true,
    quote: true,
    copyRewrites: true,
    roadmap: true,
    features: [
      "Do 8 podstron",
      "Wszystko z pakietu Audyt",
      "Gotowe teksty do wklejenia (nagłówki, CTA, opisy)",
      "Roadmapa wdrożenia 30 / 60 / 90 dni",
      "Rozbicie wyceny na obszary",
    ],
  },
};

export const TIER_ORDER: AuditTier[] = ["free", "basic", "pro"];

export function tierRank(tier: AuditTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function isPaidTier(tier: AuditTier): boolean {
  return TIERS[tier].priceGrosz > 0;
}

/** Stawka za godzinę wdrożenia — podstawa wyceny w raporcie. */
export const HOURLY_RATE_GROSZ = Number(process.env.AUDIT_HOURLY_RATE_PLN ?? 180) * 100;

export const CURRENCY = "PLN";

export const LIMITS = {
  freePerEmailPerDay: Number(process.env.AUDIT_FREE_LIMIT_EMAIL ?? 3),
  freePerIpPerDay: Number(process.env.AUDIT_FREE_LIMIT_IP ?? 10),
  maxAttempts: 3,
  /** Run bez heartbeatu dłużej niż tyle minut uznajemy za zawieszony. */
  staleAfterMinutes: 10,
  fetchTimeoutMs: 20_000,
  maxHtmlBytes: 3_000_000,
  maxRedirects: 4,
  psiTimeoutMs: 75_000,
};

export const MODEL_ID = process.env.AUDIT_MODEL ?? "claude-opus-5";

export function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function formatPln(grosz: number): string {
  return (
    (grosz / 100).toLocaleString("pl-PL", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }) + " zł"
  );
}
