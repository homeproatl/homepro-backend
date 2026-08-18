import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItemDto } from './create-item.dto';
import { UpdateItemDto } from './update-item.dto';
import { ITEM_FIELD_LIMITS } from '../schemas/item.schema';

async function validateDto<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
) {
  const instance = plainToInstance(cls, payload);
  return validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('item write DTOs', () => {
  it('accepts a material item with planning defaults', async () => {
    const errors = await validateDto(CreateItemDto, {
      name: 'Plywood Sheet',
      item_type: 'material',
      default_rate_minor: 4500,
      default_unit_of_measure: 'each',
      default_internal_unit_cost_minor: 2800,
      default_vendor_name: 'Local Lumber',
      default_sku_or_part_number: 'PLY-4x8',
      default_waste_basis_points: 1000,
      default_markup_type: 'percent',
      default_markup_value: 2500,
      taxable_default: true,
      category: 'Materials',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects unknown fields', async () => {
    const errors = await validateDto(CreateItemDto, {
      name: 'Labor',
      item_type: 'labor',
      default_rate_minor: 8000,
      labor_lines: [],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects negative money and oversize names', async () => {
    const errors = await validateDto(CreateItemDto, {
      name: 'x'.repeat(ITEM_FIELD_LIMITS.name + 1),
      item_type: 'service',
      default_rate_minor: -1,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects empty-string required money instead of coercing to 0', async () => {
    const createErrors = await validateDto(CreateItemDto, {
      name: 'Labor',
      item_type: 'labor',
      default_rate_minor: '',
    });
    expect(createErrors.some((e) => e.property === 'default_rate_minor')).toBe(
      true,
    );

    // Optional update empties become undefined (omit), never coerced to 0.
    const instance = plainToInstance(UpdateItemDto, {
      default_markup_value: '',
      default_waste_basis_points: '',
      default_rate_minor: '',
    });
    expect(instance.default_markup_value).toBeUndefined();
    expect(instance.default_waste_basis_points).toBeUndefined();
    expect(instance.default_rate_minor).toBeUndefined();
    const updateErrors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(updateErrors).toHaveLength(0);
  });
});
