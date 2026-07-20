"use client";

import { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  quantity: number;
  salePrice: number;
  cost: number;
  status: string;
  fulfillment: string;
  trackingNumber: string | null;
  createdAt: string;
  product: { id: string; name: string } | null;
}

interface Summary {
  total: number;
  open: number;
  autoFulfilled: number;
  revenue: number;
  profit: number;
}

const STATUSES = ["new", "paid", "fulfilled", "shipped", "delivered", "cancelled", "refunded"];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/orders" + (filter ? `?status=${filter}` : ""));
      const data = await res.json();
      if (data.success) {
        setOrders(data.data.orders);
        setSummary(data.data.summary);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [filter]);

  async function setStatus(orderId: string, status: string) {
    await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, status }),
    });
    load();
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="mt-1 text-sm text-gray-500">
          Incoming orders. New/paid orders can be auto-fulfilled by an automation rule.
        </p>
      </div>

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Open orders" value={String(summary.open)} sub={`${summary.total} total`} />
          <Stat label="Auto-fulfilled" value={String(summary.autoFulfilled)} sub="by automations" />
          <Stat label="Revenue" value={formatCurrency(summary.revenue)} />
          <Stat label="Profit" value={formatCurrency(summary.profit)} />
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <button onClick={() => setFilter("")} className={pill(filter === "")}>All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={pill(filter === s)}>{s}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-gray-400">No orders found.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Profit</th>
                <th className="px-4 py-3">Fulfillment</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium">{o.orderNumber}</p>
                    <p className="text-xs text-gray-400">{formatDate(o.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3">{o.customerName}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {o.product?.name || "—"} <span className="text-gray-400">×{o.quantity}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-medium text-green-600">{formatCurrency(o.salePrice - o.cost)}</span>
                    <p className="text-xs text-gray-400">{formatCurrency(o.salePrice)}</p>
                  </td>
                  <td className="px-4 py-3">
                    {o.fulfillment === "auto" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                        ⚡ auto
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">manual</span>
                    )}
                    {o.trackingNumber && <p className="mt-0.5 text-xs text-gray-400">{o.trackingNumber}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={o.status}
                      onChange={(e) => setStatus(o.id, e.target.value)}
                      className={"rounded-full border-0 px-2 py-1 text-xs font-medium " + statusBadge(o.status)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function pill(active: boolean): string {
  return (
    "rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors " +
    (active ? "bg-indigo-600 text-white" : "bg-white text-gray-600 border hover:bg-gray-50")
  );
}

function statusBadge(status: string): string {
  switch (status) {
    case "delivered": return "bg-green-100 text-green-700";
    case "shipped":
    case "fulfilled": return "bg-blue-100 text-blue-700";
    case "paid": return "bg-indigo-100 text-indigo-700";
    case "cancelled":
    case "refunded": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-600";
  }
}
