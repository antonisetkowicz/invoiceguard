import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import type { ApiResponse } from "@/types";

const VALID_TRIGGERS = ["low_margin", "low_stock", "high_score", "new_order", "supplier_risk"];
const VALID_ACTIONS = ["flag", "pause_product", "tag_winner", "auto_fulfill", "restock_alert"];

export async function GET() {
  try {
    const { orgId } = await requireAuth();
    const [rules, logs] = await Promise.all([
      prisma.automationRule.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.automationLog.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    return NextResponse.json<ApiResponse>({ success: true, data: { rules, logs } });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Not authenticated" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const body = await req.json();

    if (!body.name || !VALID_TRIGGERS.includes(body.trigger) || !VALID_ACTIONS.includes(body.action)) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Invalid rule definition" }, { status: 400 });
    }

    const rule = await prisma.automationRule.create({
      data: {
        name: body.name,
        description: body.description || null,
        trigger: body.trigger,
        threshold: Number(body.threshold) || 0,
        action: body.action,
        enabled: body.enabled !== false,
        organizationId: orgId,
      },
    });
    return NextResponse.json<ApiResponse>({ success: true, data: rule });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Failed to create rule" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const body = await req.json();
    const { ruleId } = body;

    const rule = await prisma.automationRule.findFirst({ where: { id: ruleId, organizationId: orgId } });
    if (!rule) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Rule not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if ("enabled" in body) data.enabled = Boolean(body.enabled);
    if ("threshold" in body) data.threshold = Number(body.threshold) || 0;
    if ("name" in body) data.name = body.name;

    const updated = await prisma.automationRule.update({ where: { id: ruleId }, data });
    return NextResponse.json<ApiResponse>({ success: true, data: updated });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const { searchParams } = new URL(req.url);
    const ruleId = searchParams.get("ruleId");

    const rule = await prisma.automationRule.findFirst({ where: { id: ruleId ?? "", organizationId: orgId } });
    if (!rule) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Rule not found" }, { status: 404 });
    }
    await prisma.automationLog.deleteMany({ where: { ruleId: rule.id } });
    await prisma.automationRule.delete({ where: { id: rule.id } });
    return NextResponse.json<ApiResponse>({ success: true, data: { id: rule.id } });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Delete failed" }, { status: 500 });
  }
}
