import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { parseInvoiceCSV } from "@/lib/csv-parser";
import { runAudit } from "@/lib/audit-engine";
import type { ApiResponse } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireAuth();
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json<ApiResponse>({ success: false, error: "No file provided" }, { status: 400 });
    }

    const content = await file.text();
    const rows = parseInvoiceCSV(content);

    if (rows.length === 0) {
      return NextResponse.json<ApiResponse>({ success: false, error: "No valid rows found in CSV" }, { status: 400 });
    }

    const created = await prisma.$transaction(
      rows.map((row) =>
        prisma.invoice.create({
          data: {
            invoiceNumber: row.invoiceNumber,
            vendorName: row.vendorName,
            amount: parseFloat(row.amount) || 0,
            issueDate: new Date(row.issueDate),
            dueDate: row.dueDate ? new Date(row.dueDate) : null,
            category: row.category || null,
            description: row.description || null,
            organizationId: orgId,
          },
        })
      )
    );

    const auditResult = await runAudit(orgId);

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        imported: created.length,
        duplicatesFound: auditResult.duplicates.length,
        anomaliesFound: auditResult.anomalies.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
