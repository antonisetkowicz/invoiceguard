"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import type { DropshipStats } from "@/types";

export default function DropshipOverviewPage() {
  const [stats, setStats] = useState<DropshipStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/dropship");
      const data = await res.json();
      if (data.success) setStats(data.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runAutomations() {
    setRunning(true);
    setFlash(null);
    try {
      const res = await fetch("/api/automations/run", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setFlash(`Ran ${data.data.rulesEvaluated} rules · ${data.data.actionsApplied} actions applied`);
        await load();
      }
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (!stats) return <p className="text-gray-500">Failed to load store data.</p>;

  const cards = [
    { label: "Products", value: String(stats.totalProducts), sub: `${stats.activeProducts} active · ${stats.winners} winners` },
    { label: "Avg. Margin", value: `${(stats.avgMarginPct * 100).toFixed(0)}%`, sub: "gross across catalog" },
    { label: "Revenue", value: formatCurrency(stats.totalRevenue), sub: `${formatCurrency(stats.totalProfit)} profit` },
    { label: "Open Orders", value: String(stats.openOrders), sub: `${stats.autoFulfilledOrders} auto-fulfilled` },
    { label: "Active Rules", value: String(stats.activeRules), sub: `${stats.automationActions} actions run` },
  ];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Store Command Center</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI product research, listing generation, and hands-off order automation.
          </p>
        </div>
        <button
          onClick={runAutomations}
          disabled={running}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {running ? "Running…" : "⚡ Run Automations"}
        </button>
      </div>

      {flash && (
        <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
          {flash}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{c.label}</p>
            <p className="mt-2 text-2xl font-bold">{c.value}</p>
            <p className="mt-1 text-xs text-gray-400">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Top AI-Scored Products</h2>
            <Link href="/products" className="text-sm font-medium text-indigo-600 hover:underline">
              Product research →
            </Link>
          </div>
          {stats.topProducts.length === 0 ? (
            <p className="text-sm text-gray-400">No products yet. Add some in Product research.</p>
          ) : (
            <ul className="space-y-3">
              {stats.topProducts.map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <span className="truncate pr-4 text-sm">{p.name}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-gray-500">{(p.marginPct * 100).toFixed(0)}% margin</span>
                    <span
                      className={
                        "inline-flex h-8 w-10 items-center justify-center rounded-md text-xs font-bold " +
                        scoreColor(p.score)
                      }
                    >
                      {p.score ?? "—"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Recent Automation Activity</h2>
            <Link href="/automations" className="text-sm font-medium text-indigo-600 hover:underline">
              Manage rules →
            </Link>
          </div>
          {stats.recentLogs.length === 0 ? (
            <p className="text-sm text-gray-400">No automation activity yet. Hit “Run Automations”.</p>
          ) : (
            <ul className="space-y-2.5">
              {stats.recentLogs.map((l) => (
                <li key={l.id} className="flex items-start gap-2 text-sm">
                  <span className={"mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full " + levelDot(l.level)} />
                  <span className="text-gray-700">{l.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function scoreColor(score: number | null): string {
  if (score == null) return "bg-gray-100 text-gray-400";
  if (score >= 75) return "bg-green-100 text-green-700";
  if (score >= 55) return "bg-blue-100 text-blue-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function levelDot(level: string): string {
  if (level === "success") return "bg-green-500";
  if (level === "warning") return "bg-amber-500";
  return "bg-indigo-500";
}
