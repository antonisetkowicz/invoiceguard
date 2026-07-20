"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

interface Product {
  id: string;
  name: string;
  category: string | null;
  supplierPrice: number;
  shippingCost: number;
  sellingPrice: number;
  stock: number;
  status: string;
  aiScore: number | null;
  aiVerdict: string | null;
  aiReasons: string | null;
  aiTitle: string | null;
  aiDescription: string | null;
  aiTags: string | null;
  aiAdCopy: string | null;
  aiSource: string | null;
}

const BLANK = { name: "", category: "", supplierPrice: "", shippingCost: "", sellingPrice: "", stock: "" };

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      if (data.success) setProducts(data.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addProduct(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) {
      setForm(BLANK);
      setShowForm(false);
      load();
    }
  }

  async function runAi(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/products/${id}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "all" }),
      });
      const data = await res.json();
      if (data.success) {
        setExpanded(id);
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/products/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Product Research</h1>
          <p className="mt-1 text-sm text-gray-500">
            Add products, let AI score their winning potential and write the listing for you.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          {showForm ? "Cancel" : "+ Add Product"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={addProduct} className="mb-6 grid grid-cols-2 gap-3 rounded-xl border bg-white p-5 md:grid-cols-3">
          <Field label="Product name" span>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Portable Blender Pro" />
          </Field>
          <Field label="Category">
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} placeholder="Kitchen" />
          </Field>
          <Field label="Supplier price ($)">
            <input type="number" step="0.01" value={form.supplierPrice} onChange={(e) => setForm({ ...form, supplierPrice: e.target.value })} className={inputCls} placeholder="8.50" />
          </Field>
          <Field label="Shipping ($)">
            <input type="number" step="0.01" value={form.shippingCost} onChange={(e) => setForm({ ...form, shippingCost: e.target.value })} className={inputCls} placeholder="3.00" />
          </Field>
          <Field label="Selling price ($)">
            <input type="number" step="0.01" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} className={inputCls} placeholder="34.99" />
          </Field>
          <Field label="Stock">
            <input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className={inputCls} placeholder="100" />
          </Field>
          <div className="col-span-2 md:col-span-3">
            <button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
              Save product
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-gray-400">
          No products yet. Add your first product to get an AI score and generated listing.
        </div>
      ) : (
        <div className="space-y-3">
          {products.map((p) => {
            const cost = p.supplierPrice + p.shippingCost;
            const margin = p.sellingPrice - cost;
            const mPct = p.sellingPrice > 0 ? margin / p.sellingPrice : 0;
            const open = expanded === p.id;
            return (
              <div key={p.id} className="rounded-xl border bg-white">
                <div className="flex flex-wrap items-center gap-4 p-4">
                  <div
                    className={"flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-lg text-sm font-bold " + scoreColor(p.aiScore)}
                    title="AI score"
                  >
                    {p.aiScore ?? "—"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{p.name}</p>
                      <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + statusBadge(p.status)}>{p.status}</span>
                      {p.aiVerdict && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{p.aiVerdict}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {p.category || "Uncategorized"} · cost {formatCurrency(cost)} · sells {formatCurrency(p.sellingPrice)} ·{" "}
                      <span className={margin < 0 ? "text-red-600" : "text-green-600"}>
                        {(mPct * 100).toFixed(0)}% margin ({formatCurrency(margin)})
                      </span>{" "}
                      · stock {p.stock}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => runAi(p.id)}
                      disabled={busy === p.id}
                      className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {busy === p.id ? "Thinking…" : "✨ AI Score + Listing"}
                    </button>
                    {(p.aiTitle || p.aiReasons) && (
                      <button onClick={() => setExpanded(open ? null : p.id)} className="rounded-lg border px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
                        {open ? "Hide" : "View"}
                      </button>
                    )}
                    <select
                      value={p.status}
                      onChange={(e) => updateStatus(p.id, e.target.value)}
                      className="rounded-lg border px-2 py-2 text-xs text-gray-600"
                    >
                      {["draft", "active", "winner", "paused", "archived"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button onClick={() => remove(p.id)} className="rounded-lg border px-2 py-2 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                      ✕
                    </button>
                  </div>
                </div>

                {open && (p.aiTitle || p.aiReasons) && (
                  <div className="grid gap-4 border-t bg-gray-50 p-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        AI verdict {p.aiSource ? `· ${p.aiSource}` : ""}
                      </h4>
                      <ul className="space-y-1 text-sm text-gray-700">
                        {parseList(p.aiReasons).map((r, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-indigo-500">•</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Generated listing</h4>
                      {p.aiTitle && <p className="text-sm font-semibold">{p.aiTitle}</p>}
                      {p.aiDescription && <p className="mt-1 text-sm text-gray-600">{p.aiDescription}</p>}
                      {p.aiAdCopy && <p className="mt-2 rounded-md bg-white p-2 text-sm italic text-gray-700">{p.aiAdCopy}</p>}
                      {parseList(p.aiTags).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {parseList(p.aiTags).map((t, i) => (
                            <span key={i} className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">#{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

function Field({ label, span, children }: { label: string; span?: boolean; children: React.ReactNode }) {
  return (
    <label className={span ? "col-span-2 md:col-span-3" : ""}>
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function scoreColor(score: number | null): string {
  if (score == null) return "bg-gray-100 text-gray-400";
  if (score >= 75) return "bg-green-100 text-green-700";
  if (score >= 55) return "bg-blue-100 text-blue-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function statusBadge(status: string): string {
  switch (status) {
    case "winner": return "bg-green-100 text-green-700";
    case "active": return "bg-blue-100 text-blue-700";
    case "paused": return "bg-amber-100 text-amber-700";
    case "archived": return "bg-gray-100 text-gray-500";
    default: return "bg-gray-100 text-gray-600";
  }
}
