import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import type { ApiResponse } from "@/types";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.product.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Product not found" }, { status: 404 });
    }

    const allowed = [
      "name", "sku", "category", "sourceUrl", "imageUrl",
      "supplierPrice", "shippingCost", "sellingPrice", "stock", "status", "supplierId",
    ];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }

    const product = await prisma.product.update({ where: { id }, data });
    return NextResponse.json<ApiResponse>({ success: true, data: product });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;

    const existing = await prisma.product.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Product not found" }, { status: 404 });
    }

    await prisma.order.updateMany({ where: { productId: id }, data: { productId: null } });
    await prisma.product.delete({ where: { id } });
    return NextResponse.json<ApiResponse>({ success: true, data: { id } });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Delete failed" }, { status: 500 });
  }
}
