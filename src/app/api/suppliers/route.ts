import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import type { ApiResponse } from "@/types";

export async function GET() {
  try {
    const { orgId } = await requireAuth();
    const suppliers = await prisma.supplier.findMany({
      where: { organizationId: orgId },
      include: { _count: { select: { products: true } } },
      orderBy: { rating: "desc" },
    });
    return NextResponse.json<ApiResponse>({ success: true, data: suppliers });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Not authenticated" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const body = await req.json();
    if (!body.name) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Supplier name is required" }, { status: 400 });
    }
    const supplier = await prisma.supplier.create({
      data: {
        name: body.name,
        country: body.country || null,
        avgShippingDays: Math.round(Number(body.avgShippingDays) || 14),
        rating: Number(body.rating) || 0,
        reliability: Number(body.reliability) || 0,
        organizationId: orgId,
      },
    });
    return NextResponse.json<ApiResponse>({ success: true, data: supplier });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Failed to create supplier" }, { status: 500 });
  }
}
