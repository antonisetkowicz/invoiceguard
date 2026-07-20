import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import type { ApiResponse } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "";
    const search = url.searchParams.get("search") || "";
    const category = url.searchParams.get("category") || "";

    const where: Record<string, unknown> = { organizationId: orgId };
    if (status) where.status = status;
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
        { category: { contains: search } },
      ];
    }

    const products = await prisma.product.findMany({
      where,
      include: { supplier: true },
      orderBy: [{ aiScore: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json<ApiResponse>({ success: true, data: products });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Not authenticated" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const body = await req.json();

    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json<ApiResponse>({ success: false, error: "Product name is required" }, { status: 400 });
    }

    const product = await prisma.product.create({
      data: {
        name: body.name,
        sku: body.sku || null,
        category: body.category || null,
        sourceUrl: body.sourceUrl || null,
        imageUrl: body.imageUrl || null,
        supplierPrice: num(body.supplierPrice),
        shippingCost: num(body.shippingCost),
        sellingPrice: num(body.sellingPrice),
        stock: Math.round(num(body.stock)),
        status: body.status || "draft",
        supplierId: body.supplierId || null,
        organizationId: orgId,
      },
    });

    return NextResponse.json<ApiResponse>({ success: true, data: product });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Failed to create product" }, { status: 500 });
  }
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}
