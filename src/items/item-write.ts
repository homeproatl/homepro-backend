import { BadRequestException } from '@nestjs/common';
import type { CreateItemDto } from './dto/create-item.dto';
import type { UpdateItemDto } from './dto/update-item.dto';
import {
  ITEM_TYPE_VALUES,
  MARKUP_TYPE_VALUES,
  type ItemType,
  type MarkupType,
} from './schemas/item.schema';

export function normalizeItemName(name: string) {
  return name.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

export function assertMarkupConsistency(
  markupType: MarkupType,
  markupValue: number,
) {
  if (markupType === 'none' && markupValue !== 0) {
    throw new BadRequestException(
      'default_markup_value must be 0 when default_markup_type is none.',
    );
  }
}

export function resolveItemWriteFields(
  payload: CreateItemDto | UpdateItemDto,
  existing?: {
    item_type: ItemType;
    description_template: string | null;
    default_rate_minor: number;
    default_unit_of_measure: string | null;
    default_internal_unit_cost_minor: number | null;
    default_vendor_name: string | null;
    default_sku_or_part_number: string | null;
    default_waste_basis_points: number;
    default_markup_type: MarkupType;
    default_markup_value: number;
    taxable_default: boolean;
    tax_ids?: string[];
    category: string | null;
    private_notes: string | null;
  },
) {
  const item_type =
    payload.item_type ?? existing?.item_type ?? ('service' as ItemType);
  if (!ITEM_TYPE_VALUES.includes(item_type)) {
    throw new BadRequestException('Invalid item_type.');
  }

  const default_markup_type =
    payload.default_markup_type ??
    existing?.default_markup_type ??
    ('none' as MarkupType);
  if (!MARKUP_TYPE_VALUES.includes(default_markup_type)) {
    throw new BadRequestException('Invalid default_markup_type.');
  }

  const default_markup_value =
    payload.default_markup_value !== undefined
      ? payload.default_markup_value
      : (existing?.default_markup_value ?? 0);

  assertMarkupConsistency(default_markup_type, default_markup_value);

  const isMaterialish = item_type === 'material' || item_type === 'equipment';
  const typeChangedAwayFromMaterialish =
    Boolean(existing) &&
    (existing!.item_type === 'material' ||
      existing!.item_type === 'equipment') &&
    !isMaterialish;

  // When leaving material/equipment, clear planning fields unless the patch
  // explicitly re-supplies them. Materialish types keep existing/defaults.
  const pickMaterialField = <T>(
    payloadValue: T | undefined,
    existingValue: T | null | undefined,
    clearedValue: T,
  ): T => {
    if (payloadValue !== undefined) {
      return payloadValue;
    }
    if (isMaterialish) {
      return existingValue ?? clearedValue;
    }
    if (typeChangedAwayFromMaterialish) {
      return clearedValue;
    }
    return existingValue ?? clearedValue;
  };

  const selectedTaxIds = [
    ...new Set(
      (payload.tax_ids !== undefined
        ? payload.tax_ids
        : (existing?.tax_ids ?? []).map((taxId) => String(taxId))
      )
        .map((taxId) => String(taxId))
        .filter(Boolean),
    ),
  ];
  const taxableRequested =
    payload.taxable_default !== undefined
      ? payload.taxable_default
      : payload.tax_ids !== undefined
        ? selectedTaxIds.length > 0
        : (existing?.taxable_default ?? false);
  const taxableDefault = taxableRequested && selectedTaxIds.length > 0;

  return {
    item_type,
    description_template:
      payload.description_template !== undefined
        ? payload.description_template
        : (existing?.description_template ?? null),
    default_rate_minor:
      payload.default_rate_minor !== undefined
        ? payload.default_rate_minor
        : (existing?.default_rate_minor ?? 0),
    default_unit_of_measure: pickMaterialField(
      payload.default_unit_of_measure,
      existing?.default_unit_of_measure,
      null,
    ),
    default_internal_unit_cost_minor: pickMaterialField(
      payload.default_internal_unit_cost_minor,
      existing?.default_internal_unit_cost_minor,
      null,
    ),
    default_vendor_name: pickMaterialField(
      payload.default_vendor_name,
      existing?.default_vendor_name,
      null,
    ),
    default_sku_or_part_number: pickMaterialField(
      payload.default_sku_or_part_number,
      existing?.default_sku_or_part_number,
      null,
    ),
    default_waste_basis_points: pickMaterialField(
      payload.default_waste_basis_points,
      existing?.default_waste_basis_points,
      0,
    ),
    default_markup_type,
    default_markup_value,
    taxable_default: taxableDefault,
    tax_ids: taxableDefault ? selectedTaxIds : [],
    category:
      payload.category !== undefined
        ? payload.category
        : (existing?.category ?? null),
    private_notes:
      payload.private_notes !== undefined
        ? payload.private_notes
        : (existing?.private_notes ?? null),
  };
}
