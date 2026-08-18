# Phase 11 — Invoices Backend Module

## Scope

First-class invoice facade over the shared documents aggregate (`src/invoices`), estimate→invoice conversion, manual payment ledger, issue/send/void/grants, and DB-backed auto-conversion jobs. No Stripe; public pay checkout is Step 14. Frontend Generate Invoice UI is Step 12.

## Guarantees

- Money as integer USD cents; ledger is authoritative for `amount_paid_minor`, `amount_refunded_minor`, `amount_disputed_minor` (0 until Stripe disputes), and `balance_due_minor`.
- Manual payments reject overpayment beyond `balance_due_minor` (including paid invoices with balance 0). Void invoices reject all ledger writes (payment/refund/adjustment).
- Manual payment/refund/adjustment require client `idempotency_key`; balance checks run inside the Mongo transaction.
- Conversion is idempotent via `uniq_invoice_source_estimate` + duplicate-key recovery; concurrent losers return the existing invoice.
- Invoice send claims outbox first, then installs the matching grant; retries recover missing grants from the encrypted outbox token. Step 11 grants are `view|download` only (`pay` in Step 14).
- After conversion, materials purchase status is owned by the invoice (`PATCH /invoices/:id/line-purchase-status`); estimate updates return `PURCHASE_STATUS_OWNED_BY_INVOICE`.
- `auto_generate_invoice_enabled` enqueues a uniquely keyed `DocumentAutomationJob` after approval; worker uses atomic lease claim; failed jobs are listed/retried via estimate automation routes.

## API surface

- `GET|POST /invoices`, `GET|PATCH /invoices/:id`, status/restore
- `GET .../preview|pdf|latest|history|payments`
- `POST .../issue|send|void|duplicate|access-grants|access-grants/rotate`
- `POST .../manual-payments|manual-refunds|manual-adjustments`
- `PATCH .../line-purchase-status`
- `POST /estimates/:id/convert-to-invoice`
- `GET /estimates/:id/automation-jobs`, `POST /estimates/:id/automation-jobs/:jobId/retry`

## Commands

```bash
npm test -- --testPathPatterns='invoices|estimate-conversion|invoice-payment|document-email-outbox|document-estimates' --runInBand
npm run typecheck
```

## Explicit non-goals

- Stripe Checkout / webhooks / disputes
- Frontend invoice UI / public `/view/invoice/:token` page (Steps 12–14)
- Adding `pay` to public grants before Step 14
