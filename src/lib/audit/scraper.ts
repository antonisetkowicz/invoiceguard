import * as cheerio from "cheerio";
import type { PageSignals, ScrapeResult } from "@/types/audit";
import { safeFetch, sameSite } from "./url";

const CTA_PATTERN =
  /(kup|zamów|zamow|kupuj|dodaj do koszyka|napisz|zadzwoń|zadzwon|umów|umow|wyceń|wycen|zapytaj|skontaktuj|wyślij|wyslij|rezerwuj|sprawdź ofert|pobierz|zapisz się|zapisz sie|załóż|zaloz|wypróbuj|wyprobuj|start|demo|konsultacj|darmow)/i;

const ANALYTICS_HINTS: { id: string; pattern: RegExp }[] = [
  { id: "Google Analytics / GTM", pattern: /googletagmanager\.com|google-analytics\.com|gtag\(/i },
  { id: "Meta Pixel", pattern: /connect\.facebook\.net|fbq\(/i },
  { id: "Hotjar", pattern: /hotjar\.com/i },
  { id: "Clarity", pattern: /clarity\.ms/i },
  { id: "Matomo", pattern: /matomo|piwik/i },
  { id: "Google Ads", pattern: /googleadservices|googlesyndication/i },
];

const PRIVACY_PATTERN = /(polityka prywatno|privacy policy|rodo|ochrona danych)/i;
const TERMS_PATTERN = /(regulamin|terms of service|warunki korzystania)/i;
const TESTIMONIAL_PATTERN = /(opinie|referencj|testimonial|co mówią|co mowia|zaufali nam|nasi klienci)/i;
const ADDRESS_PATTERN = /(ul\.|al\.|\bpl\.\s|\d{2}-\d{3})/i;
const NIP_PATTERN = /nip[:\s]*\d[\d\s-]{8,}/i;
const PHONE_PATTERN = /(?:\+48[\s-]?)?(?:\d{3}[\s-]?\d{3}[\s-]?\d{3}|\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g;
const SOCIAL_PATTERN =
  /(facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com)/i;

function text(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function extractSignals(html: string, requestedUrl: string, finalUrl: string, status: number, loadMs: number, bytes: number): PageSignals {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  const $full = cheerio.load(html); // wersja z <script> do analizy technicznej

  const bodyText = text($("body").text());
  const words = bodyText.split(/\s+/).filter((w) => w.length > 1);

  const headings = (selector: string) =>
    $(selector)
      .map((_, el) => text($(el).text()))
      .get()
      .filter(Boolean)
      .slice(0, 25);

  const images = $full("img");
  const links = $full("a[href]");
  const internal: string[] = [];
  let external = 0;
  let nofollow = 0;
  let emptyLinks = 0;

  links.each((_, el) => {
    const href = $full(el).attr("href") ?? "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      emptyLinks++;
      return;
    }
    let absolute: string;
    try {
      absolute = new URL(href, finalUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/.test(absolute)) return;
    if (($full(el).attr("rel") ?? "").includes("nofollow")) nofollow++;
    if (sameSite(absolute, finalUrl)) internal.push(absolute.split("#")[0]);
    else external++;
  });

  const ctas = $full("a, button, input[type=submit]")
    .map((_, el) => text($full(el).attr("value") ?? $full(el).text()))
    .get()
    .filter((label) => label.length > 1 && label.length < 60 && CTA_PATTERN.test(label));

  const forms = $full("form");
  const fieldCounts = forms
    .map((_, el) => $full(el).find("input:not([type=hidden]), textarea, select").length)
    .get();

  const scriptsRaw = $full("script");
  const scriptBlob = scriptsRaw
    .map((_, el) => ($full(el).attr("src") ?? "") + " " + ($full(el).html() ?? "").slice(0, 400))
    .get()
    .join(" ");

  const linkText = $full("a")
    .map((_, el) => text($full(el).text()) + " " + ($full(el).attr("href") ?? ""))
    .get()
    .join(" \n ");

  const structuredData = $full('script[type="application/ld+json"]')
    .map((_, el) => {
      try {
        const parsed = JSON.parse($full(el).html() ?? "{}");
        const nodes = Array.isArray(parsed) ? parsed : [parsed];
        return nodes.map((n) => String(n["@type"] ?? "unknown")).join(",");
      } catch {
        return "invalid-json-ld";
      }
    })
    .get();

  const title = text($full("title").first().text()) || null;
  const metaDescription = text($full('meta[name="description"]').attr("content")) || null;

  return {
    url: requestedUrl,
    finalUrl,
    httpStatus: status,
    fetchedAt: new Date().toISOString(),
    loadMs,
    htmlBytes: bytes,
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    metaDescriptionLength: metaDescription?.length ?? 0,
    canonical: $full('link[rel="canonical"]').attr("href") ?? null,
    lang: $full("html").attr("lang") ?? null,
    hasViewport: $full('meta[name="viewport"]').length > 0,
    hasFavicon: $full('link[rel*="icon"]').length > 0,
    robotsMeta: $full('meta[name="robots"]').attr("content") ?? null,
    h1: headings("h1"),
    h2: headings("h2"),
    h3: headings("h3"),
    wordCount: words.length,
    textSample: bodyText.slice(0, 6000),
    images: {
      total: images.length,
      missingAlt: images.filter((_, el) => !($full(el).attr("alt") ?? "").trim()).length,
      emptySrc: images.filter((_, el) => !($full(el).attr("src") ?? "").trim()).length,
      missingDimensions: images.filter(
        (_, el) => !$full(el).attr("width") || !$full(el).attr("height")
      ).length,
    },
    links: {
      internal: new Set(internal).size,
      external,
      nofollow,
      empty: emptyLinks,
    },
    ctas: [...new Set(ctas)].slice(0, 20),
    forms: {
      count: forms.length,
      fieldCounts,
      hasConsentCheckbox: $full('form input[type="checkbox"]').length > 0,
    },
    contact: {
      emails: [...new Set(bodyText.match(EMAIL_PATTERN) ?? [])].slice(0, 5),
      phones: [...new Set(bodyText.match(PHONE_PATTERN) ?? [])].slice(0, 5),
      hasContactPage: /kontakt|contact/i.test(linkText),
      hasAddress: ADDRESS_PATTERN.test(bodyText),
    },
    trust: {
      hasPrivacyPolicy: PRIVACY_PATTERN.test(linkText) || PRIVACY_PATTERN.test(bodyText),
      hasTerms: TERMS_PATTERN.test(linkText),
      hasCookieBanner: /cookie|ciasteczk/i.test(html),
      hasNip: NIP_PATTERN.test(bodyText),
      hasTestimonials: TESTIMONIAL_PATTERN.test(bodyText),
    },
    social: [
      ...new Set(
        $full("a[href]")
          .map((_, el) => $full(el).attr("href") ?? "")
          .get()
          .filter((href) => SOCIAL_PATTERN.test(href))
          .map((href) => (href.match(SOCIAL_PATTERN) as RegExpMatchArray)[1])
      ),
    ],
    openGraph: {
      title: text($full('meta[property="og:title"]').attr("content")) || null,
      description: text($full('meta[property="og:description"]').attr("content")) || null,
      image: $full('meta[property="og:image"]').attr("content") ?? null,
    },
    structuredData,
    scripts: {
      total: scriptsRaw.length,
      inline: scriptsRaw.filter((_, el) => !$full(el).attr("src")).length,
      analytics: ANALYTICS_HINTS.filter((h) => h.pattern.test(scriptBlob)).map((h) => h.id),
    },
    // Strona SPA: dużo <script>, prawie zero treści w HTML — Google i my widzimy pustkę.
    isLikelyJsOnly: words.length < 60 && scriptsRaw.length > 3,
  };
}

/** Wybiera podstrony do audytu: preferuje oferta/cennik/kontakt/o nas. */
export function pickSubpages(links: string[], homeUrl: string, limit: number): string[] {
  const priority = /(oferta|uslugi|usługi|produkt|cennik|price|kontakt|contact|o-nas|about|sklep|shop|realizacj|portfolio|blog)/i;
  const unique = [...new Set(links)].filter(
    (link) => link !== homeUrl && !/\.(pdf|jpg|jpeg|png|gif|svg|zip|docx?|xlsx?)$/i.test(link)
  );
  const ranked = unique.sort((a, b) => {
    const scoreA = (priority.test(a) ? 0 : 1) * 1000 + a.length;
    const scoreB = (priority.test(b) ? 0 : 1) * 1000 + b.length;
    return scoreA - scoreB;
  });
  return ranked.slice(0, limit);
}

async function checkRobots(origin: string) {
  try {
    const res = await safeFetch(origin + "/robots.txt", { maxBytes: 200_000, accept: "text/plain" });
    if (res.status !== 200) return { found: false, disallowsAll: false };
    const blocksAll = /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(\n|$)/i.test(res.body);
    return { found: true, disallowsAll: blocksAll };
  } catch {
    return null;
  }
}

async function checkSitemap(origin: string) {
  try {
    const res = await safeFetch(origin + "/sitemap.xml", { maxBytes: 2_000_000, accept: "application/xml" });
    if (res.status !== 200) return { found: false, urlCount: 0 };
    return { found: true, urlCount: (res.body.match(/<loc>/g) ?? []).length };
  } catch {
    return null;
  }
}

export async function scrapeSite(
  requestedUrl: string,
  maxPages: number,
  onProgress?: (message: string) => Promise<void> | void
): Promise<ScrapeResult> {
  const errors: string[] = [];

  await onProgress?.("Pobieram stronę główną…");
  const home = await safeFetch(requestedUrl);
  if (home.status >= 400) {
    throw new Error(
      `Strona zwróciła status ${home.status}. Sprawdź, czy adres jest poprawny i publicznie dostępny.`
    );
  }
  const homeSignals = extractSignals(home.body, requestedUrl, home.finalUrl, home.status, home.loadMs, home.bytes);
  const origin = new URL(home.finalUrl).origin;

  const pages = [homeSignals];
  const internalLinks = cheerio
    .load(home.body)("a[href]")
    .map((_, el) => {
      try {
        return new URL(cheerio.load(home.body)(el).attr("href") ?? "", home.finalUrl).toString().split("#")[0];
      } catch {
        return "";
      }
    })
    .get()
    .filter((link) => link && /^https?:/.test(link) && sameSite(link, home.finalUrl));

  const subpages = pickSubpages(internalLinks, home.finalUrl, Math.max(0, maxPages - 1));
  for (const [index, sub] of subpages.entries()) {
    await onProgress?.(`Pobieram podstronę ${index + 1}/${subpages.length}…`);
    try {
      const res = await safeFetch(sub);
      if (res.status >= 400) {
        errors.push(`${sub} → HTTP ${res.status}`);
        continue;
      }
      pages.push(extractSignals(res.body, sub, res.finalUrl, res.status, res.loadMs, res.bytes));
    } catch (error) {
      errors.push(`${sub} → ${error instanceof Error ? error.message : "błąd pobierania"}`);
    }
  }

  await onProgress?.("Sprawdzam robots.txt i sitemap.xml…");
  const [robotsTxt, sitemap] = await Promise.all([checkRobots(origin), checkSitemap(origin)]);

  let wwwRedirectOk: boolean | null = null;
  try {
    const host = new URL(home.finalUrl).hostname;
    const alternate = host.startsWith("www.")
      ? home.finalUrl.replace("www.", "")
      : home.finalUrl.replace("://", "://www.");
    const res = await safeFetch(alternate, { maxBytes: 100_000 });
    wwwRedirectOk = res.status < 400;
  } catch {
    wwwRedirectOk = null;
  }

  return {
    requestedUrl,
    siteUrl: home.finalUrl,
    pages,
    discoveredLinks: [...new Set(internalLinks)].slice(0, 200),
    robotsTxt,
    sitemap,
    https: new URL(home.finalUrl).protocol === "https:",
    wwwRedirectOk,
    errors,
  };
}
