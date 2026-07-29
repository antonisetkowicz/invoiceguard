import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ApiResponse } from "@/types";
import type { AuditTier } from "@/types/audit";
import { TIERS, isPaidTier } from "@/lib/audit/config";
import { OrderError, assertFreeQuota, clientIpFrom, createOrder } from "@/lib/audit/orders";
import { enqueueRun } from "@/lib/audit/queue";
import { createCheckoutSession, stripeConfigured } from "@/lib/audit/stripe";
import { UnsafeUrlError, assertPublicUrl, normalizeInputUrl } from "@/lib/audit/url";

export const runtime = "nodejs";

const schema = z.object({
  url: z.string().min(3, "Podaj adres strony."),
  email: z.string().email("Podaj poprawny adres e-mail."),
  tier: z.enum(["free", "basic", "pro"]),
  companyName: z.string().max(160).optional().nullable(),
  goal: z.string().max(500).optional().nullable(),
  consentTerms: z.literal(true, { errorMap: () => ({ message: "Zaakceptuj regulamin i politykę prywatności." }) }),
  consentMarketing: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza." },
        { status: 400 }
      );
    }
    const input = parsed.data;
    const tier = input.tier as AuditTier;

    // Walidujemy adres ZANIM powstanie zamówienie — nikt nie płaci za URL,
    // którego i tak nie da się pobrać.
    const url = normalizeInputUrl(input.url);
    await assertPublicUrl(url);

    const clientIp = clientIpFrom(req.headers);
    const email = input.email.trim().toLowerCase();

    if (!isPaidTier(tier)) {
      await assertFreeQuota(email, clientIp);
    } else if (!stripeConfigured()) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Płatności nie są jeszcze skonfigurowane. Skorzystaj z darmowego skanu." },
        { status: 503 }
      );
    }

    const order = await createOrder({
      url,
      email,
      tier,
      companyName: input.companyName,
      goal: input.goal,
      consentMarketing: input.consentMarketing ?? false,
      clientIp,
    });

    if (!isPaidTier(tier)) {
      await enqueueRun(order.id, tier);
      return NextResponse.json<ApiResponse>({
        success: true,
        data: { token: order.publicToken, redirectTo: `/audyt/raport/${order.publicToken}` },
      });
    }

    const session = await createCheckoutSession({
      orderId: order.id,
      token: order.publicToken,
      tier,
      email,
      url,
    });

    return NextResponse.json<ApiResponse>({
      success: true,
      data: { token: order.publicToken, redirectTo: session.url, tier, amountGrosz: TIERS[tier].priceGrosz },
    });
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return NextResponse.json<ApiResponse>({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof OrderError) {
      return NextResponse.json<ApiResponse>({ success: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Nie udało się utworzyć zamówienia.";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
