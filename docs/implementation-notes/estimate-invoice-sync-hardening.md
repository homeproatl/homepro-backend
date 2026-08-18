# Estimate And Invoice Sync Hardening

- Estimates and invoices are separate documents linked one-to-one by
  `invoice.source_estimate_id`.
- Conversion accepts Pending or Approved estimates, leaves the estimate
  Approved, and returns the existing invoice on retries.
- Invoice due dates use the Company document default unless explicitly
  supplied.
- Converted photos, attachments, and line photos are cloned into independent
  invoice-owned asset records and storage objects.
- Payment ledger recomputation advances the invoice optimistic-lock version
  whenever paid, refunded, disputed, or balance totals change.
- Stripe payment, refund, and dispute events email the address saved at
  Settings > Company through the existing Resend configuration. No in-app
  notification model is used.
- Public invoices poll while a balance remains due; invoice lists poll every
  15 seconds and the dashboard every 30 seconds so webhook changes appear in
  open browser sessions.

Before release against a development database that previously used the removed
`invoiced` estimate status, run:

```bash
npm run migrate:estimate-status
```
