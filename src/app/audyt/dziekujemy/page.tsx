import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ConfirmPayment from "./ConfirmPayment";

export const metadata: Metadata = {
  title: "Dziękujemy za zamówienie",
  robots: { index: false, follow: false },
};

export default async function ThankYouPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; session_id?: string }>;
}) {
  const { token, session_id: sessionId } = await searchParams;
  if (!token) redirect("/audyt");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-lg">
        <ConfirmPayment token={token} sessionId={sessionId ?? null} />
      </div>
    </div>
  );
}
