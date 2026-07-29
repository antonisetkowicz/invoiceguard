import { prisma } from "@/lib/db";
import type { AuditTier } from "@/types/audit";
import { analyze } from "./analyzer";
import { TIERS } from "./config";
import { runHeuristics } from "./heuristics";
import { runLighthouse } from "./lighthouse";
import { buildQuote, priceFinding } from "./pricing";
import { failRun, heartbeat, logEvent, setStage } from "./queue";
import { scrapeSite } from "./scraper";
import { normalizeInputUrl } from "./url";

/**
 * Sześć etapów jednego audytu. Każdy etap raportuje postęp do bazy,
 * bo panel wyników pokazuje go na żywo (polling), a nie kręcące się kółko.
 */
export async function executeRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  const run = await prisma.auditRun.findUnique({ where: { id: runId }, include: { order: true } });
  if (!run) return { ok: false, error: "Run nie istnieje." };

  const tier = run.tier as AuditTier;
  const definition = TIERS[tier];
  const keepAlive = setInterval(() => void heartbeat(runId), 20_000);

  try {
    const url = normalizeInputUrl(run.order.url);

    // 1. Scraper -----------------------------------------------------------
    await setStage(runId, "scrape", 10, `Analizuję stronę ${url}`);
    const scrape = await scrapeSite(url, definition.maxPages, (message) => logEvent(runId, "scrape", message));
    await logEvent(runId, "scrape", `Pobrano ${scrape.pages.length} ${scrape.pages.length === 1 ? "stronę" : "podstron"}.`);
    for (const error of scrape.errors) await logEvent(runId, "scrape", error, "warn");

    // 2. Lighthouse --------------------------------------------------------
    await setStage(runId, "lighthouse", 35, "Mierzę szybkość i Core Web Vitals");
    const lighthouse = await runLighthouse(scrape.siteUrl, definition.strategies, (message) =>
      logEvent(runId, "lighthouse", message)
    );
    if (!lighthouse.available) {
      await logEvent(runId, "lighthouse", `Pomiar wydajności niedostępny: ${lighthouse.note ?? "brak szczegółów"}. Raport powstanie bez tej sekcji.`, "warn");
    }

    // 3. Heurystyki --------------------------------------------------------
    await setStage(runId, "heuristics", 50, "Sprawdzam reguły techniczne i UX");
    const heuristics = runHeuristics(scrape, lighthouse);
    await logEvent(
      runId,
      "heuristics",
      `Sprawdzono ${heuristics.checks.length} reguł, ${heuristics.failed.length} wymaga poprawy. Wynik ogólny: ${heuristics.scores.overall}/100.`
    );

    // 4. Analiza Claude ----------------------------------------------------
    await setStage(runId, "analyze", 62, "Claude analizuje UX, SEO i teksty");
    const analysis = await analyze(scrape, lighthouse, heuristics, tier, {
      goal: run.order.goal,
      companyName: run.order.companyName,
    });
    await logEvent(runId, "analyze", `Model zwrócił ${analysis.findings.length} znalezisk.`);

    // 5. Wycena ------------------------------------------------------------
    await setStage(runId, "pricing", 85, "Wyceniam wdrożenie poprawek");
    const priced = analysis.findings.map((finding, index) => {
      const { hours, priceGrosz } = priceFinding(finding);
      return {
        area: finding.area,
        severity: finding.severity,
        title: finding.title,
        problem: finding.problem,
        recommendation: finding.recommendation,
        evidence: finding.evidence?.trim() || null,
        pageUrl: finding.page_url?.trim() || null,
        impact: finding.impact,
        effortHours: hours,
        priceGrosz,
        sortIndex: index,
        // Teaser: pierwsze N znalezisk widocznych bez płatności.
        isTeaser: definition.maxVisibleFindings === null || index < definition.maxVisibleFindings,
      };
    });
    const quote = buildQuote(priced);

    // 6. Zapis -------------------------------------------------------------
    await setStage(runId, "report", 95, "Składam raport");
    await prisma.$transaction([
      prisma.auditFinding.deleteMany({ where: { runId } }),
      prisma.auditFinding.createMany({ data: priced.map((finding) => ({ ...finding, runId })) }),
      prisma.auditRun.update({
        where: { id: runId },
        data: {
          status: "done",
          stage: "done",
          progress: 100,
          error: null,
          finishedAt: new Date(),
          scores: JSON.stringify(heuristics.scores),
          scrapeData: JSON.stringify({ ...scrape, heuristicChecks: heuristics.checks }),
          lighthouseData: JSON.stringify(lighthouse),
          analysis: JSON.stringify(analysis),
          quoteGrosz: quote.totalGrosz,
        },
      }),
    ]);
    await logEvent(runId, "done", "Raport gotowy.");

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nieznany błąd silnika audytu.";
    await failRun(runId, message);
    return { ok: false, error: message };
  } finally {
    clearInterval(keepAlive);
  }
}
