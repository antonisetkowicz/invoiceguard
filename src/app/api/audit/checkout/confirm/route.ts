import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ApiResponse } from "@/types";
import type { AuditTier } from "@/types/audit";
import { markOrderPaid } from "@/lib/audit/orders";
import { getStripe, stripeConfigured } from "@/lib/audit/stripe";

export const runtime = "nodejs";

const schema = z.object({ token: z.string().min(10), sessionId: z.string().min(5) });

/**
 * Siatka bezpieczeństwa dla strony „dziękujemy": webhook Stripe potrafi
 * przyjść z opóźnieniem, a klient już patrzy na ekran. Dopytujemy Stripe
 * bezpośrednio. Operacja jest idempotentna — nie zdubluje audytu.
 */
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Nieprawidłowe dane." }, { status: 400 });
    }
    if (!stripeConfigured()) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Płatności nie są skonfigurowane." }, { status: 503 });
    }

    const order = await prisma.auditOrder.findUnique({ where: { publicToken: parsed.data.token } });
    if (!order) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Nie znaleziono zamówienia." }, { status: 404 });
    }

    const session = await getStripe().checkout.sessions.retrieve(parsed.data.sessionId);

    // Sesja musi należeć do TEGO zamówienia — inaczej cudzy session_id
    // odblokowałby czyjś raport.
    if (session.metadata?.orderId !== order.id) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Sesja płatności nie pasuje do zamówienia." }, { status: 403 });
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json<ApiResponse>({
        success: true,
        data: { paid: false, paymentStatus: session.payment_status },
      });
    }

    const tier = (session.metadata?.tier as AuditTier | undefined) ?? (order.tier as AuditTier);
    const result = await markOrderPaid({
      orderId: order.id,
      tier,
      stripeSessionId: session.id,
      stripePaymentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    });

    return NextResponse.json<ApiResponse>({ success: true, data: { paid: true, ...result } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się potwierdzić płatności.";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
