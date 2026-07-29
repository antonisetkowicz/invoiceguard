import type {
  CategoryScores,
  HeuristicCheck,
  HeuristicsResult,
  LighthouseResult,
  ScrapeResult,
} from "@/types/audit";

/**
 * Deterministyczne reguły. To one liczą punktację — Claude dostaje gotowe
 * fakty i pisze diagnozę, ale NIE ustala ocen. Dzięki temu dwa audyty tej
 * samej strony dają porównywalne liczby.
 */

interface Rule {
  id: string;
  area: HeuristicCheck["area"];
  severity: HeuristicCheck["severity"];
  label: string;
  /** true = jest dobrze */
  evaluate: (input: { scrape: ScrapeResult; lighthouse: LighthouseResult }) => { passed: boolean; detail: string } | null;
}

const WEIGHTS: Record<HeuristicCheck["severity"], number> = {
  critical: 26,
  high: 15,
  medium: 8,
  low: 4,
};

function home(scrape: ScrapeResult) {
  return scrape.pages[0];
}

function mobile(lh: LighthouseResult) {
  return lh.results.find((r) => r.strategy === "mobile") ?? lh.results[0] ?? null;
}

export const RULES: Rule[] = [
  // ---------- SEO ----------
  {
    id: "seo.title",
    area: "seo",
    severity: "critical",
    label: "Tytuł strony (title)",
    evaluate: ({ scrape }) => {
      const page = home(scrape);
      if (!page.title) return { passed: false, detail: "Strona nie ma znacznika <title> — Google nie wie, jak ją nazwać w wynikach." };
      const length = page.titleLength;
      if (length < 25 || length > 65) {
        return { passed: false, detail: `Tytuł ma ${length} znaków („${page.title}"). Optimum to 30–60 znaków.` };
      }
      return { passed: true, detail: `Tytuł ma ${length} znaków — mieści się w wynikach wyszukiwania.` };
    },
  },
  {
    id: "seo.description",
    area: "seo",
    severity: "high",
    label: "Meta description",
    evaluate: ({ scrape }) => {
      const page = home(scrape);
      if (!page.metaDescription) return { passed: false, detail: "Brak meta description — Google losowo wycina fragment tekstu na opis w wynikach." };
      const length = page.metaDescriptionLength;
      if (length < 70 || length > 165) return { passed: false, detail: `Opis ma ${length} znaków. Optimum to 120–158.` };
      return { passed: true, detail: `Opis ma ${length} znaków.` };
    },
  },
  {
    id: "seo.h1",
    area: "seo",
    severity: "high",
    label: "Nagłówek H1",
    evaluate: ({ scrape }) => {
      const count = home(scrape).h1.length;
      if (count === 0) return { passed: false, detail: "Strona nie ma nagłówka H1 — brakuje głównego komunikatu dla użytkownika i wyszukiwarki." };
      if (count > 1) return { passed: false, detail: `Na stronie jest ${count} nagłówków H1. Powinien być dokładnie jeden.` };
      return { passed: true, detail: `Jeden H1: „${home(scrape).h1[0]}".` };
    },
  },
  {
    id: "seo.https",
    area: "seo",
    severity: "critical",
    label: "Certyfikat HTTPS",
    evaluate: ({ scrape }) =>
      scrape.https
        ? { passed: true, detail: "Strona działa po HTTPS." }
        : { passed: false, detail: "Strona działa po HTTP. Przeglądarki pokazują ostrzeżenie „Niezabezpieczona”." },
  },
  {
    id: "seo.sitemap",
    area: "seo",
    severity: "medium",
    label: "Mapa strony (sitemap.xml)",
    evaluate: ({ scrape }) => {
      if (!scrape.sitemap) return null;
      return scrape.sitemap.found
        ? { passed: true, detail: `sitemap.xml zawiera ${scrape.sitemap.urlCount} adresów.` }
        : { passed: false, detail: "Brak sitemap.xml — Google wolniej znajduje podstrony." };
    },
  },
  {
    id: "seo.robots",
    area: "seo",
    severity: "critical",
    label: "robots.txt nie blokuje indeksowania",
    evaluate: ({ scrape }) => {
      if (!scrape.robotsTxt?.found) return null;
      return scrape.robotsTxt.disallowsAll
        ? { passed: false, detail: "robots.txt zawiera Disallow: / — cała strona jest wykluczona z Google." }
        : { passed: true, detail: "robots.txt nie blokuje indeksowania." };
    },
  },
  {
    id: "seo.noindex",
    area: "seo",
    severity: "critical",
    label: "Brak noindex",
    evaluate: ({ scrape }) => {
      const robots = home(scrape).robotsMeta ?? "";
      return /noindex/i.test(robots)
        ? { passed: false, detail: "Strona główna ma meta noindex — nie pojawi się w Google." }
        : { passed: true, detail: "Strona jest dostępna do indeksowania." };
    },
  },
  {
    id: "seo.canonical",
    area: "seo",
    severity: "low",
    label: "Link canonical",
    evaluate: ({ scrape }) =>
      home(scrape).canonical
        ? { passed: true, detail: "Ustawiony canonical." }
        : { passed: false, detail: "Brak canonical — ryzyko duplikacji treści przy wariantach adresu." },
  },
  {
    id: "seo.structuredData",
    area: "seo",
    severity: "medium",
    label: "Dane strukturalne (schema.org)",
    evaluate: ({ scrape }) => {
      const data = home(scrape).structuredData;
      return data.length
        ? { passed: true, detail: `Wykryto: ${data.join(", ")}.` }
        : { passed: false, detail: "Brak danych strukturalnych — tracisz rozszerzone wyniki w Google (gwiazdki, FAQ, dane firmy)." };
    },
  },
  {
    id: "seo.lang",
    area: "seo",
    severity: "low",
    label: "Atrybut lang",
    evaluate: ({ scrape }) =>
      home(scrape).lang
        ? { passed: true, detail: `lang="${home(scrape).lang}".` }
        : { passed: false, detail: "Brak atrybutu lang w <html> — utrudnia czytniki ekranu i tłumaczenie." },
  },

  // ---------- Wydajność ----------
  {
    id: "perf.score",
    area: "performance",
    severity: "high",
    label: "Wynik wydajności (mobile)",
    evaluate: ({ lighthouse }) => {
      const result = mobile(lighthouse);
      if (!result?.performance && result?.performance !== 0) return null;
      return result.performance >= 70
        ? { passed: true, detail: `Lighthouse Performance: ${result.performance}/100.` }
        : { passed: false, detail: `Lighthouse Performance: ${result.performance}/100 na telefonie. Poniżej 70 użytkownicy odczuwają czekanie.` };
    },
  },
  {
    id: "perf.lcp",
    area: "performance",
    severity: "high",
    label: "LCP — czas do największego elementu",
    evaluate: ({ lighthouse }) => {
      const lcp = mobile(lighthouse)?.metrics.lcpMs;
      if (lcp == null) return null;
      return lcp <= 2500
        ? { passed: true, detail: `LCP ${(lcp / 1000).toFixed(1)} s — w normie Google (≤ 2,5 s).` }
        : { passed: false, detail: `LCP ${(lcp / 1000).toFixed(1)} s przy normie 2,5 s. To pierwsze, co widzi klient.` };
    },
  },
  {
    id: "perf.cls",
    area: "performance",
    severity: "medium",
    label: "CLS — skakanie układu",
    evaluate: ({ lighthouse }) => {
      const cls = mobile(lighthouse)?.metrics.clsScore;
      if (cls == null) return null;
      return cls <= 0.1
        ? { passed: true, detail: `CLS ${cls} — układ jest stabilny.` }
        : { passed: false, detail: `CLS ${cls} przy normie 0,1 — treść przeskakuje podczas ładowania.` };
    },
  },
  {
    id: "perf.ttfb",
    area: "performance",
    severity: "medium",
    label: "Czas odpowiedzi serwera",
    evaluate: ({ lighthouse }) => {
      const ttfb = mobile(lighthouse)?.metrics.ttfbMs;
      if (ttfb == null) return null;
      return ttfb <= 800
        ? { passed: true, detail: `Serwer odpowiada w ${ttfb} ms.` }
        : { passed: false, detail: `Serwer odpowiada w ${ttfb} ms (norma ≤ 800 ms) — problem hostingu lub braku cache.` };
    },
  },
  {
    id: "perf.htmlWeight",
    area: "performance",
    severity: "low",
    label: "Waga kodu HTML",
    evaluate: ({ scrape }) => {
      const bytes = home(scrape).htmlBytes;
      return bytes <= 500_000
        ? { passed: true, detail: `HTML waży ${Math.round(bytes / 1024)} kB.` }
        : { passed: false, detail: `HTML waży ${Math.round(bytes / 1024)} kB — nadmiarowy kod spowalnia pierwsze wyświetlenie.` };
    },
  },
  {
    id: "perf.imageDimensions",
    area: "performance",
    severity: "low",
    label: "Wymiary obrazów w kodzie",
    evaluate: ({ scrape }) => {
      const page = home(scrape);
      if (page.images.total === 0) return null;
      const ratio = page.images.missingDimensions / page.images.total;
      return ratio < 0.5
        ? { passed: true, detail: "Większość obrazów ma zadeklarowane wymiary." }
        : { passed: false, detail: `${page.images.missingDimensions} z ${page.images.total} obrazów nie ma width/height — powoduje skakanie układu.` };
    },
  },

  // ---------- UX ----------
  {
    id: "ux.viewport",
    area: "ux",
    severity: "critical",
    label: "Wersja mobilna (viewport)",
    evaluate: ({ scrape }) =>
      home(scrape).hasViewport
        ? { passed: true, detail: "Meta viewport jest ustawiona." }
        : { passed: false, detail: "Brak meta viewport — na telefonie strona wyświetla się jak pomniejszony desktop." },
  },
  {
    id: "ux.altText",
    area: "ux",
    severity: "medium",
    label: "Opisy alternatywne obrazów",
    evaluate: ({ scrape }) => {
      const page = home(scrape);
      if (page.images.total === 0) return null;
      const ratio = page.images.missingAlt / page.images.total;
      return ratio <= 0.2
        ? { passed: true, detail: `${page.images.total - page.images.missingAlt} z ${page.images.total} obrazów ma alt.` }
        : { passed: false, detail: `${page.images.missingAlt} z ${page.images.total} obrazów nie ma atrybutu alt — problem dla dostępności i SEO obrazów.` };
    },
  },
  {
    id: "ux.accessibility",
    area: "ux",
    severity: "medium",
    label: "Dostępność (Lighthouse)",
    evaluate: ({ lighthouse }) => {
      const a11y = mobile(lighthouse)?.accessibility;
      if (a11y == null) return null;
      return a11y >= 85
        ? { passed: true, detail: `Dostępność: ${a11y}/100.` }
        : { passed: false, detail: `Dostępność: ${a11y}/100. Poniżej 85 zwykle oznacza zbyt niski kontrast lub pola bez etykiet.` };
    },
  },
  {
    id: "ux.jsOnly",
    area: "ux",
    severity: "high",
    label: "Treść widoczna bez JavaScriptu",
    evaluate: ({ scrape }) =>
      home(scrape).isLikelyJsOnly
        ? { passed: false, detail: "W kodzie HTML prawie nie ma treści — strona renderuje się dopiero JavaScriptem. Część robotów i wolniejszych urządzeń zobaczy pustą stronę." }
        : { passed: true, detail: "Treść jest obecna w kodzie HTML." },
  },
  {
    id: "ux.navigation",
    area: "ux",
    severity: "medium",
    label: "Nawigacja wewnętrzna",
    evaluate: ({ scrape }) => {
      const links = home(scrape).links.internal;
      if (links < 3) return { passed: false, detail: `Tylko ${links} linków wewnętrznych — użytkownik nie ma dokąd przejść.` };
      if (links > 90) return { passed: false, detail: `${links} linków wewnętrznych na jednym ekranie — przeciążona nawigacja utrudnia wybór.` };
      return { passed: true, detail: `${links} linków wewnętrznych.` };
    },
  },
  {
    id: "ux.favicon",
    area: "ux",
    severity: "low",
    label: "Favicon",
    evaluate: ({ scrape }) =>
      home(scrape).hasFavicon
        ? { passed: true, detail: "Favicon jest ustawiona." }
        : { passed: false, detail: "Brak favicony — karta w przeglądarce wygląda na niedokończoną." },
  },

  // ---------- Copy ----------
  {
    id: "copy.volume",
    area: "copy",
    severity: "high",
    label: "Ilość treści na stronie głównej",
    evaluate: ({ scrape }) => {
      const words = home(scrape).wordCount;
      if (words < 120) return { passed: false, detail: `Tylko ${words} słów na stronie głównej — za mało, by wyjaśnić ofertę i zbudować zaufanie.` };
      if (words > 2500) return { passed: false, detail: `${words} słów na stronie głównej — ściana tekstu, w której ginie oferta.` };
      return { passed: true, detail: `${words} słów na stronie głównej.` };
    },
  },
  {
    id: "copy.h1Quality",
    area: "copy",
    severity: "medium",
    label: "Jakość głównego nagłówka",
    evaluate: ({ scrape }) => {
      const h1 = home(scrape).h1[0];
      if (!h1) return null;
      const generic = /^(witamy|witaj|strona główna|home|o nas|start)/i.test(h1);
      if (generic) return { passed: false, detail: `Nagłówek „${h1}" nic nie mówi o ofercie. Klient w 5 sekund nie wie, co sprzedajesz.` };
      if (h1.length < 15) return { passed: false, detail: `Nagłówek „${h1}" jest zbyt krótki, by przekazać korzyść.` };
      return { passed: true, detail: `Nagłówek: „${h1}".` };
    },
  },
  {
    id: "copy.headingStructure",
    area: "copy",
    severity: "low",
    label: "Struktura nagłówków",
    evaluate: ({ scrape }) => {
      const page = home(scrape);
      return page.h2.length >= 2
        ? { passed: true, detail: `${page.h2.length} nagłówków H2 porządkuje treść.` }
        : { passed: false, detail: "Prawie brak nagłówków H2 — tekst jest jedną bryłą, trudną do skanowania wzrokiem." };
    },
  },
  {
    id: "copy.openGraph",
    area: "copy",
    severity: "medium",
    label: "Podgląd przy udostępnianiu (Open Graph)",
    evaluate: ({ scrape }) => {
      const og = home(scrape).openGraph;
      return og.title && og.image
        ? { passed: true, detail: "Open Graph ma tytuł i obrazek." }
        : { passed: false, detail: "Brak kompletnego Open Graph — link wrzucony na Facebooka czy LinkedIn wygląda jak goły adres." };
    },
  },

  // ---------- Zaufanie ----------
  {
    id: "trust.privacy",
    area: "trust",
    severity: "high",
    label: "Polityka prywatności",
    evaluate: ({ scrape }) =>
      home(scrape).trust.hasPrivacyPolicy
        ? { passed: true, detail: "Polityka prywatności jest podlinkowana." }
        : { passed: false, detail: "Brak polityki prywatności — wymagana przez RODO, jeśli zbierasz jakiekolwiek dane (także przez formularz czy analitykę)." },
  },
  {
    id: "trust.formConsent",
    area: "trust",
    severity: "high",
    label: "Zgoda przy formularzu",
    evaluate: ({ scrape }) => {
      const forms = home(scrape).forms;
      if (forms.count === 0) return null;
      return forms.hasConsentCheckbox
        ? { passed: true, detail: "Formularz ma pole zgody." }
        : { passed: false, detail: "Formularz zbiera dane bez checkboxa zgody — ryzyko RODO." };
    },
  },
  {
    id: "trust.contactData",
    area: "trust",
    severity: "high",
    label: "Dane kontaktowe",
    evaluate: ({ scrape }) => {
      const contact = home(scrape).contact;
      const hasAny = contact.emails.length > 0 || contact.phones.length > 0;
      return hasAny
        ? { passed: true, detail: `Na stronie jest ${contact.phones.length ? "telefon" : ""}${contact.phones.length && contact.emails.length ? " i " : ""}${contact.emails.length ? "e-mail" : ""}.` }
        : { passed: false, detail: "Na stronie głównej nie ma telefonu ani e-maila — klient gotowy do kontaktu musi ich szukać." };
    },
  },
  {
    id: "trust.identity",
    area: "trust",
    severity: "medium",
    label: "Dane firmy (NIP / adres)",
    evaluate: ({ scrape }) => {
      const t = home(scrape).trust;
      return t.hasNip || home(scrape).contact.hasAddress
        ? { passed: true, detail: "Strona podaje dane identyfikujące firmę." }
        : { passed: false, detail: "Brak NIP-u i adresu — anonimowa strona obniża zaufanie, zwłaszcza w B2B." };
    },
  },
  {
    id: "trust.socialProof",
    area: "trust",
    severity: "medium",
    label: "Dowód społeczny",
    evaluate: ({ scrape }) =>
      home(scrape).trust.hasTestimonials
        ? { passed: true, detail: "Są opinie lub referencje." }
        : { passed: false, detail: "Brak opinii, referencji czy logotypów klientów — nic nie potwierdza, że komuś już pomogłeś." },
  },

  // ---------- Konwersja ----------
  {
    id: "conv.cta",
    area: "conversion",
    severity: "critical",
    label: "Wezwanie do działania (CTA)",
    evaluate: ({ scrape }) => {
      const ctas = home(scrape).ctas;
      if (ctas.length === 0) return { passed: false, detail: "Nie znaleziono żadnego wezwania do działania. Strona informuje, ale o nic nie prosi." };
      if (ctas.length > 12) return { passed: false, detail: `${ctas.length} różnych CTA — rozproszona uwaga, brak jednej ścieżki.` };
      return { passed: true, detail: `Wykryte CTA: ${ctas.slice(0, 5).join(", ")}.` };
    },
  },
  {
    id: "conv.form",
    area: "conversion",
    severity: "high",
    label: "Formularz kontaktowy",
    evaluate: ({ scrape }) => {
      const forms = home(scrape).forms;
      if (forms.count === 0) {
        return { passed: false, detail: "Na stronie głównej nie ma formularza — jedyna droga kontaktu to telefon lub szukanie zakładki." };
      }
      const longest = Math.max(...forms.fieldCounts, 0);
      if (longest > 6) return { passed: false, detail: `Formularz ma ${longest} pól. Każde dodatkowe pole powyżej 4 obniża liczbę wypełnień.` };
      return { passed: true, detail: `Formularz ma ${longest} pól.` };
    },
  },
  {
    id: "conv.analytics",
    area: "conversion",
    severity: "high",
    label: "Analityka",
    evaluate: ({ scrape }) => {
      const analytics = home(scrape).scripts.analytics;
      return analytics.length
        ? { passed: true, detail: `Wykryto: ${analytics.join(", ")}.` }
        : { passed: false, detail: "Brak jakiejkolwiek analityki — nie wiesz, ilu ludzi wchodzi i gdzie odpadają." };
    },
  },
  {
    id: "conv.social",
    area: "conversion",
    severity: "low",
    label: "Profile społecznościowe",
    evaluate: ({ scrape }) =>
      home(scrape).social.length
        ? { passed: true, detail: `Linki do: ${home(scrape).social.join(", ")}.` }
        : { passed: false, detail: "Brak linków do social media — trudniej podtrzymać kontakt z osobą, która jeszcze nie kupuje." },
  },
];

function scoreArea(checks: HeuristicCheck[], area: HeuristicCheck["area"]): number {
  const relevant = checks.filter((c) => c.area === area);
  if (relevant.length === 0) return 75; // brak sygnałów → neutralnie, nie karzemy
  const penalty = relevant.filter((c) => !c.passed).reduce((sum, c) => sum + WEIGHTS[c.severity], 0);
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export function runHeuristics(scrape: ScrapeResult, lighthouse: LighthouseResult): HeuristicsResult {
  const checks: HeuristicCheck[] = [];
  for (const rule of RULES) {
    const outcome = rule.evaluate({ scrape, lighthouse });
    if (!outcome) continue; // reguła nie ma zastosowania (np. brak formularzy)
    checks.push({
      id: rule.id,
      area: rule.area,
      severity: rule.severity,
      label: rule.label,
      passed: outcome.passed,
      detail: outcome.detail,
    });
  }

  const performance = scoreArea(checks, "performance");
  const seo = scoreArea(checks, "seo");
  const ux = scoreArea(checks, "ux");
  const copy = scoreArea(checks, "copy");
  const trust = scoreArea(checks, "trust");
  const conversion = scoreArea(checks, "conversion");

  const scores: CategoryScores = {
    performance,
    seo,
    ux,
    copy,
    trust,
    conversion,
    // Konwersja i UX ważą najwięcej — to one przekładają się na pieniądze.
    overall: Math.round(
      conversion * 0.25 + ux * 0.2 + seo * 0.18 + copy * 0.15 + trust * 0.12 + performance * 0.1
    ),
  };

  return { scores, checks, failed: checks.filter((c) => !c.passed) };
}
