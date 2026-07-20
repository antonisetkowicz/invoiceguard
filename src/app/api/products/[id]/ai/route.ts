import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { generateProductContent, scoreProduct } from "@/lib/ai";
import type { ApiResponse } from "@/types";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/products/:id/ai  { mode?: "content" | "score" | "all" }
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode || "all";

    const product = await prisma.product.findFirst({ where: { id, organizationId: orgId } });
    if (!product) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Product not found" }, { status: 404 });
    }

    const input = {
      name: product.name,
      category: product.category,
      supplierPrice: product.supplierPrice,
      shippingCost: product.shippingCost,
      sellingPrice: product.sellingPrice,
    };

    const data: Record<string, unknown> = { aiGeneratedAt: new Date() };
    const result: Record<string, unknown> = {};

    if (mode === "content" || mode === "all") {
      const content = await generateProductContent(input);
      data.aiTitle = content.title;
      data.aiDescription = content.description;
      data.aiTags = JSON.stringify(content.tags);
      data.aiAdCopy = content.adCopy;
      data.aiSource = content.source;
      result.content = content;
    }

    if (mode === "score" || mode === "all") {
      const score = await scoreProduct(input);
      data.aiScore = score.score;
      data.aiVerdict = score.verdict;
      data.aiReasons = JSON.stringify(score.reasons);
      data.aiSource = score.source;
      result.score = score;
    }

    const updated = await prisma.product.update({ where: { id }, data });
    return NextResponse.json<ApiResponse>({ success: true, data: { product: updated, ...result } });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "AI generation failed" }, { status: 500 });
  }
}
