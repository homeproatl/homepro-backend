import { UserRole } from '../enums/user-role.enum';

export type UserContract = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  organization_id?: string | null;
  is_active?: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AddressContract = {
  street: string | null;
  suite: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

export type MoneyMinor = number;
export type BasisPoints = number;
export type QuantityMilli = number;

export type MarkupType = 'none' | 'percent' | 'fixed';

export type ClientContract = {
  id: string;
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  secondary_phone?: string | null;
  email?: string | null;
  billing_address?: AddressContract | null;
  service_addresses?: AddressContract[];
  notes?: string | null;
  is_archived?: boolean;
  created_at: string;
  updated_at: string;
};

export type ItemContract = {
  id: string;
  name: string;
  item_type?: 'service' | 'labor' | 'material' | 'equipment' | 'other';
  description_template: string | null;
  default_rate_minor: MoneyMinor;
  default_unit_of_measure?: string | null;
  default_internal_unit_cost_minor?: MoneyMinor | null;
  default_vendor_name?: string | null;
  default_sku_or_part_number?: string | null;
  default_waste_basis_points?: BasisPoints;
  default_markup_type: MarkupType;
  default_markup_value: number;
  taxable_default: boolean;
  category: string | null;
  is_active: boolean;
  usage_count?: number;
  created_at: string;
  updated_at: string;
};

export type DocumentLineItemContract = {
  id?: string | null;
  description: string;
  rate_minor: MoneyMinor;
  quantity_milli: QuantityMilli;
  markup_type: MarkupType;
  markup_value: number;
  taxable: boolean;
  notes: string | null;
  total_minor: MoneyMinor;
};

export type JobContextContract = {
  job_name: string | null;
  service_address_snapshot: AddressContract | null;
  project_id: string | null;
};

export type DocumentStatus = 'draft' | 'sent' | 'approved' | 'paid' | 'void';

export type DocumentContract = {
  id: string;
  document_number: string;
  client_id: string;
  status: DocumentStatus;
  job_context: JobContextContract;
  line_items: DocumentLineItemContract[];
  subtotal_minor: MoneyMinor;
  tax_bps: BasisPoints;
  tax_amount_minor: MoneyMinor;
  total_minor: MoneyMinor;
  amount_paid_minor: MoneyMinor;
  created_at: string;
  updated_at: string;
};

export type InvoiceContract = {
  id: string;
  document_id: string;
  invoice_number: string;
  status: string;
  total_minor: MoneyMinor;
  amount_paid_minor: MoneyMinor;
  issued_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentContract = {
  id: string;
  document_id: string;
  amount_minor: MoneyMinor;
  method: string;
  recorded_at: string;
  created_at: string;
};

export type AssetContract = {
  id: string;
  name: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TaxContract = {
  id: string;
  name: string;
  rate_bps: BasisPoints;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ContractAgreementContract = {
  id: string;
  client_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type CalendarEventContract = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
};
