"use client";

import { useEffect, useState } from "react";
import type { DashboardStats } from "@/types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={"mt-2 text-3xl font-bold " + color}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => { if (d.success) setStats(d.data); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!stats) return <p className="text-gray-500">Failed to load dashboard data.</p>;

  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Overview of your invoice audit activity.</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Invoices" value={stats.totalInvoices.toLocaleString()} color="text-gray-900" />
        <StatCard label="Total Spend" value={fmt(stats.totalSpend)} color="text-gray-900" />
        <StatCard label="Open Alerts" value={stats.openAlerts.toString()} sub="Requires review" color="text-red-600" />
        <StatCard label="Savings Recovered" value={fmt(stats.totalSavings)} sub="From resolved alerts" color="text-green-600" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Monthly Spend</h2>
          <div className="mt-4 h-72">
            {stats.monthlySpend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.monthlySpend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => "$" + (v / 1000).toFixed(0) + "k"} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">No data yet. Upload invoices to get started.</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Top Vendors by Spend</h2>
          <div className="mt-4 space-y-3">
            {stats.topVendors.length > 0 ? stats.topVendors.slice(0, 7).map((v) => (
              <div key={v.vendor} className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{v.vendor}</p>
                  <p className="text-xs text-gray-400">{v.invoiceCount} invoices</p>
                </div>
                <p className="text-sm font-semibold">{fmt(v.amount)}</p>
              </div>
            )) : (
              <p className="text-sm text-gray-400">No vendors yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
