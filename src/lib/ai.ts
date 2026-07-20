// AI service for the dropshipping automation module.
//
// When ANTHROPIC_API_KEY is set, product copy and scoring are produced by
// Claude. Otherwise a deterministic heuristic engine runs instead, so the
// whole module works offline (CI, local demos, or before a key is configured).

import { unitCost, unitMargin, marginPct, markup, recommendedPrice } from "./pricing";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export interface ProductInput {
  name: string;
  category?: string | null;
  supplierPrice: number;
  shippingCost: number;
  sellingPrice: number;
}

export interface GeneratedContent {
  title: string;
  description: string;
  bulletPoints: string[];
  tags: string[];
  adCopy: string;
  source: "claude" | "heuristic";
}

export interface ProductScore {
  score: number; // 0-100
  verdict: "Winner" | "Promising" | "Risky" | "Avoid";
  reasons: string[];
  recommendedPrice: number;
  estMarginPct: number;
  source: "claude" | "heuristic";
}

function hasKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function callClaude(system: string, user: string, maxTokens = 1024): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API error ${res.status}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.map((b) => b.text || "").join("") ?? "";
  return text.trim();
}

/** Pull the first balanced JSON object out of a model response. */
function extractJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in response");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

// ── Content generation ────────────────────────────────────────

export async function generateProductContent(input: ProductInput): Promise<GeneratedContent> {
  if (hasKey()) {
    try {
      const system =
        "You are an expert e-commerce copywriter for a dropshipping store. " +
        "Return ONLY minified JSON with keys: title (string, <=70 chars, SEO-friendly), " +
        "description (string, 2-3 sentences), bulletPoints (string[4]), tags (string[6]), " +
        "adCopy (string, one punchy Facebook/TikTok ad line). No markdown, no commentary.";
      const user = `Product: ${input.name}\nCategory: ${input.category || "general"}\nRetail price: ${input.sellingPrice} ${""}`;
      const raw = await callClaude(system, user, 900);
      const parsed = extractJson<Omit<GeneratedContent, "source">>(raw);
      return { ...parsed, source: "claude" };
    } catch {
      // fall through to heuristic
    }
  }
  return { ...heuristicContent(input), source: "heuristic" };
}

function heuristicContent(input: ProductInput): Omit<GeneratedContent, "source"> {
  const name = input.name.trim();
  const category = (input.category || "everyday").toLowerCase();
  const title = titleCase(`${name} – Premium ${category} Essential (Free Shipping)`).slice(0, 70);

  const description =
    `Upgrade your ${category} routine with the ${name}. ` +
    `Thoughtfully designed for daily use, it blends durable quality with a sleek, modern look. ` +
    `Ships fast and backed by our satisfaction guarantee.`;

  const bulletPoints = [
    `Premium build quality made to last`,
    `Solves a real ${category} pain point`,
    `Lightweight, portable and easy to use`,
    `Risk-free: 30-day money-back guarantee`,
  ];

  const tags = dedupe([
    slug(category),
    slug(name.split(" ")[0] || "product"),
    "trending",
    "giftidea",
    "musthave",
    "freeshipping",
  ]).slice(0, 6);

  const adCopy = `🔥 The ${name} everyone's talking about — grab yours before it sells out again!`;

  return { title, description, bulletPoints, tags, adCopy };
}

// ── Product scoring ───────────────────────────────────────────

export async function scoreProduct(input: ProductInput): Promise<ProductScore> {
  const heuristic = heuristicScore(input);

  if (hasKey()) {
    try {
      const system =
        "You are a dropshipping product analyst. Judge a product's potential as a winning " +
        "dropshipping item based on price point, margin, and market appeal. Return ONLY minified " +
        'JSON: {"score": number 0-100, "verdict": "Winner"|"Promising"|"Risky"|"Avoid", ' +
        '"reasons": string[3]}. Be concise and specific.';
      const cost = unitCost(input);
      const user =
        `Product: ${input.name}\nCategory: ${input.category || "general"}\n` +
        `Landed cost: ${cost}\nSelling price: ${input.sellingPrice}\n` +
        `Gross margin: ${(marginPct(input) * 100).toFixed(0)}% (${markup(input)}x markup)`;
      const raw = await callClaude(system, user, 500);
      const parsed = extractJson<{ score: number; verdict: ProductScore["verdict"]; reasons: string[] }>(raw);
      return {
        score: clampScore(parsed.score),
        verdict: parsed.verdict,
        reasons: parsed.reasons,
        recommendedPrice: heuristic.recommendedPrice,
        estMarginPct: heuristic.estMarginPct,
        source: "claude",
      };
    } catch {
      // fall through to heuristic
    }
  }
  return heuristic;
}

function heuristicScore(input: ProductInput): ProductScore {
  const cost = unitCost(input);
  const mPct = marginPct(input);
  const mAbs = unitMargin(input);
  const mk = markup(input);
  const price = input.sellingPrice;
  const reasons: string[] = [];
  let score = 40;

  // Impulse-buy sweet spot: $15–70 retail.
  if (price >= 15 && price <= 70) {
    score += 18;
    reasons.push(`$${price.toFixed(2)} sits in the impulse-buy sweet spot ($15–70)`);
  } else if (price < 15) {
    score += 4;
    reasons.push(`$${price.toFixed(2)} is low — ad costs may eat the margin`);
  } else {
    score += 8;
    reasons.push(`$${price.toFixed(2)} is a higher price point — expect a longer sales cycle`);
  }

  // Margin percentage.
  if (mPct >= 0.6) {
    score += 22;
    reasons.push(`Strong ${(mPct * 100).toFixed(0)}% gross margin absorbs ad spend`);
  } else if (mPct >= 0.4) {
    score += 12;
    reasons.push(`Workable ${(mPct * 100).toFixed(0)}% margin, watch your CPA`);
  } else {
    score -= 6;
    reasons.push(`Thin ${(mPct * 100).toFixed(0)}% margin leaves little room for ads`);
  }

  // Markup multiple.
  if (mk >= 3) {
    score += 12;
    reasons.push(`${mk}x markup gives healthy pricing flexibility`);
  } else if (mk >= 2) {
    score += 6;
  }

  // Shipping drag.
  const shipRatio = cost > 0 ? input.shippingCost / cost : 1;
  if (shipRatio > 0.4) {
    score -= 8;
    reasons.push(`Shipping is ${(shipRatio * 100).toFixed(0)}% of cost — hurts margin and delivery time`);
  }

  if (mAbs < 0) {
    score = clampScore(Math.min(score, 20));
    reasons.unshift(`Selling below landed cost — losing $${Math.abs(mAbs).toFixed(2)} per unit`);
  } else {
    score = clampScore(score);
  }

  const verdict: ProductScore["verdict"] =
    score >= 75 ? "Winner" : score >= 55 ? "Promising" : score >= 40 ? "Risky" : "Avoid";

  return {
    score,
    verdict,
    reasons: reasons.slice(0, 4),
    recommendedPrice: recommendedPrice(cost, 0.65),
    estMarginPct: mPct,
    source: "heuristic",
  };
}

// ── small utils ───────────────────────────────────────────────

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "item";
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}
