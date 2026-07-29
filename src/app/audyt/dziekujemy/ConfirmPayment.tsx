"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Webhook Stripe potrafi się spóźnić o kilka sekund, a klient już patrzy na
 * ekran. Ta strona dopytuje nasz backend (który pyta Stripe wprost) i dopiero
 * potem przenosi do raportu. Operacja jest idempotentna.
 */
export default function ConfirmPayment({ token, sessionId }: { token: string; sessionId: string | null }) {
  const [message, setMessage] = useState("Potwierdzam płatność…");
  const [failed, setFailed] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    const reportUrl = `/audyt/raport/${token}`;

    if (!sessionId) {
      window.location.replace(reportUrl);
      return;
    }

    let cancelled = false;

    async function confirm() {
      attempts.current += 1;
      try {
        const response = await fetch("/api/audit/checkout/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, sessionId }),
        });
        const payload = await response.json();
        if (cancelled) return;

        if (payload.success && payload.data?.paid) {
          setMessage("Płatność potwierdzona. Otwieram raport…");
          window.location.replace(reportUrl);
          return;
        }

        // BLIK i Przelewy24 potwierdzają się asynchronicznie — dajemy im chwilę.
        if (attempts.current < 8) {
          setMessage("Czekam na potwierdzenie z banku…");
          setTimeout(confirm, 2500);
          return;
        }

        setFailed(true);
        setMessage(
          "Nie dostaliśmy jeszcze potwierdzenia płatności. Jeśli bank ją pobrał, audyt ruszy automatycznie w ciągu kilku minut."
        );
      } catch {
        if (cancelled) return;
        if (attempts.current < 8) {
          setTimeout(confirm, 2500);
          return;
        }
        setFailed(true);
        setMessage("Brak połączenia z serwerem. Otwórz raport za chwilę — link masz też w e-mailu.");
      }
    }

    void confirm();
    return () => {
      cancelled = true;
    };
  }, [token, sessionId]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      {!failed && (
        <div className="mx-auto mb-5 h-9 w-9 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      )}
      <h1 className="text-xl font-bold text-slate-900">Dziękujemy za zamówienie</h1>
      <p className="mx-auto mt-3 max-w-md leading-relaxed text-slate-600">{message}</p>
      <a
        href={`/audyt/raport/${token}`}
        className="mt-7 inline-block rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800"
      >
        Przejdź do raportu
      </a>
    </div>
  );
}
