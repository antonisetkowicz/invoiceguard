import { NextRequest, NextResponse } from "next/server";
import type { ApiResponse } from "@/types";
import { buildReport } from "@/lib/audit/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const report = await buildReport(token);
  if (!report) {
    return NextResponse.json<ApiResponse>({ success: false, error: "Nie znaleziono raportu o tym adresie." }, { status: 404 });
  }

  return NextResponse.json<ApiResponse>(
    { success: true, data: report },
    { headers: { "cache-control": "no-store" } }
  );
}
