# InvoiceGuard – Automated Invoice Fraud Detection & Approval Pipeline

Portfolio n8n workflow built around the InvoiceGuard product: it takes an
inbound invoice, extracts and validates its data with AI, reuses InvoiceGuard's
duplicate/anomaly detection logic, computes a fraud risk score, and routes the
invoice through the right approval path — with a full audit trail, a daily
executive digest, and dedicated error handling.

## Import

1. Open n8n → **Workflows → Import from File**.
2. Select `invoiceguard-fraud-detection-pipeline.json`.
3. Configure credentials referenced in the nodes (Slack, OpenAI, Postgres,
   SMTP, the InvoiceGuard API bearer token, and the accounting provider
   OAuth2). All endpoint URLs and credential names are illustrative
   placeholders for demonstration purposes.

## Pipeline overview

| Stage | What happens |
|---|---|
| 1. Intake & Normalization | `Webhook` receives the invoice payload, optionally downloads the attached file, and normalizes fields into a common schema. |
| 2. AI Extraction & Validation | GPT-4o extracts structured invoice data from the document, reconciles it with the submitted metadata, and runs schema validation. Invalid invoices are rejected early with a Slack notice. |
| 3. Duplicate & Anomaly Detection | Re-implements the app's `audit-engine.ts` heuristics — vendor-name similarity + amount + date-window duplicate matching, and per-vendor z-score outlier detection. |
| 4. Fraud Risk Scoring | Combines duplicate score, anomaly score, round-amount, weekend issue-date, missing PO, new-vendor and line-item-mismatch signals into a single 0–100 risk score. |
| 5. Routing | **Critical (≥80):** real-time Slack alert to Finance & Security and a blocking human approve/reject step before anything is paid. **Medium (40–79):** flagged and dropped into the AP review queue. **Low (<40):** auto-approved and synced to the accounting system. |
| 6. Audit Trail | All branches converge and every decision is logged to Postgres for compliance/reporting. |
| 7. Executive Digest | A separate `Schedule Trigger` runs every weekday at 08:00, pulls live dashboard metrics and open alerts, and emails/Slacks a summary. |
| 8. Error Handling | An `Error Trigger` branch catches failures anywhere in the workflow and pages the on-call channel with context. |

51 nodes total, including 11 sticky notes used as inline documentation for
each stage of the pipeline.
