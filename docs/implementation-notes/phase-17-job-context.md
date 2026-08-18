# Phase 17: Job Context Completion Without A Projects Module

Step 17 keeps Joseph's Release 1 workflow lightweight: documents carry job context directly, and no Projects module is introduced.

## Current Contract

- `job_name` is optional text on each estimate/invoice document.
- `service_address_snapshot` is copied onto each estimate/invoice from either a saved client service address or a one-off address typed into the editor.
- `project_id` remains reserved and server-owned. New document creates set it to `null`; no frontend screen exposes a project picker, project navigation item, or project-management workflow.
- Client address edits must not mutate historical document snapshots. Existing documents keep the address that was saved on the document.

## Completed Alignment

- The shared estimate/invoice editor now shows a saved service-address picker when the selected client has service addresses, while preserving manual one-off address entry.
- Create flows with a prefilled client now apply the first saved service address only when the form has no address and only in create mode.
- Generic document search, estimate search, and invoice search include job name plus snapshotted/fallback service address fields.
- Dashboard and reports material rows include client, job name, document number, and service-address summary so materials can be understood by job location without requiring a Project entity.
- Estimate and invoice form payload tests assert that `project_id` is not sent from the frontend.

## Future Project Migration Path

A later Project entity can be introduced without changing historical documents:

1. Add a `projects` collection with client ownership, display name, current service address, and active status.
2. Backfill suggested projects by grouping existing documents by `client_id`, `job_name`, and `service_address_snapshot`.
3. Allow future documents to link an optional `project_id` while still freezing `job_name` and `service_address_snapshot` as historical document snapshots.
4. Keep PDF/public documents rendering snapshots, not mutable Project records.
