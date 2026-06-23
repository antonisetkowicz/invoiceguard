import { parse } from "csv-parse/sync";
import type { InvoiceUploadRow } from "@/types";

export function parseInvoiceCSV(content: string): InvoiceUploadRow[] {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return records.map((row: Record<string, string>) => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = value;
    }

    return {
      invoiceNumber: normalized["invoicenumber"] || normalized["invoiceno"] || normalized["number"] || normalized["inv"] || "",
      vendorName: normalized["vendorname"] || normalized["vendor"] || normalized["supplier"] || normalized["company"] || "",
      amount: normalized["amount"] || normalized["total"] || normalized["invoiceamount"] || "0",
      issueDate: normalized["issuedate"] || normalized["date"] || normalized["invoicedate"] || "",
      dueDate: normalized["duedate"] || normalized["paymentdue"] || undefined,
      category: normalized["category"] || normalized["type"] || undefined,
      description: normalized["description"] || normalized["memo"] || normalized["notes"] || undefined,
    };
  });
}
