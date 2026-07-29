import { prisma } from "@/lib/db";
import type { AuditTier, RunStage } from "@/types/audit";
import { LIMITS } from "./config";

/**
 * Kolejka oparta o bazę — bez Redisa i bez dodatkowej usługi.
 * Claim jest atomowy (updateMany z warunkiem na statusie), więc wiele
 * workerów nie weźmie tego samego runu nawet po zmianie na Postgresa.
 */

export async function enqueueRun(orderId: string, tier: AuditTier) {
  return prisma.auditRun.create({
    data: { orderId, tier, status: "queued", stage: "queued", progress: 0 },
  });
}

export async function claimNextRun(workerId: string) {
  await reclaimStaleRuns();

  const candidates = await prisma.auditRun.findMany({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { id: true },
  });

  for (const candidate of candidates) {
    const now = new Date();
    const claimed = await prisma.auditRun.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: {
        status: "running",
        stage: "scrape",
        workerId,
        claimedAt: now,
        heartbeatAt: now,
        startedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 1) {
      return prisma.auditRun.findUnique({ where: { id: candidate.id }, include: { order: true } });
    }
  }
  return null;
}

/** Worker padł w połowie? Po `staleAfterMinutes` run wraca do kolejki. */
export async function reclaimStaleRuns() {
  const cutoff = new Date(Date.now() - LIMITS.staleAfterMinutes * 60_000);

  const stale = await prisma.auditRun.findMany({
    where: { status: "running", heartbeatAt: { lt: cutoff } },
    select: { id: true, attempts: true },
  });

  for (const run of stale) {
    if (run.attempts >= LIMITS.maxAttempts) {
      await prisma.auditRun.updateMany({
        where: { id: run.id, status: "running" },
        data: {
          status: "failed",
          stage: "failed",
          error: "Audyt przerwany — proces wykonawczy przestał odpowiadać.",
          finishedAt: new Date(),
        },
      });
    } else {
      await prisma.auditRun.updateMany({
        where: { id: run.id, status: "running" },
        data: { status: "queued", stage: "queued", progress: 0, workerId: null, claimedAt: null },
      });
    }
  }
  return stale.length;
}

export async function heartbeat(runId: string) {
  await prisma.auditRun.updateMany({
    where: { id: runId, status: "running" },
    data: { heartbeatAt: new Date() },
  });
}

export async function setStage(runId: string, stage: RunStage, progress: number, message?: string) {
  await prisma.auditRun.update({
    where: { id: runId },
    data: { stage, progress, heartbeatAt: new Date() },
  });
  if (message) await logEvent(runId, stage, message);
}

export async function logEvent(runId: string, stage: string, message: string, level: "info" | "warn" | "error" = "info") {
  await prisma.auditEvent.create({ data: { runId, stage, message, level } });
}

export async function failRun(runId: string, error: string) {
  const run = await prisma.auditRun.findUnique({ where: { id: runId }, select: { attempts: true } });
  const retryable = (run?.attempts ?? LIMITS.maxAttempts) < LIMITS.maxAttempts;

  await logEvent(runId, "failed", error, "error");

  if (retryable) {
    await prisma.auditRun.update({
      where: { id: runId },
      data: { status: "queued", stage: "queued", progress: 0, error, workerId: null, claimedAt: null },
    });
    return { requeued: true };
  }

  await prisma.auditRun.update({
    where: { id: runId },
    data: { status: "failed", stage: "failed", error, finishedAt: new Date() },
  });
  return { requeued: false };
}
