import { NextRequest, NextResponse } from "next/server";
import type { ApiResponse } from "@/types";
import { renderReportPdf } from "@/lib/audit/pdf";
import { buildReport } from "@/lib/audit/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const report = await buildReport(token);
  if (!report) {
    return NextResponse.json<ApiResponse>({ success: false, error: "Nie znaleziono raportu." }, { status: 404 });
  }
  if (!report.capabilities.pdf) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: "PDF jest dostępny w pakiecie Audyt i Audyt Pro." },
      { status: 402 }
    );
  }
  if (report.run?.status !== "done") {
    return NextResponse.json<ApiResponse>({ success: false, error: "Raport nie jest jeszcze gotowy." }, { status: 409 });
  }

  const pdf = await renderReportPdf(report);
  const slug = report.siteUrl.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]/gi, "-").replace(/^-+|-+$/g, "");

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="audyt-${slug || "strony"}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
