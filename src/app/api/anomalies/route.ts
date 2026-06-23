import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import type { ApiResponse } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "";
    const type = url.searchParams.get("type") || "";

    const where: Record<string, unknown> = { organizationId: orgId };
    if (status) where.status = status;
    if (type) where.type = type;

    const alerts = await prisma.auditAlert.findMany({
      where,
      include: { invoice: true },
      orderBy: { createdAt: "desc" },
    });

    const summary = {
      total: alerts.length,
      open: alerts.filter((a) => a.status === "open").length,
      totalAmountAtRisk: alerts.filter((a) => a.status === "open").reduce((s, a) => s + a.amountAtRisk, 0),
      byType: {
        DUPLICATE: alerts.filter((a) => a.type === "DUPLICATE").length,
        ANOMALY: alerts.filter((a) => a.type === "ANOMALY").length,
      },
    };

    return NextResponse.json<ApiResponse>({
      success: true,
      data: { alerts, summary },
    });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Not authenticated" }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const body = await req.json();
    const { alertId, status } = body;

    const alert = await prisma.auditAlert.findFirst({
      where: { id: alertId, organizationId: orgId },
    });

    if (!alert) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Alert not found" }, { status: 404 });
    }

    const updated = await prisma.auditAlert.update({
      where: { id: alertId },
      data: { status, resolvedAt: status === "resolved" ? new Date() : null },
    });

    return NextResponse.json<ApiResponse>({ success: true, data: updated });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Update failed" }, { status: 500 });
  }
}
