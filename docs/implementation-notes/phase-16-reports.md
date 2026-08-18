# Phase 16: Reports And Operational Dashboard

Implemented a compact contractor operations summary instead of a complex SaaS analytics surface.

## Backend formulas

- `GET /dashboard/summary` returns KPI counts, balances, materials-to-buy, needs-action, and recent documents from scoped backend aggregations.
- `GET /reports/summary` returns report KPIs, revenue by month, unpaid/overdue invoices, top clients, top items, and materials to buy.
- Collected revenue uses payment ledger entries by `effective_at`: payments and positive manual adjustments add value, refunds and dispute holds subtract value, dispute reversals add value back.
- Deposits collected applies the same net ledger formula but only for payments whose purpose is `deposit`.
- Outstanding is current positive invoice `balance_due_minor` for issued/sent invoices.
- Overdue is current positive invoice balance with `due_date` before the current UTC day.
- Estimate conversion excludes draft/archived estimates and counts approved/invoiced estimates as converted.
- Materials to buy includes material/equipment lines whose purchase status is `needed`, `quoted`, `ordered`, or `received`. Invoiced estimates are excluded so converted estimate/invoice material lines are not double-counted.

## UI scope

- Dashboard homepage now consumes one authoritative backend summary and shows compact KPI cards, needs-action, recent documents, and quick actions.
- Reports page is intentionally quiet and operational: KPI cards, simple monthly collection bars, top clients/items, unpaid/overdue invoices, and materials to buy.
- No customer dashboard, SaaS metrics, or Joist upsell/reporting clutter was added.
