import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2, Send, Wand2 } from "lucide-react";
import type { LeadFormInput } from "../lib/api";

interface LeadFormProps {
  onSubmit: (input: LeadFormInput) => Promise<void>;
}

const DEMO_PRESETS: LeadFormInput[] = [
  {
    name: "Marta Wiśniewska",
    email: "marta.wisniewska@fintechpro.pl",
    company: "FinTechPro",
    message:
      "Pilnie szukamy rozwiązania do automatycznej kwalifikacji leadów, mamy budżet na wdrożenie w tym kwartale.",
  },
  {
    name: "Tomasz Zieliński",
    email: "t.zielinski@budowlanka.example",
    company: "Budowlanka Sp. z o.o.",
    message: "Zbieramy tylko informacje, na razie się rozglądamy, może za pół roku.",
  },
];

const emptyForm: LeadFormInput = { name: "", email: "", company: "", message: "" };

export function LeadForm({ onSubmit }: LeadFormProps) {
  const [form, setForm] = useState<LeadFormInput>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof LeadFormInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(form);
      setForm(emptyForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się wysłać leada");
    } finally {
      setSubmitting(false);
    }
  };

  const fillPreset = () => {
    const preset = DEMO_PRESETS[Math.floor(Math.random() * DEMO_PRESETS.length)];
    setForm(preset);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="sticky top-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl"
    >
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Symuluj nowego leada</h2>
          <p className="text-xs text-white/40">Wyślij testowe zgłoszenie do backendu AI</p>
        </div>
        <button
          type="button"
          onClick={fillPreset}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Wand2 size={13} />
          Wypełnij przykładem
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Imię i nazwisko">
            <input
              required
              value={form.name}
              onChange={update("name")}
              placeholder="Jan Kowalski"
              className="input"
            />
          </Field>
          <Field label="Firma">
            <input
              value={form.company}
              onChange={update("company")}
              placeholder="Acme Sp. z o.o."
              className="input"
            />
          </Field>
        </div>

        <Field label="Email">
          <input
            required
            type="email"
            value={form.email}
            onChange={update("email")}
            placeholder="jan@acme.pl"
            className="input"
          />
        </Field>

        <Field label="Wiadomość">
          <textarea
            required
            rows={4}
            value={form.message}
            onChange={update("message")}
            placeholder="Opisz czego potrzebuje klient..."
            className="input resize-none"
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300 ring-1 ring-inset ring-red-500/30">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Wysyłanie do AI…
            </>
          ) : (
            <>
              <Send size={16} />
              Wyślij leada
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-white/50">{label}</span>
      {children}
    </label>
  );
}
