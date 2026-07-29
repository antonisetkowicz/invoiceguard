import type { LighthouseResult, LighthouseStrategyResult } from "@/types/audit";
import { LIMITS } from "./config";

type Provider = "psi" | "local" | "off";

function provider(): Provider {
  const value = (process.env.AUDIT_LIGHTHOUSE_PROVIDER ?? "psi").toLowerCase();
  return value === "local" || value === "off" ? value : "psi";
}

function score(category: unknown): number | null {
  const value = (category as { score?: number | null } | undefined)?.score;
  return typeof value === "number" ? Math.round(value * 100) : null;
}

function numeric(audits: Record<string, unknown>, id: string): number | null {
  const audit = audits[id] as { numericValue?: number } | undefined;
  return typeof audit?.numericValue === "number" ? Math.round(audit.numericValue) : null;
}

/**
 * PageSpeed Insights — darmowe i bez klucza (klucz tylko podnosi limit).
 * To ta sama maszyneria co Lighthouse, ale bez Chrome'a na naszym serwerze.
 */
async function runPsi(url: string, strategy: "mobile" | "desktop"): Promise<LighthouseStrategyResult> {
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  for (const category of ["performance", "seo", "accessibility", "best-practices"]) {
    endpoint.searchParams.append("category", category);
  }
  if (process.env.PSI_API_KEY) endpoint.searchParams.set("key", process.env.PSI_API_KEY);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.psiTimeoutMs);
  let payload: Record<string, unknown>;
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`PageSpeed Insights zwróciło HTTP ${response.status}`);
    }
    payload = (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }

  const lhr = (payload.lighthouseResult ?? {}) as Record<string, unknown>;
  const categories = (lhr.categories ?? {}) as Record<string, unknown>;
  const audits = (lhr.audits ?? {}) as Record<string, unknown>;

  const opportunities = Object.entries(audits)
    .filter(([, audit]) => {
      const a = audit as { details?: { type?: string }; score?: number | null };
      return a.details?.type === "opportunity" && typeof a.score === "number" && a.score < 0.9;
    })
    .map(([id, audit]) => {
      const a = audit as { title?: string; details?: { overallSavingsMs?: number } };
      return {
        id,
        title: a.title ?? id,
        savingsMs: typeof a.details?.overallSavingsMs === "number" ? Math.round(a.details.overallSavingsMs) : null,
      };
    })
    .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))
    .slice(0, 6);

  return {
    strategy,
    performance: score(categories.performance),
    accessibility: score(categories.accessibility),
    bestPractices: score(categories["best-practices"]),
    seo: score(categories.seo),
    metrics: {
      lcpMs: numeric(audits, "largest-contentful-paint"),
      clsScore: (() => {
        const value = numeric(audits, "cumulative-layout-shift");
        const raw = (audits["cumulative-layout-shift"] as { numericValue?: number } | undefined)?.numericValue;
        return typeof raw === "number" ? Number(raw.toFixed(3)) : value;
      })(),
      inpMs: numeric(audits, "interaction-to-next-paint") ?? numeric(audits, "experimental-interaction-to-next-paint"),
      fcpMs: numeric(audits, "first-contentful-paint"),
      ttfbMs: numeric(audits, "server-response-time"),
      tbtMs: numeric(audits, "total-blocking-time"),
      speedIndexMs: numeric(audits, "speed-index"),
    },
    topOpportunities: opportunities,
  };
}

/**
 * Lokalny Lighthouse — wymaga `npm i lighthouse chrome-launcher` i Chrome'a
 * na hoście. Ładowany dynamicznie, żeby brak paczki nie wysypywał builda.
 */
async function runLocal(url: string, strategy: "mobile" | "desktop"): Promise<LighthouseStrategyResult> {
  const chromeLauncher = (await import(/* webpackIgnore: true */ "chrome-launcher" as string)) as {
    launch: (opts: unknown) => Promise<{ port: number; kill: () => Promise<void> }>;
  };
  const lighthouseModule = (await import(/* webpackIgnore: true */ "lighthouse" as string)) as {
    default: (url: string, flags: unknown, config: unknown) => Promise<{ lhr: Record<string, unknown> }>;
  };

  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-sandbox"] });
  try {
    const { lhr } = await lighthouseModule.default(
      url,
      { port: chrome.port, output: "json", logLevel: "error" },
      { extends: "lighthouse:default", settings: { formFactor: strategy, screenEmulation: { disabled: strategy === "desktop" } } }
    );
    const categories = (lhr.categories ?? {}) as Record<string, unknown>;
    const audits = (lhr.audits ?? {}) as Record<string, unknown>;
    return {
      strategy,
      performance: score(categories.performance),
      accessibility: score(categories.accessibility),
      bestPractices: score(categories["best-practices"]),
      seo: score(categories.seo),
      metrics: {
        lcpMs: numeric(audits, "largest-contentful-paint"),
        clsScore: numeric(audits, "cumulative-layout-shift"),
        inpMs: numeric(audits, "interaction-to-next-paint"),
        fcpMs: numeric(audits, "first-contentful-paint"),
        ttfbMs: numeric(audits, "server-response-time"),
        tbtMs: numeric(audits, "total-blocking-time"),
        speedIndexMs: numeric(audits, "speed-index"),
      },
      topOpportunities: [],
    };
  } finally {
    await chrome.kill().catch(() => {});
  }
}

/**
 * Nigdy nie przerywa audytu: brak wyniku Lighthouse degraduje raport,
 * ale nie blokuje wysyłki — reszta analizy jest niezależna.
 */
export async function runLighthouse(
  url: string,
  strategies: ("mobile" | "desktop")[],
  onProgress?: (message: string) => Promise<void> | void
): Promise<LighthouseResult> {
  const mode = provider();
  if (mode === "off") {
    return { provider: "off", available: false, note: "Pomiar wydajności wyłączony w konfiguracji.", results: [] };
  }

  const results: LighthouseStrategyResult[] = [];
  const notes: string[] = [];

  for (const strategy of strategies) {
    await onProgress?.(`Mierzę wydajność (${strategy === "mobile" ? "mobile" : "desktop"})…`);
    try {
      results.push(mode === "local" ? await runLocal(url, strategy) : await runPsi(url, strategy));
    } catch (error) {
      notes.push(`${strategy}: ${error instanceof Error ? error.message : "błąd pomiaru"}`);
    }
  }

  return {
    provider: mode,
    available: results.length > 0,
    note: notes.length ? notes.join(" · ") : undefined,
    results,
  };
}
