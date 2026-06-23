import { prisma } from "./db";
import { stringSimilarity } from "./utils";
import type { AuditResult } from "@/types";

export async function runAudit(organizationId: string): Promise<AuditResult> {
  const invoices = await prisma.invoice.findMany({
    where: { organizationId },
    orderBy: { issueDate: "desc" },
  });

  const duplicates: AuditResult["duplicates"] = [];
  const anomalies: AuditResult["anomalies"] = [];

  for (let i = 0; i < invoices.length; i++) {
    for (let j = i + 1; j < invoices.length; j++) {
      const a = invoices[i];
      const b = invoices[j];

      const vendorSim = stringSimilarity(a.vendorName, b.vendorName);
      const amountMatch = a.amount === b.amount;
      const numberSim = stringSimilarity(a.invoiceNumber, b.invoiceNumber);
      const dateDiff = Math.abs(
        new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime()
      );
      const withinWindow = dateDiff < 30 * 24 * 60 * 60 * 1000;

      if (vendorSim > 0.85 && amountMatch && withinWindow) {
        const similarity = (vendorSim + (numberSim > 0.7 ? 0.3 : 0)) / 1.3;
        if (similarity > 0.6) {
          duplicates.push({
            invoiceId: a.id,
            matchedInvoiceId: b.id,
            similarity: Math.round(similarity * 100) / 100,
            amountAtRisk: a.amount,
          });
        }
      }
    }
  }

  const vendorStats = new Map<string, { amounts: number[]; count: number }>();
  for (const inv of invoices) {
    const key = inv.vendorName.toLowerCase().trim();
    const stats = vendorStats.get(key) || { amounts: [], count: 0 };
    stats.amounts.push(inv.amount);
    stats.count++;
    vendorStats.set(key, stats);
  }

  for (const inv of invoices) {
    const key = inv.vendorName.toLowerCase().trim();
    const stats = vendorStats.get(key);
    if (!stats || stats.amounts.length < 3) continue;

    const mean = stats.amounts.reduce((s, a) => s + a, 0) / stats.amounts.length;
    const stdDev = Math.sqrt(
      stats.amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / stats.amounts.length
    );

    if (stdDev > 0 && Math.abs(inv.amount - mean) > 2.5 * stdDev) {
      anomalies.push({
        invoiceId: inv.id,
        reason: `Amount $${inv.amount.toFixed(2)} is ${inv.amount > mean ? "significantly higher" : "significantly lower"} than average $${mean.toFixed(2)} for ${inv.vendorName}`,
        severity: Math.abs(inv.amount - mean) > 3 * stdDev ? "high" : "medium",
        amountAtRisk: Math.abs(inv.amount - mean),
      });
    }
  }

  for (const dup of duplicates) {
    await prisma.auditAlert.upsert({
      where: { id: `dup-${dup.invoiceId}-${dup.matchedInvoiceId}` },
      update: { amountAtRisk: dup.amountAtRisk },
      create: {
        id: `dup-${dup.invoiceId}-${dup.matchedInvoiceId}`,
        type: "DUPLICATE",
        severity: dup.similarity > 0.9 ? "high" : "medium",
        title: "Potential Duplicate Invoice",
        description: `Invoice may be a duplicate (similarity: ${(dup.similarity * 100).toFixed(0)}%)`,
        amountAtRisk: dup.amountAtRisk,
        invoiceId: dup.invoiceId,
        relatedInvoiceId: dup.matchedInvoiceId,
        organizationId: (await prisma.invoice.findUnique({ where: { id: dup.invoiceId } }))!.organizationId,
      },
    });
  }

  for (const anom of anomalies) {
    const invData = await prisma.invoice.findUnique({ where: { id: anom.invoiceId } });
    if (!invData) continue;
    const alertId = `anom-${anom.invoiceId}`;
    await prisma.auditAlert.upsert({
      where: { id: alertId },
      update: { amountAtRisk: anom.amountAtRisk, description: anom.reason },
      create: {
        id: alertId,
        type: "ANOMALY",
        severity: anom.severity,
        title: "Amount Anomaly Detected",
        description: anom.reason,
        amountAtRisk: anom.amountAtRisk,
        invoiceId: anom.invoiceId,
        organizationId: invData.organizationId,
      },
    });
  }

  return { duplicates, anomalies };
}
