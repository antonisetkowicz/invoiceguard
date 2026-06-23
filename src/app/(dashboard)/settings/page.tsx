"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [user, setUser] = useState<{ name: string; email: string; role: string; organization: { name: string; plan: string } } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (d.success) setUser(d.data); });
  }, []);

  if (!user) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">Manage your account and organization.</p>

      <div className="mt-8 space-y-6">
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Profile</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-500">Name</label>
              <p className="mt-1 text-sm font-medium">{user.name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Email</label>
              <p className="mt-1 text-sm font-medium">{user.email}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Role</label>
              <p className="mt-1 text-sm font-medium capitalize">{user.role}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Organization</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-500">Company Name</label>
              <p className="mt-1 text-sm font-medium">{user.organization.name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Plan</label>
              <p className="mt-1">
                <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 capitalize">{user.organization.plan}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">CSV Upload Format</h2>
          <p className="mt-2 text-sm text-gray-500">Your CSV file should have the following columns:</p>
          <div className="mt-3 overflow-x-auto rounded-lg border bg-gray-50 p-4">
            <code className="text-xs text-gray-700">invoiceNumber, vendorName, amount, issueDate, dueDate, category, description</code>
          </div>
          <p className="mt-2 text-xs text-gray-400">Column names are case-insensitive and support common aliases (e.g., &quot;vendor&quot;, &quot;supplier&quot;, &quot;company&quot; for vendor name).</p>
        </div>
      </div>
    </div>
  );
}
