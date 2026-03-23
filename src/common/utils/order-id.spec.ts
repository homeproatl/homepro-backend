import { generateOrderId, ORDER_ID_LENGTH, ORDER_ID_PATTERN } from './order-id';

describe('order id generator', () => {
  it('generates IDs with expected format and length', () => {
    const id = generateOrderId();
    expect(id).toHaveLength(ORDER_ID_LENGTH);
    expect(id).toMatch(ORDER_ID_PATTERN);
  });

  it('has practical uniqueness across a sample', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      ids.add(generateOrderId());
    }
    expect(ids.size).toBe(500);
  });
});
