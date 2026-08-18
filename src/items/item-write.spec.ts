import { resolveItemWriteFields } from './item-write';
import type { UpdateItemDto } from './dto/update-item.dto';

describe('resolveItemWriteFields', () => {
  const materialExisting = {
    item_type: 'material' as const,
    description_template: 'Sheet goods',
    default_rate_minor: 4500,
    default_unit_of_measure: 'each',
    default_internal_unit_cost_minor: 2800,
    default_vendor_name: 'Local Lumber',
    default_sku_or_part_number: 'PLY-4x8',
    default_waste_basis_points: 1000,
    default_markup_type: 'none' as const,
    default_markup_value: 0,
    taxable_default: true,
    category: 'Materials',
    private_notes: null,
  };

  it('clears material planning fields when type changes to labor', () => {
    const fields = resolveItemWriteFields(
      { item_type: 'labor' } as UpdateItemDto,
      materialExisting,
    );

    expect(fields.item_type).toBe('labor');
    expect(fields.default_unit_of_measure).toBeNull();
    expect(fields.default_internal_unit_cost_minor).toBeNull();
    expect(fields.default_vendor_name).toBeNull();
    expect(fields.default_sku_or_part_number).toBeNull();
    expect(fields.default_waste_basis_points).toBe(0);
  });

  it('keeps explicitly supplied planning fields on type change', () => {
    const fields = resolveItemWriteFields(
      {
        item_type: 'service',
        default_unit_of_measure: 'hour',
        default_waste_basis_points: 250,
      } as UpdateItemDto,
      materialExisting,
    );

    expect(fields.default_unit_of_measure).toBe('hour');
    expect(fields.default_waste_basis_points).toBe(250);
    expect(fields.default_vendor_name).toBeNull();
  });

  it('preserves material planning fields when type stays materialish', () => {
    const fields = resolveItemWriteFields(
      { default_rate_minor: 5000 } as UpdateItemDto,
      materialExisting,
    );

    expect(fields.default_unit_of_measure).toBe('each');
    expect(fields.default_internal_unit_cost_minor).toBe(2800);
    expect(fields.default_vendor_name).toBe('Local Lumber');
    expect(fields.default_sku_or_part_number).toBe('PLY-4x8');
    expect(fields.default_waste_basis_points).toBe(1000);
  });
});
