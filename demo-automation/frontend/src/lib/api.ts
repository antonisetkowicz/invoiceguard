export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8000";

export interface Lead {
  id: number;
  name: string;
  email: string;
  company: string | null;
  message: string | null;
  status: string;
  created_at: string;
  ai_response: string | null;
  qualified_score: number | null;
}

export interface LeadFormInput {
  name: string;
  email: string;
  company: string;
  message: string;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data?.detail ?? `Błąd żądania (${response.status})`;
  } catch {
    return `Błąd żądania (${response.status})`;
  }
}

export async function fetchLeads(): Promise<Lead[]> {
  const response = await fetch(`${API_BASE_URL}/leads`);
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
  return response.json();
}

export async function submitLead(payload: LeadFormInput): Promise<Lead> {
  const response = await fetch(`${API_BASE_URL}/webhook/lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      email: payload.email,
      company: payload.company || null,
      message: payload.message,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const data = await response.json();
  return data.lead as Lead;
}
