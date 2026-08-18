# Phase 07 — Documents Backend Foundation

## Scope

Shared NestJS document aggregate for estimates and invoices under `src/documents`, plus a thin `src/invoices` facade. Legacy float estimate APIs (`EstimatesModule`) remain unchanged for FE compatibility.

## Guarantees

- Money persisted as integer USD cents (`*_minor`); rates as basis points; quantities as milli-units.
- Server-side calculators are authoritative; write DTOs reject client-supplied totals.
- Optimistic concurrency via integer `version` → `409` `{ code: 'STALE_VERSION' }`.
- Status transitions are typed and restricted; archived restore uses `archived_from_status`.
- Freeze on estimate `draft→pending` and invoice `draft→issued` (`frozen_revision_number`, `frozen_hash`).
- `vehicle_id` is never required on documents.
- Tax rates and contract templates are org-scoped active read catalogs with seed defaults.

## Commands

```bash
npm test -- --testPathPatterns='document-calculators|documents|invoices' --runInBand
npm run typecheck
npm run migrate:estimates-to-documents          # dry-run
npm run migrate:estimates-to-documents -- --apply
npm run seed:document-defaults
```
