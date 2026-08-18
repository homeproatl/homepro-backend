import { Model } from 'mongoose';
import { OrgDocumentDocument } from '../../documents/schemas/document.schema';

/** Run once before release when a development database may contain the removed status. */
export async function normalizeEstimateConversionStatus(
  documentModel: Model<OrgDocumentDocument>,
) {
  return documentModel.updateMany(
    { type: 'estimate', status: 'invoiced' },
    {
      $set: { status: 'approved' },
      $inc: { version: 1 },
    },
  );
}
