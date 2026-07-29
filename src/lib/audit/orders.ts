import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import type { AuditTier } from "@/types/audit";
import { LIMITS, TIERS, isPaidTier, tierRank } from "./config";
import { enqueueRun } from "./queue";

export function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export class OrderError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Miękki limit nadużyć darmowego skanu — liczony w bazie, bez zewnętrznych usług. */
export async function assertFreeQuota(email: string, ip: string | null) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const byEmail = await prisma.auditOrder.count({
    where: { email, tier: "free", createdAt: { gte: since } },
  });
  if (byEmail >= LIMITS.freePerEmailPerDay) {
    throw new OrderError(
      `Wykorzystałeś/aś limit ${LIMITS.freePerEmailPerDay} darmowych skanów na dobę dla tego adresu e-mail. Wybierz płatny pakiet albo wróć jutro.`,
      429
    );
  }

  if (ip) {
    const byIp = await prisma.auditOrder.count({
      where: { clientIp: ip, tier: "free", createdAt: { gte: since } },
    });
    if (byIp >= LIMITS.freePerIpPerDay) {
      throw new OrderError("Zbyt wiele darmowych skanów z tego adresu w ciągu doby. Spróbuj ponownie później.", 429);
    }
  }
}

export async function createOrder(input: {
  url: string;
  email: string;
  tier: AuditTier;
  companyName?: string | null;
  goal?: string | null;
  consentMarketing: boolean;
  clientIp: string | null;
}) {
  const definition = TIERS[input.tier];

  return prisma.auditOrder.create({
    data: {
      publicToken: newToken(),
      url: input.url,
      email: input.email,
      tier: input.tier,
      companyName: input.companyName || null,
      goal: input.goal || null,
      consentMarketing: input.consentMarketing,
      clientIp: input.clientIp,
      amountGrosz: definition.priceGrosz,
      paymentStatus: isPaidTier(input.tier) ? "pending" : "none",
    },
  });
}

/**
 * Wywoływane z webhooka Stripe ORAZ ze strony „dziękujemy" (gdy webhook się
 * spóźnia). Musi być idempotentne — druga próba nie może zdublować runu.
 */
export async function markOrderPaid(params: {
  orderId: string;
  tier: AuditTier;
  stripeSessionId?: string | null;
  stripePaymentId?: string | null;
}): Promise<{ changed: boolean; enqueued: boolean }> {
  const order = await prisma.auditOrder.findUnique({
    where: { id: params.orderId },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order) throw new OrderError("Zamówienie nie istnieje.", 404);

  const alreadyPaidSameTier = order.paymentStatus === "paid" && order.tier === params.tier;
  const currentRun = order.runs[0];

  // Nowy run tylko wtedy, gdy dokupiony pakiet analizuje więcej niż poprzedni
  // (np. free → basic to 1 → 3 podstrony). Inaczej wystarczy odblokowanie.
  const needsDeeperRun =
    !currentRun ||
    currentRun.status === "failed" ||
    TIERS[params.tier].maxPages > TIERS[currentRun.tier as AuditTier].maxPages ||
    tierRank(params.tier) > tierRank(currentRun.tier as AuditTier);

  if (alreadyPaidSameTier && !needsDeeperRun) {
    return { changed: false, enqueued: false };
  }

  await prisma.auditOrder.update({
    where: { id: order.id },
    data: {
      tier: params.tier,
      amountGrosz: TIERS[params.tier].priceGrosz,
      paymentStatus: "paid",
      paidAt: order.paidAt ?? new Date(),
      stripeSessionId: params.stripeSessionId ?? order.stripeSessionId,
      stripePaymentId: params.stripePaymentId ?? order.stripePaymentId,
    },
  });

  if (needsDeeperRun) {
    const running = currentRun && (currentRun.status === "queued" || currentRun.status === "running");
    if (!running || currentRun.tier !== params.tier) {
      await enqueueRun(order.id, params.tier);
      return { changed: true, enqueued: true };
    }
  }

  return { changed: true, enqueued: false };
}

export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip");
}
