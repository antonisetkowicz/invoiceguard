/**
 * Smoke test silnika audytu — bez sieci, bez Stripe'a, bez Claude'a.
 *
 *   npm run audit:smoke
 *
 * Sprawdza to, co da się sprawdzić deterministycznie: ekstrakcję sygnałów ze
 * strony, reguły i punktację, wycenę, bramkę pakietu (free vs opłacony)
 * i render PDF-a z polskimi znakami.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/db";
import type { AnalysisResult, LighthouseResult, ScrapeResult } from "@/types/audit";
import { runHeuristics } from "@/lib/audit/heuristics";
import { buildQuote, priceFinding } from "@/lib/audit/pricing";
import { extractSignals } from "@/lib/audit/scraper";
import { buildReport } from "@/lib/audit/report";
import { renderReportPdf } from "@/lib/audit/pdf";
import { normalizeInputUrl } from "@/lib/audit/url";
import { newToken } from "@/lib/audit/orders";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
  }
}

// Celowo kiepska strona: brak description, dwa H1, obrazy bez alt,
// formularz bez zgody, brak polityki prywatności, brak analityki.
const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="pl">
<head>
  <title>Witamy</title>
  <link rel="icon" href="/favicon.ico">
</head>
<body>
  <h1>Witamy na naszej stronie</h1>
  <h1>Drugi nagłówek H1</h1>
  <h2>Nasze usługi</h2>
  <p>Zajmujemy się remontami łazienek w Krakowie od 2008 roku. Wykonujemy kompleksowe
  usługi wykończeniowe: hydraulika, glazura, biały montaż. Zadzwoń i umów wycenę.</p>
  <img src="/foto1.jpg">
  <img src="/foto2.jpg" alt="Łazienka po remoncie" width="800" height="600">
  <a href="/oferta">Oferta</a>
  <a href="/cennik">Cennik</a>
  <a href="/kontakt">Kontakt</a>
  <a href="tel:+48123456789">Zadzwoń: 123 456 789</a>
  <form action="/wyslij" method="post">
    <input type="text" name="imie">
    <input type="email" name="email">
    <input type="tel" name="telefon">
    <textarea name="wiadomosc"></textarea>
    <button type="submit">Wyślij zapytanie</button>
  </form>
</body>
</html>`;

async function main() {
  console.log("\n1) Normalizacja adresu");
  check("„twojafirma.pl” → https", normalizeInputUrl("twojafirma.pl") === "https://twojafirma.pl");
  check("obcina utm_*", !normalizeInputUrl("https://a.pl/x?utm_source=fb&id=3").includes("utm_source"));
  let rejected = false;
  try {
    normalizeInputUrl("nie-domena");
  } catch {
    rejected = true;
  }
  check("odrzuca tekst bez domeny", rejected);

  console.log("\n2) Ekstrakcja sygnałów ze strony");
  const signals = extractSignals(FIXTURE_HTML, "https://demo.pl", "https://demo.pl", 200, 320, FIXTURE_HTML.length);
  check("tytuł", signals.title === "Witamy");
  check("brak meta description", signals.metaDescription === null);
  check("wykryto 2 × H1", signals.h1.length === 2, `jest ${signals.h1.length}`);
  check("1 obraz bez alt", signals.images.missingAlt === 1, `jest ${signals.images.missingAlt}`);
  check("wykryto formularz z 4 polami", signals.forms.fieldCounts[0] === 4, JSON.stringify(signals.forms.fieldCounts));
  check("formularz bez checkboxa zgody", signals.forms.hasConsentCheckbox === false);
  check("znaleziono telefon", signals.contact.phones.length > 0);
  check("wykryto CTA", signals.ctas.length > 0, JSON.stringify(signals.ctas));
  check("brak polityki prywatności", signals.trust.hasPrivacyPolicy === false);
  check("brak analityki", signals.scripts.analytics.length === 0);
  check("brak viewport", signals.hasViewport === false);

  console.log("\n3) Reguły i punktacja");
  const scrape: ScrapeResult = {
    requestedUrl: "https://demo.pl",
    siteUrl: "https://demo.pl",
    pages: [signals],
    discoveredLinks: [],
    robotsTxt: { found: true, disallowsAll: false },
    sitemap: { found: false, urlCount: 0 },
    https: true,
    wwwRedirectOk: true,
    errors: [],
  };
  const lighthouse: LighthouseResult = {
    provider: "psi",
    available: true,
    results: [
      {
        strategy: "mobile",
        performance: 42,
        accessibility: 71,
        bestPractices: 83,
        seo: 78,
        metrics: { lcpMs: 4300, clsScore: 0.24, inpMs: 210, fcpMs: 2100, ttfbMs: 1300, tbtMs: 640, speedIndexMs: 5200 },
        topOpportunities: [],
      },
    ],
  };

  const heuristics = runHeuristics(scrape, lighthouse);
  check("reguły się wykonały", heuristics.checks.length > 20, `${heuristics.checks.length} reguł`);
  check("wykryto problemy", heuristics.failed.length > 5, `${heuristics.failed.length} niezaliczonych`);
  check("wynik ogólny 0–100", heuristics.scores.overall >= 0 && heuristics.scores.overall <= 100);
  check("kiepska strona ma niski wynik", heuristics.scores.overall < 70, `wynik ${heuristics.scores.overall}`);
  check("wykryto brak viewportu", heuristics.failed.some((c) => c.id === "ux.viewport"));
  check("wykryto brak zgody RODO", heuristics.failed.some((c) => c.id === "trust.formConsent"));
  check("wykryto brak analityki", heuristics.failed.some((c) => c.id === "conv.analytics"));
  check("determinizm (drugi przebieg = ten sam wynik)",
    runHeuristics(scrape, lighthouse).scores.overall === heuristics.scores.overall);
  console.log(`     punktacja: ${JSON.stringify(heuristics.scores)}`);

  console.log("\n4) Wycena");
  const analysis: AnalysisResult = {
    executive_summary:
      "Strona wygląda poprawnie, ale nie sprzedaje. Nagłówek nie mówi, czym się zajmujecie, a formularz zbiera dane bez zgody — to realne ryzyko RODO. Największa strata to brak analityki: nie wiecie, ilu klientów odpada i gdzie.",
    first_impression: "Klient widzi „Witamy na naszej stronie” i musi zgadywać, co oferujecie.",
    target_audience_guess: "Właściciele mieszkań w Krakowie planujący remont łazienki.",
    quick_wins: ["Zmień nagłówek H1 na konkretną ofertę", "Dodaj checkbox zgody pod formularzem", "Wstaw meta description"],
    findings: [
      {
        area: "copy", severity: "critical", title: "Nagłówek nie mówi, co sprzedajesz",
        problem: "Nagłówek „Witamy na naszej stronie” nie zawiera oferty ani miasta. Klient z Google w 5 sekund nie wie, czy trafił dobrze, i wraca do wyników.",
        recommendation: "Zamień H1 na: „Remonty łazienek w Krakowie — kompleksowo, od hydrauliki po biały montaż”.",
        evidence: "Witamy na naszej stronie", page_url: "https://demo.pl", impact: 5, effort_hours: 0.5,
      },
      {
        area: "trust", severity: "critical", title: "Formularz zbiera dane bez zgody RODO",
        problem: "Formularz przyjmuje imię, e-mail i telefon, ale nie ma checkboxa zgody ani linku do polityki prywatności. To narusza RODO.",
        recommendation: "Dodaj checkbox z klauzulą zgody i podlinkuj politykę prywatności pod formularzem.",
        evidence: "formularz z 4 polami, brak input[type=checkbox]", page_url: "https://demo.pl", impact: 5, effort_hours: 2,
      },
      {
        area: "conversion", severity: "high", title: "Brak jakiejkolwiek analityki",
        problem: "Na stronie nie ma Google Analytics ani innego narzędzia. Nie wiadomo, ilu ludzi wchodzi i ilu wypełnia formularz.",
        recommendation: "Wepnij Google Analytics 4 i ustaw zdarzenie „wysłanie formularza” jako konwersję.",
        evidence: "0 wykrytych skryptów analitycznych", page_url: "", impact: 4, effort_hours: 1.5,
      },
      {
        area: "performance", severity: "high", title: "Strona ładuje się 4,3 s na telefonie",
        problem: "LCP wynosi 4,3 s przy normie 2,5 s. Co czwarty użytkownik mobilny wychodzi przed zobaczeniem treści.",
        recommendation: "Skompresuj zdjęcia do WebP i włącz lazy loading poniżej pierwszego ekranu.",
        evidence: "LCP 4300 ms, CLS 0.24", page_url: "", impact: 4, effort_hours: 4,
      },
    ],
    category_notes: {
      ux: "Brak meta viewport oznacza, że na telefonie strona wyświetla się jak pomniejszony desktop.",
      seo: "Tytuł jest zbyt ogólny, brakuje opisu i danych strukturalnych.",
      copy: "Treść merytoryczna jest, ale nagłówki nie prowadzą klienta do decyzji.",
      performance: "Główny problem to nieskompresowane zdjęcia i wolna odpowiedź serwera.",
      trust: "Największa luka: brak polityki prywatności i zgody przy formularzu.",
      conversion: "Ścieżka istnieje, ale nikt jej nie mierzy.",
    },
    copy_rewrites: [
      { location: "nagłówek H1 na stronie głównej", before: "Witamy na naszej stronie",
        after: "Remonty łazienek w Krakowie — od projektu po biały montaż", why: "Nazywa usługę i miasto w pierwszej sekundzie." },
    ],
    roadmap: [
      { horizon: "30", items: ["Zmiana nagłówka i meta description", "Checkbox zgody + polityka prywatności", "Wpięcie GA4"] },
      { horizon: "60", items: ["Kompresja zdjęć do WebP", "Dodanie meta viewport"] },
      { horizon: "90", items: ["Sekcja z opiniami klientów", "Dane strukturalne LocalBusiness"] },
    ],
  };

  const priced = analysis.findings.map((finding, index) => {
    const { hours, priceGrosz } = priceFinding(finding);
    return {
      area: finding.area, severity: finding.severity, title: finding.title, problem: finding.problem,
      recommendation: finding.recommendation, evidence: finding.evidence, pageUrl: finding.page_url || null,
      impact: finding.impact, effortHours: hours, priceGrosz, sortIndex: index, isTeaser: index < 3,
    };
  });
  const quote = buildQuote(priced);
  check("wycena > 0", quote.totalGrosz > 0, `${quote.totalGrosz} gr`);
  check("widełki obejmują sumę", quote.minGrosz < quote.totalGrosz && quote.maxGrosz > quote.totalGrosz);
  check("rozbicie na obszary", quote.byArea.length === 4, `${quote.byArea.length} obszarów`);
  console.log(`     razem: ${(quote.totalGrosz / 100).toFixed(0)} zł za ${quote.totalHours} h`);

  console.log("\n5) Bramka pakietu (free vs opłacony)");
  const token = newToken();
  const order = await prisma.auditOrder.create({
    data: { publicToken: token, url: "https://demo.pl", email: "smoke@example.com", tier: "free", paymentStatus: "none" },
  });
  const run = await prisma.auditRun.create({
    data: {
      orderId: order.id, tier: "free", status: "done", stage: "done", progress: 100,
      startedAt: new Date(), finishedAt: new Date(),
      scores: JSON.stringify(heuristics.scores),
      scrapeData: JSON.stringify(scrape),
      lighthouseData: JSON.stringify(lighthouse),
      analysis: JSON.stringify(analysis),
      quoteGrosz: quote.totalGrosz,
    },
  });
  await prisma.auditFinding.createMany({ data: priced.map((f) => ({ ...f, runId: run.id })) });

  const freeReport = await buildReport(token);
  check("raport free się zbudował", Boolean(freeReport));
  check("free: 3 widoczne znaleziska", freeReport!.findings.filter((f) => !f.locked).length === 3);
  check("free: reszta zablokowana", freeReport!.findingsLocked === 1, `${freeReport!.findingsLocked}`);
  check("free: brak wyceny", freeReport!.quote === null);
  check("free: brak PDF", freeReport!.capabilities.pdf === false);
  check("free: brak przepisanych tekstów", freeReport!.copyRewrites.length === 0);
  check("free: zablokowana treść nie wycieka",
    freeReport!.findings.filter((f) => f.locked).every((f) => f.problem === "" && f.recommendation === ""));
  check("free: proponuje upgrade", freeReport!.upsell.length > 0);

  await prisma.auditOrder.update({ where: { id: order.id }, data: { tier: "pro", paymentStatus: "paid", paidAt: new Date() } });
  await prisma.auditRun.update({ where: { id: run.id }, data: { tier: "pro" } });
  const paidReport = await buildReport(token);
  check("pro: wszystko odblokowane", paidReport!.findingsLocked === 0);
  check("pro: jest wycena", paidReport!.quote !== null);
  check("pro: PDF dostępny", paidReport!.capabilities.pdf === true);
  check("pro: są przepisane teksty", paidReport!.copyRewrites.length > 0);
  check("pro: jest roadmapa", paidReport!.roadmap.length === 3);

  console.log("\n6) Render PDF");
  const pdf = await renderReportPdf(paidReport!);
  const out = path.join(os.tmpdir(), `audyt-smoke-${Date.now()}.pdf`);
  fs.writeFileSync(out, pdf);
  const header = pdf.subarray(0, 5).toString("latin1");
  check("plik jest PDF-em", header === "%PDF-", header);
  check("ma sensowny rozmiar", pdf.length > 20_000, `${pdf.length} B`);
  check("font osadzony (polskie znaki)", pdf.includes(Buffer.from("FontFile")));
  console.log(`     zapisano: ${out}`);

  console.log("\n7) Sprzątanie");
  await prisma.auditOrder.delete({ where: { id: order.id } });
  check("dane testowe usunięte", (await prisma.auditOrder.findUnique({ where: { publicToken: token } })) === null);

  console.log(
    failures === 0
      ? "\n✅ Wszystkie sprawdzenia przeszły.\n"
      : `\n❌ Nieudanych sprawdzeń: ${failures}.\n`
  );
  console.log(
    "Uwaga: ten test celowo NIE dotyka sieci. Wywołania Claude'a, PageSpeed Insights\n" +
      "i Stripe'a sprawdzisz dopiero z kluczami w .env — patrz README.audyt.md.\n"
  );

  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
