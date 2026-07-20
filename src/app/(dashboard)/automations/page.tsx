"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

interface Rule {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  threshold: number;
  action: string;
  enabled: boolean;
  timesTriggered: number;
  lastTriggered: string | null;
}

interface Log {
  id: string;
  action: string;
  message: string;
  level: string;
  createdAt: string;
}

const TRIGGERS = [
  { value: "low_margin", label: "Margin below threshold", hint: "fraction, e.g. 0.2 = 20%" },
  { value: "low_stock", label: "Stock below threshold", hint: "units, e.g. 10" },
  { value: "high_score", label: "AI score at/above threshold", hint: "0-100, e.g. 75" },
  { value: "supplier_risk", label: "Supplier rating below threshold", hint: "0-5, e.g. 3.5" },
  { value: "new_order", label: "New/paid order received", hint: "no threshold" },
];

const ACTIONS = [
  { value: "flag", label: "Flag for review" },
  { value: "pause_product", label: "Pause product" },
  { value: "tag_winner", label: "Tag as winner & activate" },
  { value: "restock_alert", label: "Raise restock alert" },
  { value: "auto_fulfill", label: "Auto-fulfill order" },
];

const BLANK = { name: "", trigger: "low_margin", threshold: "0.2", action: "flag", description: "" };

export default function AutomationsPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/automations");
      const data = await res.json();
      if (data.success) {
        setRules(data.data.rules);
        setLogs(data.data.logs);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function run() {
    setRunning(true);
    setFlash(null);
    try {
      const res = await fetch("/api/automations/run", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setFlash(`Evaluated ${data.data.rulesEvaluated} rules · ${data.data.actionsApplied} actions applied`);
        await load();
      }
    } finally {
      setRunning(false);
    }
  }

  async function toggle(rule: Rule) {
    await fetch("/api/automations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruleId: rule.id, enabled: !rule.enabled }),
    });
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/automations?ruleId=${id}`, { method: "DELETE" });
    load();
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, threshold: parseFloat(form.threshold) || 0 }),
    });
    const data = await res.json();
    if (data.success) {
      setForm(BLANK);
      setShowForm(false);
      load();
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Automations</h1>
          <p className="mt-1 text-sm text-gray-500">
            Rules that watch your catalog and orders, then act automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowForm((s) => !s)} className="rounded-lg border px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            {showForm ? "Cancel" : "+ New Rule"}
          </button>
          <button onClick={run} disabled={running} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {running ? "Running…" : "⚡ Run Now"}
          </button>
        </div>
      </div>

      {flash && (
        <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">{flash}</div>
      )}

      {showForm && (
        <form onSubmit={addRule} className="mb-6 grid grid-cols-2 gap-3 rounded-xl border bg-white p-5">
          <label className="col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-600">Rule name</span>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Pause low-margin products" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-600">When (trigger)</span>
            <select value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })} className={inputCls}>
              {TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-600">Threshold</span>
            <input value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} className={inputCls} placeholder="0.2" />
            <span className="mt-1 block text-xs text-gray-400">{TRIGGERS.find((t) => t.value === form.trigger)?.hint}</span>
          </label>
          <label className="col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-600">Then (action)</span>
            <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} className={inputCls}>
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </label>
          <div className="col-span-2">
            <button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">Create rule</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {rules.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-gray-400">
                No rules yet. Create one to start automating your store.
              </div>
            ) : (
              rules.map((r) => (
                <div key={r.id} className="rounded-xl border bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{r.name}</p>
                        <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (r.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                          {r.enabled ? "on" : "off"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        <span className="font-medium text-gray-700">{triggerLabel(r.trigger)}</span>
                        {r.trigger !== "new_order" && <> ({r.threshold})</>} →{" "}
                        <span className="font-medium text-gray-700">{actionLabel(r.action)}</span>
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        Triggered {r.timesTriggered}× {r.lastTriggered ? `· last ${formatDate(r.lastTriggered)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => toggle(r)}
                        className={"relative h-6 w-11 rounded-full transition-colors " + (r.enabled ? "bg-indigo-600" : "bg-gray-300")}
                        title={r.enabled ? "Disable" : "Enable"}
                      >
                        <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all " + (r.enabled ? "left-[22px]" : "left-0.5")} />
                      </button>
                      <button onClick={() => remove(r.id)} className="rounded-lg border px-2 py-1.5 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600" title="Delete">✕</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-xl border bg-white p-5">
            <h2 className="mb-4 font-semibold">Activity Log</h2>
            {logs.length === 0 ? (
              <p className="text-sm text-gray-400">Nothing yet. Run your automations to see activity.</p>
            ) : (
              <ul className="space-y-3">
                {logs.map((l) => (
                  <li key={l.id} className="flex items-start gap-2 text-sm">
                    <span className={"mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full " + levelDot(l.level)} />
                    <div>
                      <p className="text-gray-700">{l.message}</p>
                      <p className="text-xs text-gray-400">{formatDate(l.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

function triggerLabel(v: string): string {
  return TRIGGERS.find((t) => t.value === v)?.label || v;
}
function actionLabel(v: string): string {
  return ACTIONS.find((a) => a.value === v)?.label || v;
}
function levelDot(level: string): string {
  if (level === "success") return "bg-green-500";
  if (level === "warning") return "bg-amber-500";
  return "bg-indigo-500";
}
