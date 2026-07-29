import type { Metadata } from "next";
import Link from "next/link";
import AuditForm from "./AuditForm";
import { TIERS, formatPln } from "@/lib/audit/config";
import type { AuditTier } from "@/types/audit";

export const metadata: Metadata = {
  title: "Audyt strony WWW w 2 minuty — lista poprawek i wycena wdrożenia",
  description:
    "Wklej adres strony. Sprawdzimy UX, SEO, teksty i szybkość, a potem dostaniesz konkretną listę poprawek z wyceną wdrożenia w PDF. Bez rozmowy, bez czekania na wolny termin.",
};

const STEPS = [
  {
    title: "Wklejasz adres",
    body: "Jedno pole. Nie musisz zakładać konta ani nic instalować na stronie.",
  },
  {
    title: "Silnik zbiera dowody",
    body: "Pobieramy stronę i podstrony, mierzymy szybkość w Lighthouse i przepuszczamy wszystko przez zestaw reguł UX, SEO i RODO.",
  },
  {
    title: "Dostajesz listę do zlecenia",
    body: "Każda poprawka ma cytat ze strony, instrukcję wdrożenia, czas w godzinach i cenę. Dajesz to wykonawcy i on wie, co robić.",
  },
];

const AREAS = [
  { name: "Konwersja", detail: "CTA, formularze, ścieżka do kontaktu, analityka" },
  { name: "UX", detail: "wersja mobilna, nawigacja, dostępność, czytelność" },
  { name: "SEO", detail: "tytuły, opisy, nagłówki, indeksowanie, dane strukturalne" },
  { name: "Treść", detail: "jasność oferty, struktura, nagłówek główny, Open Graph" },
  { name: "Zaufanie", detail: "RODO, polityka prywatności, dane firmy, opinie" },
  { name: "Szybkość", detail: "Core Web Vitals, LCP, CLS, czas odpowiedzi serwera" },
];

const FAQ = [
  {
    q: "Czy to nie jest po prostu raport z Lighthouse?",
    a: "Nie. Lighthouse to jeden z sześciu obszarów i mówi wyłącznie o technice. Reszta to analiza tego, co widzi klient: czy rozumie ofertę w 5 sekund, czy wie, gdzie kliknąć, czy ufa firmie. Lighthouse tego nie mierzy.",
  },
  {
    q: "Skąd wycena wdrożenia?",
    a: "Każda poprawka dostaje realistyczny czas w godzinach, przemnożony przez stawkę rynkową. To estymata, nie oferta wiążąca — ma Ci dać punkt odniesienia, zanim pójdziesz do wykonawcy, i uchronić przed fakturą oderwaną od zakresu.",
  },
  {
    q: "Co jeśli moja strona to sklep albo aplikacja w JavaScripcie?",
    a: "Sklepy analizujemy normalnie. Strony renderowane wyłącznie JavaScriptem widzimy tak, jak widzi je robot Google — i jeśli w kodzie nie ma treści, zgłaszamy to jako osobny, poważny problem, bo to realne ryzyko dla widoczności.",
  },
  {
    q: "Jak długo to trwa?",
    a: "Zwykle 1–3 minuty. Panel pokazuje postęp na żywo, a link do raportu przychodzi też na e-mail — możesz zamknąć kartę.",
  },
  {
    q: "Czy audytujecie cudze strony?",
    a: "Silnik pobiera wyłącznie treści dostępne publicznie, tak jak każda przeglądarka i każdy robot wyszukiwarki. Nie omijamy logowania ani zabezpieczeń.",
  },
];

function TierCard({ id, highlighted }: { id: AuditTier; highlighted?: boolean }) {
  const tier = TIERS[id];
  return (
    <div
      className={
        "flex flex-col rounded-2xl border bg-white p-7 " +
        (highlighted ? "border-indigo-600 shadow-lg ring-1 ring-indigo-600" : "border-slate-200 shadow-sm")
      }
    >
      {highlighted && (
        <span className="mb-3 self-start rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">
          Najczęściej wybierany
        </span>
      )}
      <h3 className="text-lg font-bold text-slate-900">{tier.label}</h3>
      <p className="mt-1 text-sm text-slate-500">{tier.tagline}</p>
      <p className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900">
        {tier.priceGrosz === 0 ? "0 zł" : formatPln(tier.priceGrosz)}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        {tier.priceGrosz === 0 ? "bez karty" : "jednorazowo, cena brutto"}
      </p>
      <ul className="mt-6 flex-1 space-y-2.5">
        {tier.features.map((feature) => (
          <li key={feature} className="flex gap-2.5 text-sm text-slate-600">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <a
        href="#start"
        className={
          "mt-7 rounded-lg px-5 py-2.5 text-center text-sm font-semibold transition " +
          (highlighted
            ? "bg-indigo-600 text-white hover:bg-indigo-700"
            : "border border-slate-300 text-slate-700 hover:bg-slate-50")
        }
      >
        {tier.priceGrosz === 0 ? "Zacznij za darmo" : `Wybierz ${tier.label}`}
      </a>
    </div>
  );
}

export default function AudytLanding() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/audyt" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <span className="text-lg font-bold text-slate-900">Audyt strony</span>
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <a href="#cennik" className="hidden font-medium text-slate-600 hover:text-slate-900 sm:block">Cennik</a>
            <a href="#faq" className="hidden font-medium text-slate-600 hover:text-slate-900 sm:block">Pytania</a>
            <a href="#start" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800">
              Sprawdź stronę
            </a>
          </div>
        </div>
      </nav>

      {/* Hero + formularz */}
      <section id="start" className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
          <div className="lg:pt-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              Wynik w około 2 minuty
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              Twoja strona traci klientów.
              <br />
              <span className="text-indigo-600">Powiemy Ci dokładnie gdzie.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-600">
              Wklej adres. Sprawdzimy UX, SEO, teksty i szybkość, a potem dostaniesz listę konkretnych poprawek —
              każda z dowodem ze strony, instrukcją wdrożenia i wyceną w złotówkach.
            </p>

            <dl className="mt-10 grid gap-6 sm:grid-cols-3">
              {[
                { value: "6", label: "obszarów oceny" },
                { value: "~30", label: "reguł automatycznych" },
                { value: "PDF", label: "gotowy dla wykonawcy" },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="text-3xl font-bold text-slate-900">{stat.value}</dt>
                  <dd className="mt-1 text-sm text-slate-500">{stat.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">Zacznij audyt</h2>
            <p className="mt-1 mb-6 text-sm text-slate-500">Bez konta i bez rozmowy handlowej.</p>
            <AuditForm />
          </div>
        </div>
      </section>

      {/* Jak to działa */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">Jak to działa</h2>
        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.title}>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-base font-bold text-white">
                {index + 1}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-slate-600">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Co sprawdzamy */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">Sześć obszarów, jedna ocena</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
            Każdy obszar dostaje wynik 0–100 i własny komentarz. Ocena ogólna jest ważona — najwięcej znaczy to, co
            faktycznie przekłada się na klientów.
          </p>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map((area) => (
              <div key={area.name} className="rounded-xl border border-slate-200 bg-white p-6">
                <h3 className="font-semibold text-slate-900">{area.name}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{area.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cennik */}
      <section id="cennik" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">Cennik</h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
          Płacisz raz, za konkretny raport. Żadnych abonamentów i żadnego „skontaktujemy się z Tobą".
        </p>
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          <TierCard id="free" />
          <TierCard id="basic" highlighted />
          <TierCard id="pro" />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">Najczęstsze pytania</h2>
          <dl className="mt-12 space-y-8">
            {FAQ.map((item) => (
              <div key={item.q}>
                <dt className="font-semibold text-slate-900">{item.q}</dt>
                <dd className="mt-2 leading-relaxed text-slate-600">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="bg-slate-900">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-3xl font-bold text-white">Sprawdź, co widzi Twój klient</h2>
          <p className="mt-4 text-slate-300">Darmowy skan pokazuje trzy największe problemy. Bez karty, bez rozmowy.</p>
          <a
            href="#start"
            className="mt-8 inline-block rounded-lg bg-white px-8 py-3 text-base font-semibold text-slate-900 hover:bg-slate-100"
          >
            Uruchom darmowy skan
          </a>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row">
          <span>&copy; {new Date().getFullYear()} Audyt strony WWW</span>
          <span>Wycena wdrożenia jest szacunkiem, nie ofertą w rozumieniu Kodeksu cywilnego.</span>
        </div>
      </footer>
    </div>
  );
}
