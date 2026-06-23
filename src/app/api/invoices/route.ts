import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import type { ApiResponse } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const search = url.searchParams.get("search") || "";
    const vendor = url.searchParams.get("vendor") || "";
    const status = url.searchParams.get("status") || "";

    const where: Record<string, unknown> = { organizationId: orgId };
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { vendorName: { contains: search } },
        { description: { contains: search } },
      ];
    }
    if (vendor) where.vendorName = { contains: vendor };
    if (status) where.status = status;

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { alerts: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return NextResponse.json<ApiResponse>({
      success: true,
      data: invoices,
      meta: { total, page, limit },
    });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Not authenticated" }, { status: 401 });
  }
}
