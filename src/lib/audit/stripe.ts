import Stripe from "stripe";
import type { AuditTier } from "@/types/audit";
import { CURRENCY, TIERS, baseUrl } from "./config";

let cached: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Brak STRIPE_SECRET_KEY — płatności są wyłączone.");
  }
  if (!cached) cached = new Stripe(process.env.STRIPE_SECRET_KEY);
  return cached;
}

/**
 * Cennik żyje w kodzie (`config.ts`) i jest wysyłany do Stripe jako
 * `price_data` — nie trzeba nic klikać w panelu Stripe przy zmianie ceny.
 */
export async function createCheckoutSession(params: {
  orderId: string;
  token: string;
  tier: AuditTier;
  email: string;
  url: string;
}): Promise<{ id: string; url: string }> {
  const definition = TIERS[params.tier];
  if (definition.priceGrosz <= 0) throw new Error("Ten pakiet jest darmowy — płatność niepotrzebna.");

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: params.email,
    // BLIK i Przelewy24 to w Polsce większość płatności — karta sama nie wystarczy.
    payment_method_types: ["card", "blik", "p24"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY.toLowerCase(),
          unit_amount: definition.priceGrosz,
          product_data: {
            name: `${definition.label} — audyt strony ${params.url}`,
            description: definition.tagline,
          },
        },
      },
    ],
    metadata: { orderId: params.orderId, tier: params.tier, token: params.token },
    payment_intent_data: {
      metadata: { orderId: params.orderId, tier: params.tier },
    },
    success_url: `${baseUrl()}/audyt/dziekujemy?token=${params.token}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl()}/audyt?anulowano=1`,
    locale: "pl",
    allow_promotion_codes: true,
  });

  if (!session.url) throw new Error("Stripe nie zwrócił adresu płatności.");
  return { id: session.id, url: session.url };
}
