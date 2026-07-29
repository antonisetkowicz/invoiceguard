"use client";

import { useState } from "react";
import { TIERS, formatPln } from "@/lib/audit/config";
import type { AuditTier } from "@/types/audit";

const TIER_LIST: AuditTier[] = ["free", "basic", "pro"];

export default function AuditForm({ defaultTier = "free" }: { defaultTier?: AuditTier }) {
  const [tier, setTier] = useState<AuditTier>(defaultTier);
  const [showDetails, setShowDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/audit/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: String(form.get("url") ?? ""),
          email: String(form.get("email") ?? ""),
          tier,
          companyName: String(form.get("companyName") ?? "") || null,
          goal: String(form.get("goal") ?? "") || null,
          consentTerms: form.get("consentTerms") === "on",
          consentMarketing: form.get("consentMarketing") === "on",
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Coś poszło nie tak. Spróbuj ponownie.");
        setSubmitting(false);
        return;
      }
      window.location.href = payload.data.redirectTo;
    } catch {
      setError("Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.");
      setSubmitting(false);
    }
  }

  const selected = TIERS[tier];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="url" className="block text-sm font-medium text-slate-700">
          Adres Twojej strony
        </label>
        <input
          id="url"
          name="url"
          required
          placeholder="twojafirma.pl"
          autoComplete="url"
          inputMode="url"
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          E-mail, na który wyślemy raport
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="jan@twojafirma.pl"
          autoComplete="email"
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Wybierz pakiet</legend>
        <div className="mt-2 space-y-2">
          {TIER_LIST.map((id) => {
            const definition = TIERS[id];
            const active = tier === id;
            return (
              <label
                key={id}
                className={
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition " +
                  (active
                    ? "border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50")
                }
              >
                <input
                  type="radio"
                  name="tier"
                  value={id}
                  checked={active}
                  onChange={() => setTier(id)}
                  className="mt-1 h-4 w-4 accent-indigo-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-900">{definition.label}</span>
                    <span className={"text-sm font-bold " + (active ? "text-indigo-700" : "text-slate-600")}>
                      {definition.priceGrosz === 0 ? "0 zł" : formatPln(definition.priceGrosz)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-slate-500">{definition.tagline}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={() => setShowDetails((value) => !value)}
        className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
      >
        {showDetails ? "− Ukryj pola dodatkowe" : "+ Dodaj kontekst (lepszy raport, opcjonalne)"}
      </button>

      {showDetails && (
        <div className="space-y-4 rounded-lg bg-slate-50 p-4">
          <div>
            <label htmlFor="companyName" className="block text-sm font-medium text-slate-700">
              Nazwa firmy
            </label>
            <input
              id="companyName"
              name="companyName"
              maxLength={160}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="goal" className="block text-sm font-medium text-slate-700">
              Co ta strona ma osiągać?
            </label>
            <textarea
              id="goal"
              name="goal"
              rows={2}
              maxLength={500}
              placeholder="np. telefony od klientów na remonty łazienek w Krakowie"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              Bez tego ocenimy stronę po tym, co z niej wynika. Z tym — po tym, czego naprawdę chcesz.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        <label className="flex items-start gap-2.5 text-sm text-slate-600">
          <input type="checkbox" name="consentTerms" required className="mt-0.5 h-4 w-4 accent-indigo-600" />
          <span>
            Akceptuję regulamin i politykę prywatności. Zgadzam się na automatyczne pobranie publicznie dostępnej
            treści wskazanej strony w celu wykonania audytu. <span className="text-red-500">*</span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm text-slate-600">
          <input type="checkbox" name="consentMarketing" className="mt-0.5 h-4 w-4 accent-indigo-600" />
          <span>Chcę dostawać wskazówki o poprawianiu stron. Możesz wypisać się jednym kliknięciem.</span>
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-indigo-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting
          ? "Przygotowuję…"
          : selected.priceGrosz === 0
            ? "Uruchom darmowy skan"
            : `Zamawiam — ${formatPln(selected.priceGrosz)}`}
      </button>

      <p className="text-center text-xs text-slate-500">
        {selected.priceGrosz === 0
          ? "Bez karty. Wynik na ekranie w około 2 minuty."
          : "Płatność BLIK, Przelewy24 lub karta. Raport od razu po opłaceniu."}
      </p>
    </form>
  );
}
