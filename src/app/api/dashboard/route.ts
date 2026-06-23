import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import type { ApiResponse, DashboardStats } from "@/types";

export async function GET() {
  try {
    const { orgId } = await requireAuth();

    const [invoices, alerts] = await Promise.all([
      prisma.invoice.findMany({ where: { organizationId: orgId } }),
      prisma.auditAlert.findMany({ where: { organizationId: orgId } }),
    ]);

    const totalSpend = invoices.reduce((s, i) => s + i.amount, 0);
    const openAlerts = alerts.filter((a) => a.status === "open");
    const resolvedAlerts = alerts.filter((a) => a.status === "resolved");
    const totalSavings = resolvedAlerts.reduce((s, a) => s + a.amountAtRisk, 0);

    const monthlyMap = new Map<string, number>();
    for (const inv of invoices) {
      const d = new Date(inv.issueDate);
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      monthlyMap.set(key, (monthlyMap.get(key) || 0) + inv.amount);
    }
    const monthlySpend = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, amount]) => ({ month, amount: Math.round(amount * 100) / 100 }));

    const typeMap = new Map<string, number>();
    for (const a of alerts) {
      typeMap.set(a.type, (typeMap.get(a.type) || 0) + 1);
    }
    const alertsByType = Array.from(typeMap.entries()).map(([type, count]) => ({ type, count }));

    const vendorMap = new Map<string, { amount: number; invoiceCount: number }>();
    for (const inv of invoices) {
      const key = inv.vendorName;
      const v = vendorMap.get(key) || { amount: 0, invoiceCount: 0 };
      v.amount += inv.amount;
      v.invoiceCount++;
      vendorMap.set(key, v);
    }
    const topVendors = Array.from(vendorMap.entries())
      .map(([vendor, v]) => ({ vendor, ...v }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    const stats: DashboardStats = {
      totalInvoices: invoices.length,
      totalSpend: Math.round(totalSpend * 100) / 100,
      openAlerts: openAlerts.length,
      totalSavings: Math.round(totalSavings * 100) / 100,
      monthlySpend,
      alertsByType,
      topVendors,
    };

    return NextResponse.json<ApiResponse<DashboardStats>>({ success: true, data: stats });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Not authenticated" }, { status: 401 });
  }
}
