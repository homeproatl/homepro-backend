import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Address, AddressSchema } from '../../common/schemas/address.schema';
import { Organization } from '../../organizations/schemas/organization.schema';

export type AppSettingsDocument = HydratedDocument<AppSettings>;

export const APP_SETTINGS_FIELD_LIMITS = {
  name: 120,
  email: 254,
  phone: 40,
  website: 300,
  industry: 120,
  identifier: 120,
  prefix: 20,
  payment_terms: 500,
  footer: 5_000,
  notes: 5_000,
  email_message: 5_000,
  locale: 32,
  currency: 16,
} as const;

export function buildDefaultPaymentTerms(invoiceDueDays = 30) {
  if (invoiceDueDays <= 0) {
    return 'Payment is due on receipt.';
  }
  if (invoiceDueDays === 1) {
    return 'Payment is due within 1 day.';
  }
  return `Payment is due within ${invoiceDueDays} days.`;
}

export const DEFAULT_PAYMENT_TERMS = buildDefaultPaymentTerms(30);

export const DEFAULT_ESTIMATE_EMAIL_MESSAGE =
  'Hi,\n\nPlease review the attached estimate. Let us know if you have any questions or would like to move forward.\n\nThank you,';

export const DEFAULT_INVOICE_EMAIL_MESSAGE =
  'Hi,\n\nPlease review the attached invoice. You can use the secure payment link in this email to pay online.\n\nThank you,';

@Schema({ _id: false, id: false })
export class AccountSettings {
  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.name,
  })
  first_name!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.name,
  })
  last_name!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.email,
  })
  email!: string | null;
}

export const AccountSettingsSchema =
  SchemaFactory.createForClass(AccountSettings);

@Schema({ _id: false, id: false })
export class CompanySettings {
  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.name,
  })
  legal_name!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.name,
  })
  display_name!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.phone,
  })
  phone!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.email,
  })
  email!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.website,
  })
  website!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.industry,
  })
  industry!: string | null;

  @Prop({ type: AddressSchema, default: null })
  address!: Address | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.identifier,
  })
  license_number!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.identifier,
  })
  insurance_number!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.identifier,
  })
  tax_id!: string | null;

  /** Logo asset reference only; upload API arrives in a later step. */
  @Prop({ type: String, trim: true, default: null })
  logo_asset_id!: string | null;
}

export const CompanySettingsSchema =
  SchemaFactory.createForClass(CompanySettings);

@Schema({ _id: false, id: false })
export class DocumentSettings {
  @Prop({
    type: String,
    trim: true,
    default: 'EST',
    maxlength: APP_SETTINGS_FIELD_LIMITS.prefix,
  })
  estimate_number_prefix!: string;

  @Prop({
    type: String,
    trim: true,
    default: 'INV',
    maxlength: APP_SETTINGS_FIELD_LIMITS.prefix,
  })
  invoice_number_prefix!: string;

  @Prop({
    type: String,
    trim: true,
    default: DEFAULT_PAYMENT_TERMS,
    maxlength: APP_SETTINGS_FIELD_LIMITS.payment_terms,
  })
  default_payment_terms!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.footer,
  })
  default_footer!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: APP_SETTINGS_FIELD_LIMITS.notes,
  })
  default_customer_notes!: string | null;

  @Prop({ type: Number, min: 0, max: 3650, default: 30 })
  default_estimate_expiration_days!: number;

  @Prop({ type: Number, min: 0, max: 3650, default: 30 })
  default_invoice_due_days!: number;

  /** Deposit as basis points of total (e.g. 5000 = 50%). */
  @Prop({ type: Number, min: 0, max: 100_000, default: 0 })
  default_deposit_basis_points!: number;

  /** Sales tax as basis points (e.g. 800 = 8%). */
  @Prop({ type: Number, min: 0, max: 100_000, default: 0 })
  default_sales_tax_basis_points!: number;

  @Prop({ type: Boolean, default: false })
  default_show_client_signature!: boolean;

  @Prop({ type: Boolean, default: false })
  default_show_company_signature!: boolean;

  @Prop({
    type: String,
    trim: true,
    default: DEFAULT_ESTIMATE_EMAIL_MESSAGE,
    maxlength: APP_SETTINGS_FIELD_LIMITS.email_message,
  })
  default_estimate_email_message!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: DEFAULT_INVOICE_EMAIL_MESSAGE,
    maxlength: APP_SETTINGS_FIELD_LIMITS.email_message,
  })
  default_invoice_email_message!: string | null;
}

export const DocumentSettingsSchema =
  SchemaFactory.createForClass(DocumentSettings);

@Schema({ _id: false, id: false })
export class PreferenceSettings {
  @Prop({
    type: String,
    trim: true,
    default: 'usd',
    maxlength: APP_SETTINGS_FIELD_LIMITS.currency,
  })
  currency!: string;

  @Prop({
    type: String,
    trim: true,
    default: 'en-US',
    maxlength: APP_SETTINGS_FIELD_LIMITS.locale,
  })
  locale!: string;

  @Prop({ type: Boolean, default: true })
  email_on_estimate_approved!: boolean;

  @Prop({ type: Boolean, default: true })
  email_on_invoice_paid!: boolean;

  @Prop({ type: Boolean, default: true })
  email_on_estimate_viewed!: boolean;

  @Prop({ type: Boolean, default: false })
  email_on_invoice_viewed!: boolean;
}

export const PreferenceSettingsSchema =
  SchemaFactory.createForClass(PreferenceSettings);

@Schema({
  collection: 'app_settings',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class AppSettings {
  @Prop({
    type: Types.ObjectId,
    ref: Organization.name,
    required: true,
  })
  organization_id!: Types.ObjectId;

  @Prop({ required: true, default: 'app' })
  singleton_key!: string;

  @Prop({ required: true, trim: true })
  business_timezone!: string;

  @Prop({ type: AccountSettingsSchema, default: () => ({}) })
  account!: AccountSettings;

  @Prop({ type: CompanySettingsSchema, default: () => ({}) })
  company!: CompanySettings;

  @Prop({ type: DocumentSettingsSchema, default: () => ({}) })
  documents!: DocumentSettings;

  @Prop({ type: PreferenceSettingsSchema, default: () => ({}) })
  preferences!: PreferenceSettings;

  created_at!: Date;
  updated_at!: Date;
}

export const AppSettingsSchema = SchemaFactory.createForClass(AppSettings);

AppSettingsSchema.index({ organization_id: 1 }, { unique: true });
