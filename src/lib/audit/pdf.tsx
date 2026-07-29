import path from "node:path";
import React from "react";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { AuditArea, AuditSeverity, ReportDTO } from "@/types/audit";
import { formatPln } from "./config";

/**
 * Fonty leżą w `public/fonts` (a nie w node_modules), bo Docker/standalone
 * kopiuje `public` do obrazu. Inter latin-ext ma pełne polskie znaki.
 */
let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(dir, "inter-400.woff"), fontWeight: 400 },
      { src: path.join(dir, "inter-600.woff"), fontWeight: 600 },
      { src: path.join(dir, "inter-700.woff"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]); // bez dzielenia polskich wyrazów
  fontsRegistered = true;
}

const COLORS = {
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  brand: "#4f46e5",
  critical: "#b91c1c",
  high: "#c2410c",
  medium: "#a16207",
  low: "#0369a1",
  good: "#15803d",
  panel: "#f8fafc",
};

const SEVERITY_LABEL: Record<AuditSeverity, string> = {
  critical: "Krytyczne",
  high: "Wysokie",
  medium: "Średnie",
  low: "Niskie",
};

const AREA_LABEL: Record<AuditArea, string> = {
  ux: "UX",
  seo: "SEO",
  copy: "Treść",
  performance: "Szybkość",
  trust: "Zaufanie",
  conversion: "Konwersja",
  tech: "Technika",
};

const styles = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9.5, color: COLORS.ink, paddingTop: 42, paddingBottom: 54, paddingHorizontal: 42, lineHeight: 1.5 },
  coverTag: { fontSize: 9, letterSpacing: 1.4, color: COLORS.brand, fontWeight: 600, textTransform: "uppercase" },
  coverTitle: { fontSize: 26, fontWeight: 700, marginTop: 10, lineHeight: 1.2 },
  coverUrl: { fontSize: 13, color: COLORS.brand, marginTop: 6 },
  coverMeta: { fontSize: 9, color: COLORS.muted, marginTop: 4 },
  h2: { fontSize: 14, fontWeight: 700, marginTop: 22, marginBottom: 8 },
  h3: { fontSize: 10.5, fontWeight: 600, marginBottom: 3 },
  p: { marginBottom: 6 },
  muted: { color: COLORS.muted },
  scoreRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  scoreCard: { width: "31.5%", border: `1pt solid ${COLORS.line}`, borderRadius: 5, padding: 9, backgroundColor: COLORS.panel },
  scoreLabel: { fontSize: 8, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  scoreValue: { fontSize: 19, fontWeight: 700, marginTop: 2 },
  overallBox: { border: `1.5pt solid ${COLORS.brand}`, borderRadius: 6, padding: 14, marginTop: 18, flexDirection: "row", alignItems: "center", gap: 16 },
  overallNumber: { fontSize: 40, fontWeight: 700, color: COLORS.brand },
  finding: { border: `1pt solid ${COLORS.line}`, borderRadius: 5, padding: 10, marginBottom: 9 },
  findingHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5, gap: 8 },
  badge: { fontSize: 7.5, fontWeight: 600, paddingVertical: 2, paddingHorizontal: 5, borderRadius: 3, color: "#fff" },
  badgeRow: { flexDirection: "row", gap: 4, alignItems: "center" },
  evidence: { backgroundColor: COLORS.panel, borderLeft: `2pt solid ${COLORS.line}`, paddingVertical: 5, paddingHorizontal: 8, marginTop: 5, fontSize: 8.5, color: COLORS.muted },
  price: { fontSize: 9.5, fontWeight: 700, textAlign: "right" },
  tableRow: { flexDirection: "row", borderBottom: `1pt solid ${COLORS.line}`, paddingVertical: 5 },
  tableHead: { flexDirection: "row", borderBottom: `1.5pt solid ${COLORS.ink}`, paddingBottom: 4, marginTop: 6 },
  cellLabel: { flex: 3, fontSize: 9 },
  cellNum: { flex: 1, fontSize: 9, textAlign: "right" },
  totalBox: { backgroundColor: COLORS.panel, borderRadius: 6, padding: 14, marginTop: 14 },
  totalValue: { fontSize: 22, fontWeight: 700, color: COLORS.brand },
  bullet: { flexDirection: "row", gap: 6, marginBottom: 4 },
  bulletDot: { width: 10, color: COLORS.brand, fontWeight: 700 },
  footer: { position: "absolute", bottom: 26, left: 42, right: 42, borderTop: `1pt solid ${COLORS.line}`, paddingTop: 7, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: COLORS.muted },
  rewrite: { border: `1pt solid ${COLORS.line}`, borderRadius: 5, padding: 10, marginBottom: 8 },
  beforeText: { fontSize: 8.5, color: COLORS.muted, textDecoration: "line-through", marginTop: 3 },
  afterText: { fontSize: 10, fontWeight: 600, marginTop: 4, color: COLORS.good },
});

function scoreColor(value: number): string {
  if (value >= 80) return COLORS.good;
  if (value >= 60) return COLORS.medium;
  if (value >= 40) return COLORS.high;
  return COLORS.critical;
}

function Footer({ url }: { url: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>Audyt strony · {url}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={index} style={styles.bullet}>
          <Text style={styles.bulletDot}>{index + 1}.</Text>
          <Text style={{ flex: 1 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function ReportDocument({ report }: { report: ReportDTO }) {
  const scores = report.scores;
  const visible = report.findings.filter((f) => !f.locked);
  const generated = new Date().toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });

  const categories: { key: keyof NonNullable<typeof scores>; label: string }[] = [
    { key: "conversion", label: "Konwersja" },
    { key: "ux", label: "UX" },
    { key: "seo", label: "SEO" },
    { key: "copy", label: "Treść" },
    { key: "trust", label: "Zaufanie" },
    { key: "performance", label: "Szybkość" },
  ];

  return (
    <Document
      title={`Audyt strony ${report.siteUrl}`}
      author="Audyt strony WWW"
      subject={`Raport z audytu ${report.siteUrl}`}
    >
      {/* --- Strona 1: podsumowanie --- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverTag}>Raport z audytu strony WWW</Text>
        <Text style={styles.coverTitle}>Co poprawić na Twojej stronie{"\n"}i ile to kosztuje</Text>
        <Text style={styles.coverUrl}>{report.siteUrl}</Text>
        <Text style={styles.coverMeta}>
          Wygenerowano {generated} · przeanalizowano {report.pagesAnalyzed}{" "}
          {report.pagesAnalyzed === 1 ? "stronę" : "podstron"} · znalezisk: {report.findingsTotal}
        </Text>

        {scores && (
          <>
            <View style={styles.overallBox}>
              <Text style={styles.overallNumber}>{scores.overall}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: 600 }}>Wynik ogólny: {scores.overall}/100</Text>
                <Text style={[styles.muted, { fontSize: 9 }]}>
                  Ocena ważona: konwersja 25%, UX 20%, SEO 18%, treść 15%, zaufanie 12%, szybkość 10%.
                </Text>
              </View>
            </View>

            <View style={styles.scoreRow}>
              {categories.map((category) => (
                <View key={category.key} style={styles.scoreCard}>
                  <Text style={styles.scoreLabel}>{category.label}</Text>
                  <Text style={[styles.scoreValue, { color: scoreColor(scores[category.key] as number) }]}>
                    {scores[category.key]}
                    <Text style={{ fontSize: 10, color: COLORS.muted, fontWeight: 400 }}>/100</Text>
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {report.summary && (
          <>
            <Text style={styles.h2}>Podsumowanie</Text>
            <Text style={styles.p}>{report.summary.executiveSummary}</Text>

            <Text style={styles.h3}>Pierwsze wrażenie</Text>
            <Text style={styles.p}>{report.summary.firstImpression}</Text>

            <Text style={styles.h3}>Do kogo mówi ta strona</Text>
            <Text style={styles.p}>{report.summary.targetAudience}</Text>

            {report.summary.quickWins.length > 0 && (
              <>
                <Text style={styles.h2}>Zrób to najpierw (poniżej godziny)</Text>
                <Bullets items={report.summary.quickWins} />
              </>
            )}
          </>
        )}

        <Footer url={report.siteUrl} />
      </Page>

      {/* --- Strona 2+: znaleziska --- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>Lista poprawek</Text>
        <Text style={[styles.muted, { marginBottom: 10 }]}>
          Uporządkowane od najpilniejszych. Przy każdej pozycji: czas wdrożenia i koszt przy stawce{" "}
          {report.quote ? formatPln(report.quote.hourlyRateGrosz) : "—"}/h.
        </Text>

        {visible.map((finding, index) => (
          <View key={finding.id} style={styles.finding} wrap={false}>
            <View style={styles.findingHead}>
              <View style={{ flex: 1 }}>
                <View style={styles.badgeRow}>
                  <Text style={[styles.badge, { backgroundColor: COLORS[finding.severity] }]}>
                    {SEVERITY_LABEL[finding.severity]}
                  </Text>
                  <Text style={[styles.badge, { backgroundColor: COLORS.muted }]}>{AREA_LABEL[finding.area]}</Text>
                  <Text style={{ fontSize: 8, color: COLORS.muted }}>wpływ {finding.impact}/5</Text>
                </View>
                <Text style={[styles.h3, { marginTop: 5 }]}>
                  {index + 1}. {finding.title}
                </Text>
              </View>
              {report.capabilities.quote && (
                <View style={{ width: 92 }}>
                  <Text style={styles.price}>{formatPln(finding.priceGrosz)}</Text>
                  <Text style={[styles.muted, { fontSize: 8, textAlign: "right" }]}>{finding.effortHours} h</Text>
                </View>
              )}
            </View>

            <Text style={styles.p}>{finding.problem}</Text>
            <Text style={{ fontSize: 9, fontWeight: 600, marginTop: 2 }}>Co zrobić</Text>
            <Text>{finding.recommendation}</Text>

            {finding.evidence && (
              <Text style={styles.evidence}>
                Dowód ze strony: {finding.evidence}
                {finding.pageUrl ? ` (${finding.pageUrl})` : ""}
              </Text>
            )}
          </View>
        ))}

        <Footer url={report.siteUrl} />
      </Page>

      {/* --- Wycena --- */}
      {report.quote && (
        <Page size="A4" style={styles.page}>
          <Text style={styles.h2}>Wycena wdrożenia</Text>
          <Text style={styles.p}>
            Szacunek kosztu wdrożenia wszystkich poprawek z tego raportu, przy stawce{" "}
            {formatPln(report.quote.hourlyRateGrosz)}/h.
          </Text>

          <View style={styles.tableHead}>
            <Text style={[styles.cellLabel, { fontWeight: 700 }]}>Obszar</Text>
            <Text style={[styles.cellNum, { fontWeight: 700 }]}>Poz.</Text>
            <Text style={[styles.cellNum, { fontWeight: 700 }]}>Godziny</Text>
            <Text style={[styles.cellNum, { fontWeight: 700 }]}>Koszt</Text>
          </View>
          {report.quote.byArea.map((row) => (
            <View key={row.area} style={styles.tableRow}>
              <Text style={styles.cellLabel}>{AREA_LABEL[row.area]}</Text>
              <Text style={styles.cellNum}>{row.count}</Text>
              <Text style={styles.cellNum}>{row.hours}</Text>
              <Text style={styles.cellNum}>{formatPln(row.priceGrosz)}</Text>
            </View>
          ))}

          <View style={styles.totalBox}>
            <Text style={styles.muted}>Razem, szacunkowo</Text>
            <Text style={styles.totalValue}>{formatPln(report.quote.totalGrosz)}</Text>
            <Text style={[styles.muted, { fontSize: 9 }]}>
              Widełki: {formatPln(report.quote.minGrosz)} – {formatPln(report.quote.maxGrosz)} ·{" "}
              {report.quote.totalHours} h pracy
            </Text>
          </View>

          <Text style={[styles.muted, { marginTop: 16, fontSize: 8.5 }]}>
            Zastrzeżenie: to estymata przygotowana automatycznie na podstawie tego, co widać publicznie na stronie.
            Nie jest ofertą w rozumieniu Kodeksu cywilnego. Rzeczywisty koszt zależy od użytego systemu CMS,
            dostępu do kodu i zakresu, jaki zdecydujesz się wdrożyć. Poprawki są niezależne — możesz zrobić
            tylko część.
          </Text>

          <Footer url={report.siteUrl} />
        </Page>
      )}

      {/* --- Gotowe teksty (Pro) --- */}
      {report.copyRewrites.length > 0 && (
        <Page size="A4" style={styles.page}>
          <Text style={styles.h2}>Gotowe teksty do wklejenia</Text>
          <Text style={[styles.muted, { marginBottom: 10 }]}>
            Skopiuj i wklej. Nie wymagają zmian w kodzie — wystarczy edytor treści.
          </Text>
          {report.copyRewrites.map((rewrite, index) => (
            <View key={index} style={styles.rewrite} wrap={false}>
              <Text style={styles.h3}>{rewrite.location}</Text>
              <Text style={styles.beforeText}>{rewrite.before || "(obecnie brak)"}</Text>
              <Text style={styles.afterText}>{rewrite.after}</Text>
              <Text style={[styles.muted, { fontSize: 8.5, marginTop: 4 }]}>{rewrite.why}</Text>
            </View>
          ))}
          <Footer url={report.siteUrl} />
        </Page>
      )}

      {/* --- Roadmapa (Pro) --- */}
      {report.roadmap.length > 0 && (
        <Page size="A4" style={styles.page}>
          <Text style={styles.h2}>Plan wdrożenia</Text>
          {report.roadmap.map((phase) => (
            <View key={phase.horizon} style={{ marginBottom: 16 }}>
              <Text style={styles.h3}>Pierwsze {phase.horizon} dni</Text>
              <Bullets items={phase.items} />
            </View>
          ))}
          <Footer url={report.siteUrl} />
        </Page>
      )}
    </Document>
  );
}

export async function renderReportPdf(report: ReportDTO): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ReportDocument report={report} />);
}
