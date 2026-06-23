import Link from "next/link";

const FEATURES = [
  {
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
    title: "Duplicate Detection",
    desc: "Smart algorithms detect duplicate invoices across vendors, amounts, and dates with fuzzy matching.",
  },
  {
    icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
    title: "Anomaly Detection",
    desc: "Statistical analysis flags unusual charges, price spikes, and billing pattern deviations automatically.",
  },
  {
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    title: "Cost Recovery",
    desc: "Track recovered savings from caught duplicates and billing errors. Average ROI: 10x in the first month.",
  },
];

const STATS = [
  { value: "$2.4M+", label: "Savings Detected" },
  { value: "12,000+", label: "Invoices Audited" },
  { value: "340+", label: "Duplicates Caught" },
  { value: "98.5%", label: "Detection Accuracy" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <nav className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-gray-900">InvoiceGuard</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900">Sign In</Link>
            <Link href="/register" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Get Started Free</Link>
          </div>
        </div>
      </nav>

      <section className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 py-24 text-white">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <h1 className="text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            Stop Losing Money on<br />
            <span className="text-blue-200">Duplicate Invoices</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-blue-100">
            Companies lose 1-3% of accounts payable spend to duplicate payments and billing errors.
            InvoiceGuard catches them automatically, saving you an average of $127K per year.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/register" className="rounded-lg bg-white px-8 py-3 text-base font-semibold text-blue-700 shadow-lg hover:bg-blue-50">
              Start Free Audit
            </Link>
            <Link href="#features" className="rounded-lg border border-blue-300 px-8 py-3 text-base font-semibold text-white hover:bg-blue-600">
              See How It Works
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b bg-white py-12">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-bold text-blue-600">{s.value}</div>
              <div className="mt-1 text-sm text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-center text-3xl font-bold">How InvoiceGuard Saves You Money</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-500">
            Upload your invoices and our algorithms immediately scan for duplicates, anomalies, and overcharges.
          </p>
          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border bg-white p-8 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                  <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-gray-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-blue-600 py-16">
        <div className="mx-auto max-w-7xl px-6 text-center text-white">
          <h2 className="text-3xl font-bold">Ready to Stop Overpaying?</h2>
          <p className="mt-4 text-blue-100">Start your free invoice audit in under 2 minutes. No credit card required.</p>
          <Link href="/register" className="mt-8 inline-block rounded-lg bg-white px-8 py-3 text-base font-semibold text-blue-700 hover:bg-blue-50">
            Get Started Free
          </Link>
        </div>
      </section>

      <footer className="border-t bg-white py-8">
        <div className="mx-auto max-w-7xl px-6 text-center text-sm text-gray-400">
          &copy; 2026 InvoiceGuard. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
