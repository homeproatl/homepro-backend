import { ClientSchema } from './schemas/client.schema';

describe('client schema constraints', () => {
  it('keeps client query indexes scoped by organization', () => {
    const indexKeys = ClientSchema.indexes().map(([keys]) => keys);

    expect(indexKeys).toEqual(
      expect.arrayContaining([
        { organization_id: 1, display_name: 1, _id: 1 },
        { organization_id: 1, is_archived: 1, created_at: -1, _id: -1 },
        { organization_id: 1, search_name: 1 },
        { organization_id: 1, search_company: 1 },
        { organization_id: 1, search_email: 1 },
        { organization_id: 1, search_phone: 1 },
        { organization_id: 1, search_secondary_phone: 1 },
        { organization_id: 1, search_addresses: 1 },
      ]),
    );

    const unscopedClientIndexes = indexKeys.filter((keys) => {
      const [firstKey] = Object.keys(keys);
      return firstKey !== 'organization_id';
    });
    expect(unscopedClientIndexes).toEqual([]);

    expect(ClientSchema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { organization_id: 1, contact_keys: 1 },
          expect.objectContaining({
            unique: true,
            name: 'uniq_client_contact_identity',
          }),
        ],
      ]),
    );
  });
});
