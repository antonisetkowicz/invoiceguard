// Rule-based automation engine for the dropshipping module.
//
// Each AutomationRule pairs a trigger (a condition over products/orders) with an
// action. Running the engine evaluates every enabled rule for an organization,
// applies the matching action, and records an AutomationLog entry for each hit.

import { prisma } from "./db";
import { unitCost, marginPct } from "./pricing";

export interface AutomationRunResult {
  rulesEvaluated: number;
  actionsApplied: number;
  logs: {
    ruleId: string;
    action: string;
    message: string;
    level: string;
    entityType: string | null;
    entityId: string | null;
  }[];
}

type LogDraft = AutomationRunResult["logs"][number];

export async function runAutomations(organizationId: string): Promise<AutomationRunResult> {
  const [rules, products, orders] = await Promise.all([
    prisma.automationRule.findMany({ where: { organizationId, enabled: true } }),
    prisma.product.findMany({ where: { organizationId }, include: { supplier: true } }),
    prisma.order.findMany({ where: { organizationId } }),
  ]);

  const drafts: LogDraft[] = [];
  let actionsApplied = 0;

  for (const rule of rules) {
    let hits = 0;

    switch (rule.trigger) {
      case "low_margin": {
        const limit = rule.threshold || 0.2;
        for (const p of products) {
          if (p.status === "archived") continue;
          if (marginPct(p) < limit) {
            drafts.push(
              await applyProductAction(rule, p.id, p.name, "low_margin", {
                message: `"${p.name}" margin ${(marginPct(p) * 100).toFixed(0)}% is below ${(limit * 100).toFixed(0)}% target`,
              })
            );
            hits++;
          }
        }
        break;
      }

      case "low_stock": {
        const limit = rule.threshold || 10;
        for (const p of products) {
          if (p.status === "archived") continue;
          if (p.stock < limit) {
            drafts.push(
              await applyProductAction(rule, p.id, p.name, "low_stock", {
                message: `"${p.name}" stock is ${p.stock} (below ${limit})`,
                level: "warning",
              })
            );
            hits++;
          }
        }
        break;
      }

      case "high_score": {
        const limit = rule.threshold || 75;
        for (const p of products) {
          if (p.aiScore != null && p.aiScore >= limit && p.status !== "winner") {
            drafts.push(
              await applyProductAction(rule, p.id, p.name, "high_score", {
                message: `"${p.name}" scored ${p.aiScore}/100 — flagged as a winning product`,
                level: "success",
              })
            );
            hits++;
          }
        }
        break;
      }

      case "supplier_risk": {
        const limit = rule.threshold || 3.5;
        for (const p of products) {
          if (p.supplier && p.supplier.rating > 0 && p.supplier.rating < limit) {
            drafts.push(
              await applyProductAction(rule, p.id, p.name, "supplier_risk", {
                message: `"${p.name}" supplier ${p.supplier.name} rated ${p.supplier.rating.toFixed(1)}★ (below ${limit}★)`,
                level: "warning",
              })
            );
            hits++;
          }
        }
        break;
      }

      case "new_order": {
        for (const o of orders) {
          if (o.status === "new" || o.status === "paid") {
            drafts.push(await applyOrderAction(rule, o.id, o.orderNumber));
            hits++;
          }
        }
        break;
      }
    }

    if (hits > 0) {
      actionsApplied += hits;
      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { timesTriggered: { increment: hits }, lastTriggered: new Date() },
      });
    }
  }

  if (drafts.length > 0) {
    await prisma.automationLog.createMany({
      data: drafts.map((d) => ({ ...d, organizationId })),
    });
  }

  return { rulesEvaluated: rules.length, actionsApplied, logs: drafts };
}

async function applyProductAction(
  rule: { id: string; action: string },
  productId: string,
  productName: string,
  trigger: string,
  opts: { message: string; level?: string }
): Promise<LogDraft> {
  let message = opts.message;
  const level = opts.level || "info";

  switch (rule.action) {
    case "pause_product":
      await prisma.product.update({ where: { id: productId }, data: { status: "paused" } });
      message += " → paused";
      break;
    case "tag_winner":
      await prisma.product.update({ where: { id: productId }, data: { status: "winner" } });
      message += " → tagged winner & activated";
      break;
    case "restock_alert":
      message += " → restock alert raised";
      break;
    case "flag":
    default:
      message += " → flagged for review";
      break;
  }

  return {
    ruleId: rule.id,
    action: rule.action,
    message,
    level,
    entityType: "product",
    entityId: productId,
  };
}

async function applyOrderAction(
  rule: { id: string; action: string },
  orderId: string,
  orderNumber: string
): Promise<LogDraft> {
  let message = `Order ${orderNumber}`;
  let level = "info";

  if (rule.action === "auto_fulfill") {
    const tracking = `TRK${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "fulfilled", fulfillment: "auto", trackingNumber: tracking },
    });
    message += ` auto-fulfilled → tracking ${tracking}`;
    level = "success";
  } else {
    message += " flagged for fulfillment";
  }

  return {
    ruleId: rule.id,
    action: rule.action,
    message,
    level,
    entityType: "order",
    entityId: orderId,
  };
}
