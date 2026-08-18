import type { ItemType, MarkupType } from './schemas/item.schema';

/**
 * Detached catalog → document line snapshot contract.
 * Step 7 persists these fields on documents; catalog edits must not mutate
 * already-issued lines (proven later). This mapper is pure and side-effect free.
 */
export type ItemSnapshotSource = {
  id: string;
  name: string;
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
};

export type DocumentLineItemSnapshotDraft = {
  item_id: string;
  line_type: ItemType;
  description: string;
  notes: string | null;
  unit_of_measure: string | null;
  sku_or_part_number: string | null;
  vendor_name: string | null;
  purchase_status:
    | 'not_needed'
    | 'needed'
    | 'quoted'
    | 'ordered'
    | 'received'
    | 'installed';
  internal_unit_cost_minor: number | null;
  waste_basis_points: number;
  rate_minor: number;
  quantity_milli: number;
  markup_type: MarkupType;
  markup_value: number;
  taxable: boolean;
  tax_ids: string[];
};

export function mapItemToLineSnapshot(
  item: ItemSnapshotSource,
  options?: { quantity_milli?: number },
): DocumentLineItemSnapshotDraft {
  const description =
    item.description_template?.trim() || item.name.trim() || 'Untitled item';
  const isMaterialish =
    item.item_type === 'material' || item.item_type === 'equipment';
  const taxIds = [...new Set(item.tax_ids ?? [])].filter(Boolean);
  const taxable = item.taxable_default && taxIds.length > 0;

  return {
    item_id: item.id,
    line_type: item.item_type,
    description,
    notes: null,
    unit_of_measure: item.default_unit_of_measure,
    sku_or_part_number: item.default_sku_or_part_number,
    vendor_name: item.default_vendor_name,
    purchase_status: isMaterialish ? 'needed' : 'not_needed',
    internal_unit_cost_minor: item.default_internal_unit_cost_minor,
    waste_basis_points: item.default_waste_basis_points,
    rate_minor: item.default_rate_minor,
    quantity_milli: options?.quantity_milli ?? 1000,
    markup_type: item.default_markup_type,
    markup_value: item.default_markup_value,
    taxable,
    tax_ids: taxable ? taxIds : [],
  };
}
