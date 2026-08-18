# Phase 13 — Simple Business Settings

## Scope

Keep the settings surface focused on Joseph's one construction company. The backend preserves the existing `AppSettings` shape and Step 7 tax/contract collections for document workflows, but the visible app exposes only Account, Company, and Defaults. No Payments settings route, Stripe setup, tax catalog, contract catalog, preferences, staff management, SaaS billing, or copied Joist administration screens are part of Release 1.

## Guarantees

- Existing orgs with only `business_timezone` load with nested defaults.
- `GET/PATCH /settings/app` remains the single settings read/update endpoint.
- ADMIN: full GET + PATCH for the simple settings surface. TECHNICIAN: safe GET projection only.
- Serializers never include Stripe keys, webhook secrets, or provider readiness.
- Document numbering stays automatic and internal; prefixes/next counters are not visible settings.
- Tax/contract records remain available to estimate/invoice editors and sent-document snapshots, but management screens are not exposed in Settings.
- New drafts apply Defaults values for expiration, due dates, deposit percentage, payment terms, and send-email messages.
- Settings management UI (nav + routes) is ADMIN-only; TECHNICIAN still receives safe GET projections for document screens.
- Sent/issued documents keep snapshots; refresh remains draft-only via `refresh_snapshots` / client change.
- Company settings expose customer-facing business identity only; no verification, tax-ID, insurance, logo upload, or provider setup controls.

## API surface

| Method | Path | Roles | Notes |
|--------|------|-------|-------|
| GET | `/settings/app` | ADMIN, TECH | TECH gets projected payload |
| PATCH | `/settings/app` | ADMIN | Visible `account`, `company`, and compact `documents` defaults only |
| GET | `/tax-rates` | ADMIN, TECH | Workflow support for editors only; no settings screen |
| GET | `/contract-templates` | ADMIN, TECH | Workflow support for editors only; no settings screen |

## Frontend routes

- `/dashboard/settings` → redirect to `/dashboard/settings/company`
- `/dashboard/settings/account`
- `/dashboard/settings/company`
- `/dashboard/settings/documents` labeled as `Defaults`
- Legacy `/dashboard/settings/{taxes,contracts,preferences}` → redirect to `/dashboard/settings/documents`
- Legacy `/dashboard/settings/users` → redirect to `/dashboard/settings/account`
- Admin shell Settings href → `/dashboard/settings/company`

## Commands

```bash
# Backend
npm run typecheck
npm test -- --testPathPatterns='settings.service|document-numbers|tax-rates.service|contract-templates.service|documents.service' --runInBand

# Frontend
npm run typecheck
npm test -- src/components/settings src/components/dashboard/admin-shell.test.tsx
```
