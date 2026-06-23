export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: { total: number; page: number; limit: number };
}

export interface DashboardStats {
  totalInvoices: number;
  totalSpend: number;
  openAlerts: number;
  totalSavings: number;
  monthlySpend: { month: string; amount: number }[];
  alertsByType: { type: string; count: number }[];
  topVendors: { vendor: string; amount: number; invoiceCount: number }[];
}

export interface InvoiceUploadRow {
  invoiceNumber: string;
  vendorName: string;
  amount: string;
  issueDate: string;
  dueDate?: string;
  category?: string;
  description?: string;
}

export interface AuditResult {
  duplicates: { invoiceId: string; matchedInvoiceId: string; similarity: number; amountAtRisk: number }[];
  anomalies: { invoiceId: string; reason: string; severity: string; amountAtRisk: number }[];
}
