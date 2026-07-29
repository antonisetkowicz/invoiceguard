export type AuditTier = "free" | "basic" | "pro";

export type AuditArea = "ux" | "seo" | "copy" | "performance" | "trust" | "conversion" | "tech";

export type AuditSeverity = "critical" | "high" | "medium" | "low";

export type RunStatus = "queued" | "running" | "done" | "failed";

export type RunStage =
  | "queued"
  | "scrape"
  | "lighthouse"
  | "heuristics"
  | "analyze"
  | "pricing"
  | "report"
  | "done"
  | "failed";

export interface PageSignals {
  url: string;
  finalUrl: string;
  httpStatus: number;
  fetchedAt: string;
  loadMs: number;
  htmlBytes: number;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;
  lang: string | null;
  hasViewport: boolean;
  hasFavicon: boolean;
  robotsMeta: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  wordCount: number;
  textSample: string;
  images: { total: number; missingAlt: number; emptySrc: number; missingDimensions: number };
  links: { internal: number; external: number; nofollow: number; empty: number };
  ctas: string[];
  forms: { count: number; fieldCounts: number[]; hasConsentCheckbox: boolean };
  contact: { emails: string[]; phones: string[]; hasContactPage: boolean; hasAddress: boolean };
  trust: {
    hasPrivacyPolicy: boolean;
    hasTerms: boolean;
    hasCookieBanner: boolean;
    hasNip: boolean;
    hasTestimonials: boolean;
  };
  social: string[];
  openGraph: { title: string | null; description: string | null; image: string | null };
  structuredData: string[];
  scripts: { total: number; inline: number; analytics: string[] };
  isLikelyJsOnly: boolean;
}

export interface ScrapeResult {
  requestedUrl: string;
  siteUrl: string;
  pages: PageSignals[];
  discoveredLinks: string[];
  robotsTxt: { found: boolean; disallowsAll: boolean } | null;
  sitemap: { found: boolean; urlCount: number } | null;
  https: boolean;
  wwwRedirectOk: boolean | null;
  errors: string[];
}

export interface LighthouseStrategyResult {
  strategy: "mobile" | "desktop";
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  metrics: {
    lcpMs: number | null;
    clsScore: number | null;
    inpMs: number | null;
    fcpMs: number | null;
    ttfbMs: number | null;
    tbtMs: number | null;
    speedIndexMs: number | null;
  };
  topOpportunities: { id: string; title: string; savingsMs: number | null }[];
}

export interface LighthouseResult {
  provider: "psi" | "local" | "off";
  available: boolean;
  note?: string;
  results: LighthouseStrategyResult[];
}

export interface CategoryScores {
  performance: number;
  seo: number;
  ux: number;
  copy: number;
  trust: number;
  conversion: number;
  overall: number;
}

export interface HeuristicCheck {
  id: string;
  area: AuditArea;
  passed: boolean;
  severity: AuditSeverity;
  label: string;
  detail: string;
}

export interface HeuristicsResult {
  scores: CategoryScores;
  checks: HeuristicCheck[];
  failed: HeuristicCheck[];
}

/** Kształt gwarantowany przez structured outputs Claude'a. */
export interface AnalysisFinding {
  area: AuditArea;
  severity: AuditSeverity;
  title: string;
  problem: string;
  recommendation: string;
  evidence: string;
  page_url: string;
  impact: number;
  effort_hours: number;
}

export interface AnalysisResult {
  executive_summary: string;
  first_impression: string;
  target_audience_guess: string;
  quick_wins: string[];
  findings: AnalysisFinding[];
  category_notes: {
    ux: string;
    seo: string;
    copy: string;
    performance: string;
    trust: string;
    conversion: string;
  };
  copy_rewrites: { location: string; before: string; after: string; why: string }[];
  roadmap: { horizon: "30" | "60" | "90"; items: string[] }[];
}

export interface ReportFinding {
  id: string;
  area: AuditArea;
  severity: AuditSeverity;
  title: string;
  problem: string;
  recommendation: string;
  evidence: string | null;
  pageUrl: string | null;
  impact: number;
  effortHours: number;
  priceGrosz: number;
  locked: boolean;
}

export interface ReportQuote {
  totalGrosz: number;
  minGrosz: number;
  maxGrosz: number;
  totalHours: number;
  hourlyRateGrosz: number;
  byArea: { area: AuditArea; hours: number; priceGrosz: number; count: number }[];
}

export interface ReportDTO {
  token: string;
  url: string;
  siteUrl: string;
  email: string;
  tier: AuditTier;
  paid: boolean;
  createdAt: string;
  run: {
    id: string;
    status: RunStatus;
    stage: RunStage;
    progress: number;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
  events: { stage: string; message: string; level: string; at: string }[];
  scores: CategoryScores | null;
  lighthouse: LighthouseResult | null;
  pagesAnalyzed: number;
  summary: {
    executiveSummary: string;
    firstImpression: string;
    targetAudience: string;
    quickWins: string[];
    categoryNotes: AnalysisResult["category_notes"];
  } | null;
  findings: ReportFinding[];
  findingsTotal: number;
  findingsLocked: number;
  severityCounts: Record<AuditSeverity, number>;
  quote: ReportQuote | null;
  copyRewrites: AnalysisResult["copy_rewrites"];
  roadmap: AnalysisResult["roadmap"];
  capabilities: { pdf: boolean; quote: boolean; copyRewrites: boolean; roadmap: boolean };
  upsell: { tier: AuditTier; label: string; priceGrosz: number }[];
}
