import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ApiResponse } from "@/types";
import type { AuditTier } from "@/types/audit";
import { TIERS, tierRank } from "@/lib/audit/config";
import { isUnlocked } from "@/lib/audit/report";
import { createCheckoutSession, stripeConfigured } from "@/lib/audit/stripe";

export const runtime = "nodejs";

const schema = z.object({
  token: z.string().min(10),
  tier: z.enum(["basic", "pro"]),
});

/** Upgrade istniejącego zamówienia: free → Audyt, Audyt → Pro. */
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Nieprawidłowe dane." }, { status: 400 });
    }
    if (!stripeConfigured()) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Płatności nie są skonfigurowane." },
        { status: 503 }
      );
    }

    const order = await prisma.auditOrder.findUnique({ where: { publicToken: parsed.data.token } });
    if (!order) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Nie znaleziono zamówienia." }, { status: 404 });
    }

    const targetTier = parsed.data.tier as AuditTier;
    const currentTier = order.tier as AuditTier;

    if (isUnlocked(currentTier, order.paymentStatus) && tierRank(targetTier) <= tierRank(currentTier)) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Ten pakiet jest już opłacony." },
        { status: 409 }
      );
    }

    const session = await createCheckoutSession({
      orderId: order.id,
      token: order.publicToken,
      tier: targetTier,
      email: order.email,
      url: order.url,
    });

    await prisma.auditOrder.update({
      where: { id: order.id },
      data: { stripeSessionId: session.id, paymentStatus: order.paymentStatus === "paid" ? "paid" : "pending" },
    });

    return NextResponse.json<ApiResponse>({
      success: true,
      data: { redirectTo: session.url, tier: targetTier, amountGrosz: TIERS[targetTier].priceGrosz },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się rozpocząć płatności.";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
