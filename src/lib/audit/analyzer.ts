import Anthropic from "@anthropic-ai/sdk";
import type {
  AnalysisFinding,
  AnalysisResult,
  AuditTier,
  HeuristicsResult,
  LighthouseResult,
  ScrapeResult,
} from "@/types/audit";
import { MODEL_ID, TIERS } from "./config";

const AREAS = ["ux", "seo", "copy", "performance", "trust", "conversion", "tech"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/**
 * Structured outputs: gwarantują kształt odpowiedzi, więc można ją zapisać
 * do bazy bez defensywnego parsowania. Schemat nie może zawierać ograniczeń
 * liczbowych/długości (nieobsługiwane) — zakresy pilnujemy w prompcie i clampem.
 */
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "executive_summary",
    "first_impression",
    "target_audience_guess",
    "quick_wins",
    "findings",
    "category_notes",
    "copy_rewrites",
    "roadmap",
  ],
  properties: {
    executive_summary: { type: "string", description: "3–5 zdań dla właściciela firmy: co ta strona robi dobrze, co ją najbardziej kosztuje." },
    first_impression: { type: "string", description: "2–3 zdania: co widzi klient w pierwszych 5 sekundach." },
    target_audience_guess: { type: "string", description: "1–2 zdania: do kogo ta strona mówi, na podstawie treści." },
    quick_wins: { type: "array", items: { type: "string" }, description: "3–5 poprawek do zrobienia w mniej niż godzinę." },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "severity", "title", "problem", "recommendation", "evidence", "page_url", "impact", "effort_hours"],
        properties: {
          area: { type: "string", enum: AREAS },
          severity: { type: "string", enum: SEVERITIES },
          title: { type: "string", description: "Krótki tytuł poprawki, do 80 znaków." },
          problem: { type: "string", description: "2–3 zdania: na czym polega problem i co kosztuje biznesowo." },
          recommendation: { type: "string", description: "Konkretna instrukcja wdrożenia. Jeśli chodzi o tekst, podaj gotową treść." },
          evidence: { type: "string", description: "Dosłowny cytat ze strony lub konkretna liczba z pomiarów. Pusty string, jeśli brak." },
          page_url: { type: "string", description: "Adres podstrony, której dotyczy. Pusty string, jeśli dotyczy całej strony." },
          impact: { type: "integer", enum: [1, 2, 3, 4, 5], description: "Wpływ na wynik biznesowy, 5 = największy." },
          effort_hours: { type: "number", description: "Realistyczny czas wdrożenia w godzinach, od 0.25 do 40." },
        },
      },
    },
    category_notes: {
      type: "object",
      additionalProperties: false,
      required: ["ux", "seo", "copy", "performance", "trust", "conversion"],
      properties: {
        ux: { type: "string" },
        seo: { type: "string" },
        copy: { type: "string" },
        performance: { type: "string" },
        trust: { type: "string" },
        conversion: { type: "string" },
      },
    },
    copy_rewrites: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["location", "before", "after", "why"],
        properties: {
          location: { type: "string", description: "Gdzie na stronie, np. „nagłówek H1 na stronie głównej”." },
          before: { type: "string", description: "Obecny tekst, dosłownie." },
          after: { type: "string", description: "Nowy tekst gotowy do wklejenia." },
          why: { type: "string", description: "Jedno zdanie uzasadnienia." },
        },
      },
    },
    roadmap: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["horizon", "items"],
        properties: {
          horizon: { type: "string", enum: ["30", "60", "90"] },
          items: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `Jesteś doświadczonym audytorem stron WWW pracującym dla polskich małych i średnich firm.
Piszesz po polsku, do właściciela firmy — nie do programisty. Zero żargonu bez wyjaśnienia.

Zasady:
- Każde znalezisko musi być oparte na FAKTACH z dostarczonych danych. Nie zgaduj, czego nie widzisz w danych.
- W polu evidence podawaj dosłowny cytat ze strony albo konkretną liczbę z pomiarów. Nie parafrazuj.
- Rekomendacja ma być wykonalna: co dokładnie zmienić. Przy tekstach podaj gotową treść do wklejenia, a nie opis „popraw nagłówek”.
- Nazywaj koszt biznesowy, nie tylko usterkę techniczną („klient nie znajduje telefonu i dzwoni do konkurencji”, nie „brak numeru telefonu”).
- effort_hours to realistyczny czas dla wykonawcy, który zna to narzędzie: zmiana tekstu 0,25–1 h, poprawka szablonu 1–4 h, przebudowa sekcji 4–12 h, nowa podstrona 8–20 h.
- Nie oceniaj punktowo — punktacja jest policzona osobno i nie jest Twoim zadaniem.
- Nie wymyślaj poprawek na siłę. Jeśli obszar jest w porządku, napisz to wprost w category_notes.
- Pisz zwięźle. Właściciel firmy ma przeczytać raport w 10 minut i wiedzieć, co zlecić.`;

function compactPages(scrape: ScrapeResult) {
  return scrape.pages.map((page) => ({
    url: page.finalUrl,
    status: page.httpStatus,
    title: page.title,
    meta_description: page.metaDescription,
    h1: page.h1,
    h2: page.h2.slice(0, 12),
    liczba_slow: page.wordCount,
    // Próbka treści: to na jej podstawie powstają cytaty i przepisane teksty.
    tresc: page.textSample.slice(0, scrape.pages.length > 3 ? 1800 : 4000),
    cta: page.ctas,
    formularze: page.forms,
    kontakt: page.contact,
    zaufanie: page.trust,
    obrazy: page.images,
    linki: page.links,
    open_graph: page.openGraph,
    dane_strukturalne: page.structuredData,
    analityka: page.scripts.analytics,
    tylko_javascript: page.isLikelyJsOnly,
  }));
}

function buildUserPrompt(
  scrape: ScrapeResult,
  lighthouse: LighthouseResult,
  heuristics: HeuristicsResult,
  tier: AuditTier,
  context: { goal?: string | null; companyName?: string | null }
): string {
  const definition = TIERS[tier];
  const extras: string[] = [];
  if (definition.copyRewrites) {
    extras.push(
      "- copy_rewrites: 5–8 gotowych tekstów do wklejenia (nagłówek główny, podtytuł, teksty przycisków, sekcja o firmie, opis oferty). W polu before wstaw dosłowny obecny tekst ze strony."
    );
  } else {
    extras.push("- copy_rewrites: pusta tablica (ten pakiet nie zawiera przepisywania tekstów).");
  }
  if (definition.roadmap) {
    extras.push(
      "- roadmap: trzy horyzonty (30, 60, 90 dni), po 3–5 pozycji, uporządkowane od najszybszego zwrotu. Pozycje muszą pokrywać się ze znaleziskami."
    );
  } else {
    extras.push("- roadmap: pusta tablica (ten pakiet nie zawiera roadmapy).");
  }

  const findingsTarget = tier === "free" ? "6–10" : tier === "basic" ? "10–16" : "14–22";

  return `Przeanalizuj tę stronę i przygotuj audyt.

## Kontekst zamówienia
- Adres: ${scrape.siteUrl}
- Pakiet: ${definition.label}
- Firma (deklaracja klienta): ${context.companyName || "nie podano"}
- Cel strony wg klienta: ${context.goal || "nie podano — wywnioskuj z treści"}
- Przeanalizowane podstrony: ${scrape.pages.length}

## Dane techniczne strony
${JSON.stringify(
  {
    https: scrape.https,
    robots_txt: scrape.robotsTxt,
    sitemap: scrape.sitemap,
    wariant_www_dziala: scrape.wwwRedirectOk,
    bledy_pobierania: scrape.errors,
  },
  null,
  1
)}

## Pomiary wydajności (Lighthouse / PageSpeed Insights)
${lighthouse.available ? JSON.stringify(lighthouse.results, null, 1) : "Brak pomiaru: " + (lighthouse.note ?? "niedostępny")}

## Wynik reguł automatycznych (już policzony — użyj jako faktów, nie licz ponownie)
Punktacja: ${JSON.stringify(heuristics.scores)}
Reguły niezaliczone:
${heuristics.failed.map((c) => `- [${c.severity}/${c.area}] ${c.label}: ${c.detail}`).join("\n") || "- brak"}
Reguły zaliczone:
${heuristics.checks.filter((c) => c.passed).map((c) => `- ${c.label}: ${c.detail}`).join("\n") || "- brak"}

## Zawartość podstron
${JSON.stringify(compactPages(scrape), null, 1)}

## Czego oczekuję
- findings: ${findingsTarget} znalezisk, posortowanych od najważniejszego. Każde niezaliczone krytyczne lub wysokie ryzyko z listy reguł musi mieć swoje znalezisko — rozwinięte o kontekst biznesowy, nie przepisane jeden do jednego. Dodaj też problemy, których reguły nie wykrywają: jakość oferty, jasność komunikatu, ścieżka zakupowa, brakujące treści.
- category_notes: po 1–2 zdania na obszar, konkretnie o TEJ stronie.
${extras.join("\n")}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sanitize(result: AnalysisResult, tier: AuditTier): AnalysisResult {
  const definition = TIERS[tier];
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;

  const findings: AnalysisFinding[] = result.findings
    .filter((f) => f.title?.trim() && f.recommendation?.trim())
    .map((f) => ({
      ...f,
      title: f.title.trim().slice(0, 140),
      impact: Math.round(clamp(f.impact, 1, 5)),
      effort_hours: Number(clamp(f.effort_hours, 0.25, 40).toFixed(2)),
    }))
    .sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        b.impact - a.impact ||
        a.effort_hours - b.effort_hours
    );

  return {
    ...result,
    findings,
    quick_wins: result.quick_wins.slice(0, 6),
    copy_rewrites: definition.copyRewrites ? result.copy_rewrites.slice(0, 10) : [],
    roadmap: definition.roadmap ? result.roadmap : [],
  };
}

export async function analyze(
  scrape: ScrapeResult,
  lighthouse: LighthouseResult,
  heuristics: HeuristicsResult,
  tier: AuditTier,
  context: { goal?: string | null; companyName?: string | null } = {}
): Promise<AnalysisResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Brak ANTHROPIC_API_KEY — silnik analizy nie może wystartować.");
  }

  const client = new Anthropic();

  // Streaming: odpowiedź bywa długa (do ~20 znalezisk + przepisane teksty),
  // a strumień chroni przed timeoutem HTTP przy dużym max_tokens.
  const stream = client.messages.stream({
    model: MODEL_ID,
    max_tokens: 32_000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: RESPONSE_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [{ role: "user", content: buildUserPrompt(scrape, lighthouse, heuristics, tier, context) }],
  } as Anthropic.MessageStreamParams);

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("Model odmówił analizy tej strony. Sprawdź, czy adres nie prowadzi do treści niedozwolonych.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Odpowiedź modelu została ucięta. Spróbuj ponownie — przy powtórce zwykle przechodzi.");
  }

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model nie zwrócił treści analizy.");
  }

  let parsed: AnalysisResult;
  try {
    parsed = JSON.parse(textBlock.text) as AnalysisResult;
  } catch {
    throw new Error("Nie udało się odczytać odpowiedzi modelu jako JSON.");
  }

  return sanitize(parsed, tier);
}
