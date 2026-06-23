"use client";

import { useEffect, useState, useCallback } from "react";

interface Invoice {
  id: string;
  invoiceNumber: string;
  vendorName: string;
  amount: number;
  currency: string;
  issueDate: string;
  status: string;
  category: string | null;
  alerts: { id: string; type: string; severity: string }[];
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/invoices?page=" + page + "&search=" + encodeURIComponent(search));
      const data = await res.json();
      if (data.success) {
        setInvoices(data.data);
        setTotal(data.meta.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/invoices/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        setUploadResult("Imported " + data.data.imported + " invoices. Found " + data.data.duplicatesFound + " duplicates, " + data.data.anomaliesFound + " anomalies.");
        loadInvoices();
      } else {
        setUploadResult("Error: " + (data.error || "Upload failed"));
      }
    } catch {
      setUploadResult("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2 });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="mt-1 text-sm text-gray-500">{total} total invoices</p>
        </div>
        <label className={"cursor-pointer rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 " + (uploading ? "opacity-50 pointer-events-none" : "")}>
          {uploading ? "Uploading..." : "Upload CSV"}
          <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
        </label>
      </div>

      {uploadResult && (
        <div className={"mt-4 rounded-lg p-3 text-sm " + (uploadResult.startsWith("Error") ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700")}>
          {uploadResult}
        </div>
      )}

      <div className="mt-6">
        <input
          type="text"
          placeholder="Search invoices..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-500">Invoice #</th>
              <th className="px-4 py-3 font-medium text-gray-500">Vendor</th>
              <th className="px-4 py-3 font-medium text-gray-500">Amount</th>
              <th className="px-4 py-3 font-medium text-gray-500">Date</th>
              <th className="px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 font-medium text-gray-500">Alerts</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Loading...</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No invoices found. Upload a CSV to get started.</td></tr>
            ) : invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                <td className="px-4 py-3">{inv.vendorName}</td>
                <td className="px-4 py-3 font-medium">{fmt(inv.amount)}</td>
                <td className="px-4 py-3 text-gray-500">{fmtDate(inv.issueDate)}</td>
                <td className="px-4 py-3">
                  <span className={"inline-flex rounded-full px-2 py-0.5 text-xs font-medium " + (inv.status === "pending" ? "bg-yellow-100 text-yellow-700" : inv.status === "approved" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                    {inv.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {inv.alerts.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      {inv.alerts.length} alert{inv.alerts.length > 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Clean</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50">Previous</button>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
