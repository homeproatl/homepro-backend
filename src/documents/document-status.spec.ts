import { ConflictException } from '@nestjs/common';
import {
  assertTransition,
  canTransition,
  isStatusAllowedForType,
  isFreezeTransition,
  isUnfreezeTransition,
} from './document-status';

describe('document-status', () => {
  describe('isStatusAllowedForType', () => {
    it('allows estimate lifecycle statuses only', () => {
      expect(isStatusAllowedForType('estimate', 'draft')).toBe(true);
      expect(isStatusAllowedForType('estimate', 'pending')).toBe(true);
      expect(isStatusAllowedForType('estimate', 'issued')).toBe(false);
      expect(isStatusAllowedForType('estimate', 'sent')).toBe(false);
    });

    it('allows invoice lifecycle statuses only', () => {
      expect(isStatusAllowedForType('invoice', 'draft')).toBe(true);
      expect(isStatusAllowedForType('invoice', 'issued')).toBe(true);
      expect(isStatusAllowedForType('invoice', 'pending')).toBe(false);
      expect(isStatusAllowedForType('invoice', 'approved')).toBe(false);
    });
  });

  describe('canTransition estimates', () => {
    it('draft → pending|archived', () => {
      expect(canTransition('estimate', 'draft', 'pending')).toBe(true);
      expect(canTransition('estimate', 'draft', 'archived')).toBe(true);
      expect(canTransition('estimate', 'draft', 'approved')).toBe(false);
    });

    it('pending → approved|declined|expired|draft|archived', () => {
      for (const to of [
        'approved',
        'declined',
        'expired',
        'draft',
        'archived',
      ]) {
        expect(canTransition('estimate', 'pending', to)).toBe(true);
      }
      expect(canTransition('estimate', 'pending', 'invoiced')).toBe(false);
    });

    it('approved → archived only', () => {
      expect(canTransition('estimate', 'approved', 'invoiced')).toBe(false);
      expect(canTransition('estimate', 'approved', 'archived')).toBe(true);
      expect(canTransition('estimate', 'approved', 'draft')).toBe(false);
    });

    it('declined/expired → draft|archived', () => {
      expect(canTransition('estimate', 'declined', 'draft')).toBe(true);
      expect(canTransition('estimate', 'expired', 'archived')).toBe(true);
      expect(canTransition('estimate', 'declined', 'approved')).toBe(false);
    });

    it('archived has no canTransition restore', () => {
      expect(canTransition('estimate', 'archived', 'draft')).toBe(false);
    });
  });

  describe('canTransition invoices', () => {
    it('draft → issued|void|archived', () => {
      expect(canTransition('invoice', 'draft', 'issued')).toBe(true);
      expect(canTransition('invoice', 'draft', 'void')).toBe(true);
      expect(canTransition('invoice', 'draft', 'archived')).toBe(true);
      expect(canTransition('invoice', 'draft', 'sent')).toBe(false);
    });

    it('issued → sent|void|archived', () => {
      expect(canTransition('invoice', 'issued', 'sent')).toBe(true);
      expect(canTransition('invoice', 'issued', 'void')).toBe(true);
      expect(canTransition('invoice', 'issued', 'draft')).toBe(false);
    });

    it('sent → void|archived', () => {
      expect(canTransition('invoice', 'sent', 'void')).toBe(true);
      expect(canTransition('invoice', 'sent', 'archived')).toBe(true);
      expect(canTransition('invoice', 'sent', 'issued')).toBe(false);
    });

    it('void → archived only', () => {
      expect(canTransition('invoice', 'void', 'archived')).toBe(true);
      expect(canTransition('invoice', 'void', 'draft')).toBe(false);
    });
  });

  describe('assertTransition', () => {
    it('throws ConflictException for invalid transitions', () => {
      expect(() => assertTransition('estimate', 'draft', 'approved')).toThrow(
        ConflictException,
      );
      try {
        assertTransition('invoice', 'void', 'sent');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        const response = (error as ConflictException).getResponse() as {
          code: string;
        };
        expect(response.code).toBe('INVALID_STATUS_TRANSITION');
      }
    });
  });

  describe('freeze helpers', () => {
    it('detects freeze and unfreeze transitions', () => {
      expect(isFreezeTransition('estimate', 'draft', 'pending')).toBe(true);
      expect(isFreezeTransition('invoice', 'draft', 'issued')).toBe(true);
      expect(isFreezeTransition('estimate', 'pending', 'approved')).toBe(false);
      expect(isUnfreezeTransition('estimate', 'pending', 'draft')).toBe(true);
      expect(isUnfreezeTransition('invoice', 'issued', 'draft')).toBe(false);
    });
  });
});
