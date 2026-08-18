import { OrgDocumentSchema } from './schemas/document.schema';

describe('document schema constraints', () => {
  it('keeps document query indexes scoped by organization', () => {
    const indexKeys = OrgDocumentSchema.indexes().map(([keys]) => keys);

    expect(indexKeys).toEqual(
      expect.arrayContaining([
        { organization_id: 1, type: 1, number: 1 },
        { organization_id: 1, client_id: 1, status: 1 },
        { organization_id: 1, type: 1, status: 1, updated_at: -1 },
        { organization_id: 1, type: 1, issue_date: -1, _id: -1 },
        { organization_id: 1, due_date: 1 },
      ]),
    );

    const unscopedOperationalIndexes = indexKeys.filter((keys) => {
      const keyNames = Object.keys(keys);
      const firstKey = keyNames[0];
      return (
        firstKey !== 'organization_id' &&
        keyNames.some((key) => ['type', 'client_id', 'status'].includes(key))
      );
    });

    expect(unscopedOperationalIndexes).toEqual([]);
  });
});
