import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import type { AuditTier } from "@/types/audit";
import { markOrderPaid } from "@/lib/audit/orders";
import { getStripe } from "@/lib/audit/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Brak STRIPE_WEBHOOK_SECRET." }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Brak nagłówka stripe-signature." }, { status: 400 });
  }

  // Podpis liczony jest z SUROWEGO body — żadnego req.json() przed weryfikacją.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Niepoprawny podpis.";
    return NextResponse.json({ error: `Weryfikacja podpisu nieudana: ${message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      // async_payment_succeeded dotyczy BLIK-a i Przelewy24, gdzie płatność
      // potwierdza się po przekierowaniu.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        if (!orderId) break;
        if (session.payment_status !== "paid") break;

        await markOrderPaid({
          orderId,
          tier: (session.metadata?.tier as AuditTier | undefined) ?? "basic",
          stripeSessionId: session.id,
          stripePaymentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
        });
        break;
      }

      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        if (!orderId) break;
        await prisma.auditOrder.updateMany({
          where: { id: orderId, paymentStatus: "pending" },
          data: { paymentStatus: event.type === "checkout.session.expired" ? "none" : "failed" },
        });
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntent = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
        if (!paymentIntent) break;
        await prisma.auditOrder.updateMany({
          where: { stripePaymentId: paymentIntent },
          data: { paymentStatus: "refunded" },
        });
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    // 500 → Stripe ponowi dostarczenie. markOrderPaid jest idempotentne,
    // więc powtórka jest bezpieczna.
    const message = error instanceof Error ? error.message : "Błąd obsługi zdarzenia.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
