import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { marginPct, unitMargin } from "@/lib/pricing";
import type { ApiResponse, DropshipStats } from "@/types";

export async function GET() {
  try {
    const { orgId } = await requireAuth();

    const [products, orders, rules, logs] = await Promise.all([
      prisma.product.findMany({ where: { organizationId: orgId } }),
      prisma.order.findMany({ where: { organizationId: orgId } }),
      prisma.automationRule.findMany({ where: { organizationId: orgId } }),
      prisma.automationLog.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

    const activeProducts = products.filter((p) => p.status === "active" || p.status === "winner");
    const winners = products.filter((p) => p.status === "winner");
    const pricedProducts = products.filter((p) => p.sellingPrice > 0);
    const avgMarginPct =
      pricedProducts.length > 0
        ? pricedProducts.reduce((s, p) => s + marginPct(p), 0) / pricedProducts.length
        : 0;

    const totalRevenue = orders.reduce((s, o) => s + o.salePrice, 0);
    const totalProfit = orders.reduce((s, o) => s + (o.salePrice - o.cost), 0);

    const statusMap = new Map<string, number>();
    for (const p of products) statusMap.set(p.status, (statusMap.get(p.status) || 0) + 1);

    const topProducts = [...products]
      .sort((a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1))
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.aiScore,
        marginPct: Math.round(marginPct(p) * 1000) / 1000,
        profit: unitMargin(p),
      }));

    const stats: DropshipStats = {
      totalProducts: products.length,
      activeProducts: activeProducts.length,
      winners: winners.length,
      avgMarginPct: Math.round(avgMarginPct * 1000) / 1000,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      openOrders: orders.filter((o) => o.status === "new" || o.status === "paid").length,
      autoFulfilledOrders: orders.filter((o) => o.fulfillment === "auto").length,
      activeRules: rules.filter((r) => r.enabled).length,
      automationActions: rules.reduce((s, r) => s + r.timesTriggered, 0),
      productsByStatus: Array.from(statusMap.entries()).map(([status, count]) => ({ status, count })),
      topProducts,
      recentLogs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        message: l.message,
        level: l.level,
        createdAt: l.createdAt.toISOString(),
      })),
    };

    return NextResponse.json<ApiResponse<DropshipStats>>({ success: true, data: stats });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Not authenticated" }, { status: 401 });
  }
}
