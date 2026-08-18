# Joist Migration Rehearsal - 2026-08-12

## Scope

This rehearsal parsed the supplied Joist CSV exports without connecting to MongoDB and without writing application data. The machine-readable result is in `joist-dry-run-2026-08-12.json`.

Source files:

- `/Users/user/Desktop/Clients.csv`
- `/Users/user/Desktop/Items.csv`
- `/Users/user/Desktop/estimate.csv`
- `/Users/user/Desktop/invoice.csv`
- `/Users/user/Downloads/newinvoice.csv`

## Result

| Entity | Rows | Ready | Needs review | Invalid |
| --- | ---: | ---: | ---: | ---: |
| Clients | 427 | 427 | 0 | 0 |
| Items | 308 | 308 | 0 | 0 |
| Estimates | 7 | 0 | 7 | 0 |
| `invoice.csv` | 0 | 0 | 0 | 0 |
| `newinvoice.csv` | 8 | 0 | 8 | 0 |
| **Total** | **750** | **735** | **15** | **0** |

No rows were promoted because this was a dry run.

## Blocking Findings

1. The estimate and invoice exports are summary exports. They do not contain line items, line-level taxes, photos, attachments, signatures, private notes, payment history, or reliable source document IDs. They must remain read-only migration summaries until detailed records are recovered.
2. Client names are not unique. The client export has 79 duplicate normalized-name groups covering 179 rows. Three estimates and six invoices therefore have ambiguous client matches. Never link these records by name alone.
3. Item names are not unique. The item export has 39 duplicate normalized-name groups covering 111 rows. Preserve every Joist row and source identity; do not merge items by name.
4. Several document totals differ from `subtotal + named taxes` by 2,776, 5,368, 7,111, or 9,079 cents. These likely represent adjustments not exposed by the summary CSV. Preserve Joist's exported total as authoritative and do not invent line allocations.
5. `/Users/user/Desktop/invoice.csv` contains only a header. It must not be treated as a complete invoice export. The eight usable invoice summaries are in `newinvoice.csv`.

## Row-Level Review

- Client source ID `34383408` (`Ms Denise`) has an invalid mobile value and needs manual contact review.
- Item source ID `50910182` (`Complete Home Renovation`) has a source price of `105.852`; the normalized customer rate is rounded to 10,585 cents while the exact source decimal is retained.
- Item source ID `37172438` (`Kitchen remodel`) has a source price of `25.814`; the normalized customer rate is rounded to 2,581 cents while the exact source decimal is retained.
- All 15 document summaries need review because detailed line data is absent.

## Tax Safety

The Joist item CSV contains only `Name`, `Price`, `Notes`, and `ID`; it does not export item tax selections. Imported item templates therefore use `taxable_default: false` with `tax_configuration_state: not_exported`. Taxability must be recovered from detailed Joist data or explicitly configured after import. This avoids silently taxing previously non-taxable work.

Document summary tax columns are retained as source evidence. They are not sufficient to reconstruct line-level tax selections or recalculate historical totals.

## Safe Promotion Plan

1. Back up the target database and create a dedicated import batch ID.
2. Apply the staging import only. Review the generated queue before promotion.
3. Promote clients and items by stable Joist source identity, never by display name.
4. Resolve the invalid client phone and duplicate-name client matches using phone, email, address, and Joist record identity.
5. Keep estimate and invoice summaries read-only until detailed Joist records are recovered through an authorized API/export workflow or verified document extraction.
6. Recover and validate photos, attachments, signatures, payments, line items, per-line taxes, markups, discounts, deposits, and status history before document promotion.
7. Reconcile record counts and monetary totals against Joist, then smoke-test PDF rendering, email attachments, payment links, and client history.
8. Only after reconciliation, enable the new app as the operational source of truth. Retain the original exports and migration report for audit.

## Repeatable Dry Run

```bash
npm run import:joist -- --dry-run \
  --file=/Users/user/Desktop/Clients.csv \
  --file=/Users/user/Desktop/Items.csv \
  --file=/Users/user/Desktop/estimate.csv \
  --file=/Users/user/Desktop/invoice.csv \
  --file=/Users/user/Downloads/newinvoice.csv \
  --batch-id=joist-rehearsal-2026-08-12 \
  --report-file=/Users/user/Projects/Contractor/Backend/docs/migration/joist-dry-run-2026-08-12.json
```

Dry-run mode intentionally needs neither `MONGO_URI` nor an organization ID. Database connection and `--organization-id` are required only with `--apply`.
