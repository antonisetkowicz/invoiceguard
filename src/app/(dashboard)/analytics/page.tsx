"use client";

import { useEffect, useState } from "react";
import type { DashboardStats } from "@/types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export default function AnalyticsPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => { if (d.success) setStats(d.data); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>;
  if (!stats) return <p className="text-gray-500">Failed to load analytics.</p>;

  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0 });
  const vendorPie = stats.topVendors.slice(0, 8).map((v) => ({ name: v.vendor, value: Math.round(v.amount) }));

  return (
    <div>
      <h1 className="text-2xl font-bold">Analytics</h1>
      <p className="mt-1 text-sm text-gray-500">Detailed spend analytics and trends.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Monthly Spend Trend</h2>
          <div className="mt-4 h-80">
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
            ) : <div className="flex h-full items-center justify-center text-sm text-gray-400">No data</div>}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Spend by Vendor</h2>
          <div className="mt-4 h-80">
            {vendorPie.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={vendorPie} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => name.slice(0, 15) + " (" + (percent * 100).toFixed(0) + "%)"}>
                    {vendorPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="flex h-full items-center justify-center text-sm text-gray-400">No data</div>}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Top Vendors</h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-500">Vendor</th>
              <th className="px-4 py-3 font-medium text-gray-500">Total Spend</th>
              <th className="px-4 py-3 font-medium text-gray-500">Invoices</th>
              <th className="px-4 py-3 font-medium text-gray-500">Avg Invoice</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {stats.topVendors.map((v) => (
              <tr key={v.vendor} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{v.vendor}</td>
                <td className="px-4 py-3">{fmt(v.amount)}</td>
                <td className="px-4 py-3">{v.invoiceCount}</td>
                <td className="px-4 py-3">{fmt(v.amount / v.invoiceCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
