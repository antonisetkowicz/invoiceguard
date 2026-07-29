import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import type { CategoryScores } from "@/types/audit";
import { executeRun } from "@/lib/audit/engine";
import { sendAuditFailed, sendReportReady, mailerConfigured } from "@/lib/audit/mailer";
import { claimNextRun } from "@/lib/audit/queue";

/**
 * Silnik audytów. Osobny proces, bo jeden audyt trwa 40–150 s — nie mieści się
 * w cyklu request/response ani w limitach serverless.
 *
 *   npm run audit:worker
 */

const WORKER_ID = `${process.env.HOSTNAME ?? "worker"}-${crypto.randomBytes(3).toString("hex")}`;
const IDLE_DELAY_MS = Number(process.env.AUDIT_WORKER_IDLE_MS ?? 4000);

let shuttingDown = false;
let activeRunId: string | null = null;

function log(message: string, extra?: unknown) {
  const stamp = new Date().toISOString();
  if (extra !== undefined) console.log(`[${stamp}] [${WORKER_ID}] ${message}`, extra);
  else console.log(`[${stamp}] [${WORKER_ID}] ${message}`);
}

async function notify(runId: string) {
  const run = await prisma.auditRun.findUnique({
    where: { id: runId },
    include: { order: true, findings: { select: { severity: true } } },
  });
  if (!run) return;
  if (!mailerConfigured()) {
    log("Powiadomienie e-mail pominięte (brak RESEND_API_KEY / AUDIT_FROM_EMAIL).");
    return;
  }

  if (run.status === "done") {
    const scores = run.scores ? (JSON.parse(run.scores) as CategoryScores) : null;
    const sent = await sendReportReady({
      email: run.order.email,
      token: run.order.publicToken,
      url: run.order.url,
      overall: scores?.overall ?? 0,
      criticalCount: run.findings.filter((f) => f.severity === "critical").length,
    });
    if (sent) await prisma.auditOrder.update({ where: { id: run.orderId }, data: { reportSentAt: new Date() } });
  } else if (run.status === "failed") {
    await sendAuditFailed({
      email: run.order.email,
      token: run.order.publicToken,
      url: run.order.url,
      reason: run.error ?? "Nieznany błąd.",
    });
  }
}

async function tick(): Promise<boolean> {
  const run = await claimNextRun(WORKER_ID);
  if (!run) return false;

  activeRunId = run.id;
  log(`Start audytu ${run.id} · ${run.order.url} · pakiet ${run.tier}`);
  const startedAt = Date.now();

  const result = await executeRun(run.id);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (result.ok) log(`Gotowe w ${seconds}s → /audyt/raport/${run.order.publicToken}`);
  else log(`Błąd po ${seconds}s: ${result.error}`);

  await notify(run.id).catch((error) => log("Nie udało się wysłać powiadomienia:", error));
  activeRunId = null;
  return true;
}

async function main() {
  log("Worker audytów wystartował. Oczekiwanie na zlecenia…");
  if (!process.env.ANTHROPIC_API_KEY) {
    log("UWAGA: brak ANTHROPIC_API_KEY — każdy audyt zakończy się błędem na etapie analizy.");
  }

  while (!shuttingDown) {
    try {
      const didWork = await tick();
      if (!didWork) await new Promise((resolve) => setTimeout(resolve, IDLE_DELAY_MS));
    } catch (error) {
      log("Błąd pętli workera:", error);
      await new Promise((resolve) => setTimeout(resolve, IDLE_DELAY_MS * 2));
    }
  }

  log("Zamykanie…");
  await prisma.$disconnect();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    log(
      activeRunId
        ? `Otrzymano ${signal} — kończę bieżący audyt ${activeRunId}, potem wyjdę.`
        : `Otrzymano ${signal} — zamykam.`
    );
  });
}

void main();
