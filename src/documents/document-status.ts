import { ConflictException } from '@nestjs/common';

export const DOCUMENT_TYPE_VALUES = ['estimate', 'invoice'] as const;
export type DocumentType = (typeof DOCUMENT_TYPE_VALUES)[number];

export const ESTIMATE_STATUSES = [
  'draft',
  'pending',
  'approved',
  'declined',
  'expired',
  'archived',
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'sent',
  'void',
  'archived',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const ALL_DOCUMENT_STATUSES = [
  ...new Set<string>([...ESTIMATE_STATUSES, ...INVOICE_STATUSES]),
] as const;
export type DocumentStatus = (typeof ALL_DOCUMENT_STATUSES)[number];

/** Lifecycle statuses that may be stored on archived_from_status. */
export const ARCHIVABLE_FROM_STATUSES = [
  'draft',
  'pending',
  'approved',
  'declined',
  'expired',
  'issued',
  'sent',
  'void',
] as const;
export type ArchivableFromStatus = (typeof ARCHIVABLE_FROM_STATUSES)[number];

const ESTIMATE_TRANSITIONS: Record<EstimateStatus, readonly EstimateStatus[]> =
  {
    draft: ['pending', 'archived'],
    pending: ['approved', 'declined', 'expired', 'draft', 'archived'],
    approved: ['archived'],
    declined: ['draft', 'archived'],
    expired: ['draft', 'archived'],
    // Restore is handled by restoreArchived, not canTransition.
    archived: [],
  };

const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['issued', 'void', 'archived'],
  issued: ['sent', 'void', 'archived'],
  sent: ['void', 'archived'],
  void: ['archived'],
  archived: [],
};

export function isStatusAllowedForType(
  type: DocumentType,
  status: string,
): boolean {
  if (type === 'estimate') {
    return (ESTIMATE_STATUSES as readonly string[]).includes(status);
  }
  return (INVOICE_STATUSES as readonly string[]).includes(status);
}

export function canTransition(
  type: DocumentType,
  from: string,
  to: string,
): boolean {
  if (
    !isStatusAllowedForType(type, from) ||
    !isStatusAllowedForType(type, to)
  ) {
    return false;
  }
  if (from === to) {
    return false;
  }
  if (type === 'estimate') {
    const allowed = ESTIMATE_TRANSITIONS[from as EstimateStatus] ?? [];
    return (allowed as readonly string[]).includes(to);
  }
  const allowed = INVOICE_TRANSITIONS[from as InvoiceStatus] ?? [];
  return (allowed as readonly string[]).includes(to);
}

export function assertTransition(
  type: DocumentType,
  from: string,
  to: string,
): void {
  if (!canTransition(type, from, to)) {
    throw new ConflictException({
      code: 'INVALID_STATUS_TRANSITION',
      message: `Cannot transition ${type} from '${from}' to '${to}'.`,
      document_type: type,
      from_status: from,
      to_status: to,
    });
  }
}

/** Freezing transitions: estimate→pending or invoice→issued. */
export function isFreezeTransition(
  type: DocumentType,
  from: string,
  to: string,
): boolean {
  if (type === 'estimate' && from === 'draft' && to === 'pending') {
    return true;
  }
  if (type === 'invoice' && from === 'draft' && to === 'issued') {
    return true;
  }
  return false;
}

/** Estimate returning to draft unfreezes financial edits. */
export function isUnfreezeTransition(
  type: DocumentType,
  from: string,
  to: string,
): boolean {
  return type === 'estimate' && to === 'draft' && from !== 'draft';
}
