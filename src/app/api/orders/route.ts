import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import type { ApiResponse } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "";

    const where: Record<string, unknown> = { organizationId: orgId };
    if (status) where.status = status;

    const orders = await prisma.order.findMany({
      where,
      include: { product: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });

    const summary = {
      total: orders.length,
      open: orders.filter((o) => o.status === "new" || o.status === "paid").length,
      autoFulfilled: orders.filter((o) => o.fulfillment === "auto").length,
      revenue: Math.round(orders.reduce((s, o) => s + o.salePrice, 0) * 100) / 100,
      profit: Math.round(orders.reduce((s, o) => s + (o.salePrice - o.cost), 0) * 100) / 100,
    };

    return NextResponse.json<ApiResponse>({ success: true, data: { orders, summary } });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Not authenticated" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const body = await req.json();
    if (!body.customerName) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Customer name is required" }, { status: 400 });
    }
    const order = await prisma.order.create({
      data: {
        orderNumber: body.orderNumber || `ORD-${Date.now().toString(36).toUpperCase()}`,
        customerName: body.customerName,
        customerEmail: body.customerEmail || null,
        productId: body.productId || null,
        quantity: Math.round(Number(body.quantity) || 1),
        salePrice: Number(body.salePrice) || 0,
        cost: Number(body.cost) || 0,
        status: body.status || "new",
        organizationId: orgId,
      },
    });
    return NextResponse.json<ApiResponse>({ success: true, data: order });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Failed to create order" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const { orderId, status } = await req.json();
    const order = await prisma.order.findFirst({ where: { id: orderId, organizationId: orgId } });
    if (!order) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Order not found" }, { status: 404 });
    }
    const updated = await prisma.order.update({ where: { id: orderId }, data: { status } });
    return NextResponse.json<ApiResponse>({ success: true, data: updated });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Update failed" }, { status: 500 });
  }
}
