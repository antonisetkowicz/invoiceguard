// Pricing & margin helpers for dropshipping products.
// Everything is per-unit unless noted otherwise.

export interface CostInputs {
  supplierPrice: number;
  shippingCost: number;
  sellingPrice: number;
}

/** Landed unit cost the store pays (goods + shipping). */
export function unitCost(p: Pick<CostInputs, "supplierPrice" | "shippingCost">): number {
  return round(p.supplierPrice + p.shippingCost);
}

/** Absolute profit per unit at the current selling price. */
export function unitMargin(p: CostInputs): number {
  return round(p.sellingPrice - unitCost(p));
}

/** Profit as a fraction of the selling price (0-1). Gross margin. */
export function marginPct(p: CostInputs): number {
  if (p.sellingPrice <= 0) return 0;
  return round(unitMargin(p) / p.sellingPrice, 4);
}

/** Selling price divided by cost, e.g. 3.0 == a classic 3x markup. */
export function markup(p: CostInputs): number {
  const cost = unitCost(p);
  if (cost <= 0) return 0;
  return round(p.sellingPrice / cost, 2);
}

/**
 * Retail price that yields a target gross margin.
 * targetMarginPct is a fraction (0.65 == keep 65% of revenue as margin).
 */
export function recommendedPrice(cost: number, targetMarginPct = 0.65): number {
  const capped = Math.min(Math.max(targetMarginPct, 0), 0.95);
  if (cost <= 0) return 0;
  return round(cost / (1 - capped), 2);
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
