# Phase 14: Stripe Payments

Implemented a Stripe-first invoice payment integration for Joseph's single-company construction app.

## Scope

- Added the official `stripe` Node SDK pinned at `22.4.0`.
- Added environment-only Stripe configuration; no in-app Stripe setup wizard or SaaS onboarding screen.
- Added a public invoice Checkout endpoint used only by the frontend's
  server-side redirect handler:
  - `POST /public/invoices/:token/checkout`
- Added authenticated admin payment endpoints:
  - `GET /payments`
  - `GET /payments/:id`
  - `GET /payments/events`
- Added Stripe webhook endpoint:
  - `POST /payments/stripe/webhook`

## Payment Flow

- Joseph sends an invoice using the existing invoice email/PDF flow.
- The email payment action creates an idempotent Checkout Session and redirects
  directly to Stripe-hosted Checkout without an intermediate app payment page.
- Stripe dynamically presents the payment methods enabled and eligible for the
  invoice. The app does not duplicate payment-method configuration.
- Stripe webhooks update the app's payment record and invoice ledger.
- ACH remains `processing` until Stripe confirms success through webhook events.

## Data Model

- Extended `Payment` with Stripe checkout, PaymentIntent, charge, status, receipt, and failure fields.
- Extended `PaymentLedgerEntry` with dispute hold/reversal entry types.
- Added `PaymentCustomerProfile` to map local clients to Stripe customers.
- Added `StripeEventInbox` for durable event idempotency and retry safety.
- Added `PaymentRealtimeNotification` for admin payment notifications.

## Configuration

Required when `ONLINE_INVOICE_PAYMENTS_ENABLED=true`:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PUBLIC_APP_BASE_URL` or `FRONTEND_ORIGIN`

Recommended defaults:

- Enable accepted payment methods in the Stripe Dashboard. Checkout dynamically
  displays methods eligible for the invoice currency, amount, and customer.

## Notes

- Invoice records and the internal ledger remain the source of truth.
- Stripe Payment Links, Connect, PayPal, and surcharge logic were intentionally excluded from Release 1.
- Webhook processing is idempotent by Stripe event ID and ledger idempotency keys.
