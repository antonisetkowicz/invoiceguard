"use client";

import { useEffect, useState } from "react";

interface Alert {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  amountAtRisk: number;
  status: string;
  createdAt: string;
  invoice: { id: string; invoiceNumber: string; vendorName: string; amount: number } | null;
}

interface Summary {
  total: number;
  open: number;
  totalAmountAtRisk: number;
  byType: { DUPLICATE: number; ANOMALY: number };
}

export default function AnomaliesPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadAlerts() {
    setLoading(true);
    try {
      const params = filter ? "?status=" + filter : "";
      const res = await fetch("/api/anomalies" + params);
      const data = await res.json();
      if (data.success) {
        setAlerts(data.data.alerts);
        setSummary(data.data.summary);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAlerts(); }, [filter]);

  async function handleResolve(alertId: string) {
    const res = await fetch("/api/anomalies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId, status: "resolved" }),
    });
    const data = await res.json();
    if (data.success) loadAlerts();
  }

  async function handleDismiss(alertId: string) {
    const res = await fetch("/api/anomalies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId, status: "dismissed" }),
    });
    const data = await res.json();
    if (data.success) loadAlerts();
  }

  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2 });

  return (
    <div>
      <h1 className="text-2xl font-bold">Audit Alerts</h1>
      <p className="mt-1 text-sm text-gray-500">Review and resolve detected billing issues.</p>

      {summary && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Open Alerts</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{summary.open}</p>
          </div>
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Amount at Risk</p>
            <p className="mt-1 text-2xl font-bold text-orange-600">{fmt(summary.totalAmountAtRisk)}</p>
          </div>
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">By Type</p>
            <p className="mt-1 text-sm"><span className="font-semibold">{summary.byType.DUPLICATE}</span> Duplicates &middot; <span className="font-semibold">{summary.byType.ANOMALY}</span> Anomalies</p>
          </div>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        {["", "open", "resolved", "dismissed"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={"rounded-lg px-3 py-1.5 text-sm font-medium " + (filter === f ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50")}
          >
            {f === "" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="py-12 text-center text-gray-400">Loading...</div>
        ) : alerts.length === 0 ? (
          <div className="rounded-xl border bg-white p-12 text-center text-gray-400">No alerts found. Upload invoices to start auditing.</div>
        ) : alerts.map((alert) => (
          <div key={alert.id} className="flex items-start justify-between rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex gap-4">
              <div className={"mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full " + (alert.severity === "high" ? "bg-red-100" : "bg-yellow-100")}>
                <svg className={"h-5 w-5 " + (alert.severity === "high" ? "text-red-600" : "text-yellow-600")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{alert.title}</h3>
                  <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (alert.type === "DUPLICATE" ? "bg-purple-100 text-purple-700" : "bg-orange-100 text-orange-700")}>{alert.type}</span>
                  <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (alert.severity === "high" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700")}>{alert.severity}</span>
                </div>
                <p className="mt-1 text-sm text-gray-500">{alert.description}</p>
                {alert.invoice && (
                  <p className="mt-1 text-xs text-gray-400">Invoice: {alert.invoice.invoiceNumber} &middot; {alert.invoice.vendorName} &middot; {fmt(alert.invoice.amount)}</p>
                )}
                <p className="mt-1 text-sm font-semibold text-red-600">Amount at risk: {fmt(alert.amountAtRisk)}</p>
              </div>
            </div>
            {alert.status === "open" && (
              <div className="flex flex-shrink-0 gap-2">
                <button onClick={() => handleResolve(alert.id)} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">Resolve</button>
                <button onClick={() => handleDismiss(alert.id)} className="rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Dismiss</button>
              </div>
            )}
            {alert.status !== "open" && (
              <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (alert.status === "resolved" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>{alert.status}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
