import { prisma } from "@/lib/db";
import type {
  AnalysisResult,
  AuditSeverity,
  AuditTier,
  CategoryScores,
  LighthouseResult,
  ReportDTO,
  ReportFinding,
  RunStage,
  RunStatus,
} from "@/types/audit";
import { TIERS, TIER_ORDER, tierRank } from "./config";
import { buildQuote } from "./pricing";

function parse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Czy zamówienie odblokowuje pełną treść: darmowy pakiet nigdy, płatny po opłaceniu. */
export function isUnlocked(tier: AuditTier, paymentStatus: string): boolean {
  return TIERS[tier].priceGrosz > 0 && paymentStatus === "paid";
}

export async function buildReport(token: string): Promise<ReportDTO | null> {
  const order = await prisma.auditOrder.findUnique({
    where: { publicToken: token },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        include: {
          findings: { orderBy: { sortIndex: "asc" } },
          events: { orderBy: { createdAt: "asc" }, take: 60 },
        },
      },
    },
  });
  if (!order) return null;

  const tier = order.tier as AuditTier;
  const definition = TIERS[tier];
  const unlocked = isUnlocked(tier, order.paymentStatus);

  // Pokazujemy najnowszy ukończony run; jeśli żaden się nie skończył — bieżący.
  const finished = order.runs.find((run) => run.status === "done");
  const run = finished ?? order.runs[0] ?? null;

  const analysis = parse<AnalysisResult>(run?.analysis ?? null);
  const scores = parse<CategoryScores>(run?.scores ?? null);
  const lighthouse = parse<LighthouseResult>(run?.lighthouseData ?? null);
  const scrapeMeta = parse<{ pages: unknown[] }>(run?.scrapeData ?? null);

  const allFindings = run?.findings ?? [];
  const severityCounts: Record<AuditSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of allFindings) severityCounts[finding.severity as AuditSeverity] += 1;

  const findings: ReportFinding[] = allFindings.map((finding) => {
    const locked = !unlocked && !finding.isTeaser;
    return {
      id: finding.id,
      area: finding.area as ReportFinding["area"],
      severity: finding.severity as AuditSeverity,
      title: finding.title,
      // Zablokowane pozycje pokazują tytuł i wagę, ale nie treść — user widzi,
      // ile jeszcze zostało, bez dostawania produktu za darmo.
      problem: locked ? "" : finding.problem,
      recommendation: locked ? "" : finding.recommendation,
      evidence: locked ? null : finding.evidence,
      pageUrl: locked ? null : finding.pageUrl,
      impact: finding.impact,
      effortHours: locked ? 0 : finding.effortHours,
      priceGrosz: locked ? 0 : finding.priceGrosz,
      locked,
    };
  });

  const showQuote = unlocked && definition.quote;
  const quote = showQuote
    ? buildQuote(
        allFindings.map((f) => ({
          area: f.area as ReportFinding["area"],
          effortHours: f.effortHours,
          priceGrosz: f.priceGrosz,
        }))
      )
    : null;

  const upsell = TIER_ORDER.filter(
    (candidate) => tierRank(candidate) > tierRank(tier) || (candidate === tier && !unlocked && definition.priceGrosz > 0)
  )
    .filter((candidate) => TIERS[candidate].priceGrosz > 0)
    .map((candidate) => ({
      tier: candidate,
      label: TIERS[candidate].label,
      priceGrosz: TIERS[candidate].priceGrosz,
    }));

  return {
    token: order.publicToken,
    url: order.url,
    siteUrl: (parse<{ siteUrl: string }>(run?.scrapeData ?? null)?.siteUrl) ?? order.url,
    email: order.email,
    tier,
    paid: unlocked,
    createdAt: order.createdAt.toISOString(),
    run: run
      ? {
          id: run.id,
          status: run.status as RunStatus,
          stage: run.stage as RunStage,
          progress: run.progress,
          error: run.error,
          startedAt: run.startedAt?.toISOString() ?? null,
          finishedAt: run.finishedAt?.toISOString() ?? null,
        }
      : null,
    events:
      run?.events.map((event) => ({
        stage: event.stage,
        message: event.message,
        level: event.level,
        at: event.createdAt.toISOString(),
      })) ?? [],
    scores,
    lighthouse,
    pagesAnalyzed: scrapeMeta?.pages?.length ?? 0,
    summary: analysis
      ? {
          executiveSummary: analysis.executive_summary,
          firstImpression: analysis.first_impression,
          targetAudience: analysis.target_audience_guess,
          quickWins: analysis.quick_wins,
          categoryNotes: analysis.category_notes,
        }
      : null,
    findings,
    findingsTotal: allFindings.length,
    findingsLocked: findings.filter((f) => f.locked).length,
    severityCounts,
    quote,
    copyRewrites: unlocked && definition.copyRewrites ? (analysis?.copy_rewrites ?? []) : [],
    roadmap: unlocked && definition.roadmap ? (analysis?.roadmap ?? []) : [],
    capabilities: {
      pdf: unlocked && definition.pdf,
      quote: showQuote,
      copyRewrites: unlocked && definition.copyRewrites,
      roadmap: unlocked && definition.roadmap,
    },
    upsell,
  };
}
