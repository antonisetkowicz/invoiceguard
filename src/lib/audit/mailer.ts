import { baseUrl } from "./config";

/**
 * E-mail jest opcjonalny. Bez RESEND_API_KEY produkt nadal działa —
 * link do raportu jest pokazany na ekranie i zapisany w bazie.
 */
export function mailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.AUDIT_FROM_EMAIL);
}

async function send(to: string, subject: string, html: string): Promise<boolean> {
  if (!mailerConfigured()) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: process.env.AUDIT_FROM_EMAIL, to, subject, html }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const WRAPPER = (body: string) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#111827;line-height:1.6">
  ${body}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0" />
  <p style="font-size:12px;color:#6b7280">
    Ten e-mail dotyczy audytu, który zamówiłeś/aś samodzielnie na naszej stronie.
    Link do raportu jest prywatny — nie udostępniaj go osobom postronnym.
  </p>
</div>`;

export async function sendReportReady(params: {
  email: string;
  token: string;
  url: string;
  overall: number;
  criticalCount: number;
}): Promise<boolean> {
  const link = `${baseUrl()}/audyt/raport/${params.token}`;
  return send(
    params.email,
    `Raport z audytu ${params.url} jest gotowy`,
    WRAPPER(`
      <h2 style="margin:0 0 16px">Twój audyt jest gotowy</h2>
      <p>Przeanalizowaliśmy <strong>${params.url}</strong>.</p>
      <p style="font-size:15px">
        Wynik ogólny: <strong>${params.overall}/100</strong><br />
        Problemów krytycznych: <strong>${params.criticalCount}</strong>
      </p>
      <p style="margin:28px 0">
        <a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          Otwórz raport
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280">Gdyby przycisk nie działał: ${link}</p>
    `)
  );
}

export async function sendAuditFailed(params: { email: string; token: string; url: string; reason: string }): Promise<boolean> {
  return send(
    params.email,
    `Nie udało się przeprowadzić audytu ${params.url}`,
    WRAPPER(`
      <h2 style="margin:0 0 16px">Audyt się nie powiódł</h2>
      <p>Próbowaliśmy przeanalizować <strong>${params.url}</strong>, ale silnik nie dał rady.</p>
      <p style="background:#fef2f2;border-left:3px solid #dc2626;padding:12px 16px;font-size:14px">${params.reason}</p>
      <p>Najczęstsze przyczyny: strona blokuje roboty, wymaga logowania albo była chwilowo niedostępna.</p>
      <p style="font-size:13px;color:#6b7280">Status zamówienia: ${baseUrl()}/audyt/raport/${params.token}</p>
    `)
  );
}
