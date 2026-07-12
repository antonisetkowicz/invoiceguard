# Lead Qualification AI — Dashboard

Dashboard React (Vite + Tailwind CSS v4) do prezentacji demo workflow "lead
qualification + auto-response" na callach sprzedażowych. Patrz też główny
[`../README.md`](../README.md) dla pełnego opisu środowiska demo.

## Uruchomienie

```bash
cp .env.example .env
npm install
npm run dev
```

Aplikacja wystartuje pod `http://localhost:5173`. Ustaw `VITE_API_BASE_URL`
w `.env`, jeśli backend FastAPI działa pod innym adresem niż
`http://localhost:8000`.

## Struktura

- `src/App.tsx` — layout, polling `GET /leads` co 3s, obliczanie metryk
- `src/components/LeadForm.tsx` — formularz "Symuluj nowego leada"
- `src/components/LeadCard.tsx` — karta leada z animacją, badge'em i
  rozwijanym panelem odpowiedzi AI
- `src/components/MetricsBar.tsx` — licznik metryk u góry dashboardu
- `src/lib/api.ts` — klient HTTP do backendu FastAPI
