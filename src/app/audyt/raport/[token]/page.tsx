import type { Metadata } from "next";
import Link from "next/link";
import ReportView from "./ReportView";

// Raport jest prywatny (dostęp przez sekretny token) — nie chcemy go w Google.
export const metadata: Metadata = {
  title: "Raport z audytu strony",
  robots: { index: false, follow: false },
};

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/audyt" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <span className="text-lg font-bold text-slate-900">Audyt strony</span>
          </Link>
          <Link href="/audyt" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Nowy audyt
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <ReportView token={token} />
      </main>
    </div>
  );
}
