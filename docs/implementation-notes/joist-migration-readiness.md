# Joist Migration Readiness

## Safety model

- Joist Client IDs and Item IDs are the identity keys. Duplicate names, emails,
  phones, addresses, and item names are retained and are never merged by label.
- Every raw CSV row is retained in `joist_import_rows` with its source file hash,
  row number, raw values, normalized values, warnings, and resolution state.
- Estimate and invoice CSV exports are staged as `legacy_summary` records. They
  are not inserted into editable documents because Joist's accounting exports do
  not include line items or stable client/document IDs.
- Summary totals remain authoritative. Named tax columns and any unexplained
  adjustment are stored separately for reconciliation.
- Catalog prices are stored in cents for app calculations and the exact source
  decimal is retained in `source_rate_decimal` when Joist provides sub-cent data.

## Commands

Dry-run all supplied exports without writing:

```bash
npm run import:joist -- \
  --organization-id=<organization-object-id> \
  --batch-id=joist-initial \
  --file=/absolute/path/Clients.csv \
  --file=/absolute/path/Items.csv \
  --file=/absolute/path/estimate.csv \
  --file=/absolute/path/invoice.csv
```

Persist the review queue and safely upsert only Clients and Items:

```bash
npm run import:joist -- \
  --organization-id=<organization-object-id> \
  --batch-id=joist-initial \
  --source-account-id=<joist-account-id-if-known> \
  --file=/absolute/path/Clients.csv \
  --file=/absolute/path/Items.csv \
  --file=/absolute/path/estimate.csv \
  --file=/absolute/path/invoice.csv \
  --apply \
  --promote-catalog
```

Rerunning the same files is idempotent. Existing source-identified records are
updated instead of duplicated. Do not promote summary documents until detailed
line items, attachments, and unambiguous client IDs have been recovered.

## Remaining source acquisition

- Export every estimate/invoice month and retain original filenames.
- Download original PDFs, photos, and attachments from Joist; CSV exports do not
  contain those assets. Upload binaries to Cloudflare R2 and preserve Joist IDs
  in asset `source_metadata`.
- Resolve staged document rows with zero or multiple client candidates manually.
- Do not infer estimate-to-invoice relationships from client name or total.
