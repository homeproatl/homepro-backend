import { mapItemToLineSnapshot } from './item-to-line-snapshot';

describe('mapItemToLineSnapshot', () => {
  it('copies catalog defaults into a detached line draft', () => {
    const snapshot = mapItemToLineSnapshot({
      id: 'item-1',
      name: 'Plywood',
      item_type: 'material',
      description_template: '4x8 plywood sheet',
      default_rate_minor: 4500,
      default_unit_of_measure: 'each',
      default_internal_unit_cost_minor: 2800,
      default_vendor_name: 'Local Lumber',
      default_sku_or_part_number: 'PLY-4x8',
      default_waste_basis_points: 1000,
      default_markup_type: 'percent',
      default_markup_value: 2500,
      taxable_default: true,
      tax_ids: ['tax-1', 'tax-2', 'tax-1'],
    });

    expect(snapshot).toEqual({
      item_id: 'item-1',
      line_type: 'material',
      description: '4x8 plywood sheet',
      notes: null,
      unit_of_measure: 'each',
      sku_or_part_number: 'PLY-4x8',
      vendor_name: 'Local Lumber',
      purchase_status: 'needed',
      internal_unit_cost_minor: 2800,
      waste_basis_points: 1000,
      rate_minor: 4500,
      quantity_milli: 1000,
      markup_type: 'percent',
      markup_value: 2500,
      taxable: true,
      tax_ids: ['tax-1', 'tax-2'],
    });
  });

  it('falls back to item name and marks non-materials not needed', () => {
    const snapshot = mapItemToLineSnapshot({
      id: 'item-2',
      name: 'General Labor',
      item_type: 'labor',
      description_template: null,
      default_rate_minor: 8500,
      default_unit_of_measure: null,
      default_internal_unit_cost_minor: null,
      default_vendor_name: null,
      default_sku_or_part_number: null,
      default_waste_basis_points: 0,
      default_markup_type: 'none',
      default_markup_value: 0,
      taxable_default: false,
    });

    expect(snapshot.description).toBe('General Labor');
    expect(snapshot.purchase_status).toBe('not_needed');
    expect(snapshot.taxable).toBe(false);
    expect(snapshot.tax_ids).toEqual([]);
  });

  it('does not create a taxable snapshot without a selected tax', () => {
    const snapshot = mapItemToLineSnapshot({
      id: 'item-untaxed',
      name: 'Untaxed service',
      item_type: 'service',
      description_template: null,
      default_rate_minor: 10000,
      default_unit_of_measure: null,
      default_internal_unit_cost_minor: null,
      default_vendor_name: null,
      default_sku_or_part_number: null,
      default_waste_basis_points: 0,
      default_markup_type: 'none',
      default_markup_value: 0,
      taxable_default: true,
    });

    expect(snapshot.taxable).toBe(false);
    expect(snapshot.tax_ids).toEqual([]);
  });

  it('does not mutate the source catalog object', () => {
    const source = {
      id: 'item-3',
      name: 'Service',
      item_type: 'service' as const,
      description_template: 'Inspect site',
      default_rate_minor: 12000,
      default_unit_of_measure: null,
      default_internal_unit_cost_minor: null,
      default_vendor_name: null,
      default_sku_or_part_number: null,
      default_waste_basis_points: 0,
      default_markup_type: 'none' as const,
      default_markup_value: 0,
      taxable_default: true,
    };
    const before = structuredClone(source);
    mapItemToLineSnapshot(source, { quantity_milli: 2500 });
    expect(source).toEqual(before);
  });
});
