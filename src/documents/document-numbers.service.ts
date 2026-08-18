import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import type { DocumentType } from './document-status';
import {
  DocumentNumberCounter,
  DocumentNumberCounterDocument,
} from './schemas/document-number-counter.schema';

export const DEFAULT_NUMBER_PREFIX: Record<DocumentType, string> = {
  estimate: 'EST',
  invoice: 'INV',
};

const MAX_UPSERT_RETRIES = 3;

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: number }).code;
  return code === 11000;
}

export type DocumentNumberingConfig = {
  prefix: string;
  /** Next sequence that will be allocated (highest_allocated + 1). */
  next_number: number;
  /** Highest sequence already allocated (0 if none). */
  highest_allocated: number;
};

@Injectable()
export class DocumentNumbersService {
  constructor(
    @InjectModel(DocumentNumberCounter.name)
    private readonly counterModel: Model<DocumentNumberCounterDocument>,
  ) {}

  async allocateNextNumber(
    organizationId: string,
    type: DocumentType,
    session?: ClientSession,
  ): Promise<string> {
    const organizationObjectId = asObjectId(organizationId, 'organization id');
    const filter = withOrganizationScope(organizationId, {
      document_type: type,
    });

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_UPSERT_RETRIES; attempt++) {
      try {
        let query = this.counterModel.findOneAndUpdate(
          filter,
          {
            $inc: { next_value: 1 },
            $setOnInsert: {
              organization_id: organizationObjectId,
              document_type: type,
              prefix: null,
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
            setDefaultsOnInsert: true,
          },
        );

        if (session) {
          query = query.session(session);
        }

        const counter = await query.exec();
        const allocated = counter?.next_value;

        if (!Number.isSafeInteger(allocated) || allocated < 1) {
          throw new InternalServerErrorException(
            'Document number counter returned an invalid value',
          );
        }

        const prefix =
          typeof counter.prefix === 'string' && counter.prefix.trim().length > 0
            ? counter.prefix.trim()
            : DEFAULT_NUMBER_PREFIX[type];

        return `${prefix}-${String(allocated).padStart(6, '0')}`;
      } catch (error) {
        lastError = error;
        // Concurrent first-insert races can hit unique index 11000 on upsert.
        if (isDuplicateKeyError(error) && attempt < MAX_UPSERT_RETRIES - 1) {
          continue;
        }
        throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new InternalServerErrorException(
          'Document number counter allocation failed',
        );
  }

  async getNumberingConfig(
    organizationId: string,
    type: DocumentType,
  ): Promise<DocumentNumberingConfig> {
    const counter = await this.counterModel
      .findOne(
        withOrganizationScope(organizationId, {
          document_type: type,
        }),
      )
      .exec();

    const highestAllocated =
      counter && Number.isSafeInteger(counter.next_value)
        ? Math.max(0, counter.next_value)
        : 0;
    const prefix =
      typeof counter?.prefix === 'string' && counter.prefix.trim().length > 0
        ? counter.prefix.trim()
        : DEFAULT_NUMBER_PREFIX[type];

    return {
      prefix,
      next_number: highestAllocated + 1,
      highest_allocated: highestAllocated,
    };
  }

  /**
   * Updates the prefix for future allocations only. Does not rename existing
   * documents. Empty/whitespace falls back to the type default on allocate.
   */
  async setPrefix(
    organizationId: string,
    type: DocumentType,
    prefix: string,
    session?: ClientSession,
  ): Promise<DocumentNumberingConfig> {
    const trimmed = prefix.trim();
    if (!trimmed) {
      throw new BadRequestException('Document number prefix cannot be empty');
    }

    const organizationObjectId = asObjectId(organizationId, 'organization id');
    const filter = withOrganizationScope(organizationId, {
      document_type: type,
    });

    let query = this.counterModel.findOneAndUpdate(
      filter,
      {
        $set: { prefix: trimmed },
        $setOnInsert: {
          organization_id: organizationObjectId,
          document_type: type,
          next_value: 0,
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
      },
    );
    if (session) {
      query = query.session(session);
    }
    const counter = await query.exec();
    if (!counter) {
      throw new InternalServerErrorException(
        'Unable to update document number prefix',
      );
    }

    return {
      prefix: trimmed,
      next_number: Math.max(0, counter.next_value) + 1,
      highest_allocated: Math.max(0, counter.next_value),
    };
  }

  /**
   * Sets the next sequence that will be allocated.
   * Rejects values at or below the highest already allocated.
   * Atomic condition: stored next_value must be < desiredNextNumber.
   */
  async setNextNumber(
    organizationId: string,
    type: DocumentType,
    nextNumber: number,
    session?: ClientSession,
  ): Promise<DocumentNumberingConfig> {
    if (!Number.isSafeInteger(nextNumber) || nextNumber < 1) {
      throw new BadRequestException(
        'Document next number must be a positive integer',
      );
    }

    const organizationObjectId = asObjectId(organizationId, 'organization id');
    const storedTarget = nextNumber - 1;

    // Ensure a counter row exists so the conditional update can match.
    await this.ensureCounter(organizationId, type, session);

    const filter = withOrganizationScope(organizationId, {
      document_type: type,
      next_value: { $lt: nextNumber },
    });

    let query = this.counterModel.findOneAndUpdate(
      filter,
      {
        $set: { next_value: storedTarget },
      },
      {
        returnDocument: 'after',
      },
    );
    if (session) {
      query = query.session(session);
    }
    const updated = await query.exec();

    if (!updated) {
      const current = await this.getNumberingConfig(organizationId, type);
      // Idempotent: re-saving the already-configured next number must succeed
      // (e.g. Documents settings PATCH that includes unchanged next values).
      if (current.next_number === nextNumber) {
        return current;
      }
      throw new BadRequestException(
        `Document next number must be at least ${current.next_number} (cannot reuse or decrease below already allocated sequences)`,
      );
    }

    const prefix =
      typeof updated.prefix === 'string' && updated.prefix.trim().length > 0
        ? updated.prefix.trim()
        : DEFAULT_NUMBER_PREFIX[type];

    return {
      prefix,
      next_number: nextNumber,
      highest_allocated: storedTarget,
    };
  }

  private async ensureCounter(
    organizationId: string,
    type: DocumentType,
    session?: ClientSession,
  ) {
    const organizationObjectId = asObjectId(organizationId, 'organization id');
    let query = this.counterModel.findOneAndUpdate(
      withOrganizationScope(organizationId, { document_type: type }),
      {
        $setOnInsert: {
          organization_id: organizationObjectId,
          document_type: type,
          next_value: 0,
          prefix: null,
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
      },
    );
    if (session) {
      query = query.session(session);
    }
    await query.exec();
  }
}
