export type InvoicePaymentDisplay =
  | 'unpaid'
  | 'pending'
  | 'partial'
  | 'paid'
  | 'overdue'
  | 'refunded'
  | 'disputed';

export type InvoicePaymentDisplayInput = {
  total_minor: number;
  amount_paid_minor: number;
  amount_refunded_minor: number;
  amount_disputed_minor: number;
  balance_due_minor: number;
  due_date: Date | string | null;
  status: string;
  now?: Date;
};

/**
 * Derived payment label for admin/UI. Ledger amounts are authoritative;
 * this never mutates document status.
 */
export function computeInvoicePaymentDisplay(
  input: InvoicePaymentDisplayInput,
): InvoicePaymentDisplay {
  const paid = input.amount_paid_minor ?? 0;
  const refunded = input.amount_refunded_minor ?? 0;
  const disputed = input.amount_disputed_minor ?? 0;
  const balance = input.balance_due_minor ?? 0;
  const status = input.status ?? '';

  if (disputed > 0) {
    return 'disputed';
  }
  if (refunded >= paid && paid > 0) {
    return 'refunded';
  }
  if (balance <= 0 && paid > 0) {
    return 'paid';
  }
  if (paid > 0 && balance > 0) {
    return 'partial';
  }

  const now = input.now ?? new Date();
  if (
    isPastDue(input.due_date, now) &&
    status !== 'void' &&
    status !== 'draft'
  ) {
    return 'overdue';
  }

  // Zero-paid draft/issued could be labeled `pending`; prefer `unpaid`.
  return 'unpaid';
}

function isPastDue(dueDate: Date | string | null, now: Date): boolean {
  if (dueDate == null) {
    return false;
  }
  const due =
    typeof dueDate === 'string' ? new Date(dueDate) : new Date(dueDate);
  if (Number.isNaN(due.getTime())) {
    return false;
  }
  const dueDay = Date.UTC(
    due.getUTCFullYear(),
    due.getUTCMonth(),
    due.getUTCDate(),
  );
  const nowDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return dueDay < nowDay;
}
