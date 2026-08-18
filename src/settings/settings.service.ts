import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import { UserRole } from '../common/enums/user-role.enum';
import { Address } from '../common/schemas/address.schema';
import {
  DEFAULT_NUMBER_PREFIX,
  DocumentNumbersService,
} from '../documents/document-numbers.service';
import {
  AccountSettings,
  AppSettings,
  AppSettingsDocument,
  buildDefaultPaymentTerms,
  CompanySettings,
  DEFAULT_ESTIMATE_EMAIL_MESSAGE,
  DEFAULT_INVOICE_EMAIL_MESSAGE,
  DEFAULT_PAYMENT_TERMS,
  DocumentSettings,
  PreferenceSettings,
} from './schemas/app-settings.schema';
import {
  SettingsAddressDto,
  UpdateAppSettingsDto,
  UpdateCompanySettingsDto,
  UpdateDocumentSettingsDto,
} from './dto/update-app-settings.dto';

const FALLBACK_BUSINESS_TIMEZONE = 'America/New_York';
const FALLBACK_COMPANY_NAME = 'Home Pro';

export type AppSettingsContract = {
  id: string;
  business_timezone: string;
  account: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  };
  company: {
    legal_name: string | null;
    display_name: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    industry: string | null;
    address: {
      street: string | null;
      suite: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      country: string | null;
    } | null;
    license_number: string | null;
    insurance_number: string | null;
    tax_id: string | null;
    logo_asset_id: string | null;
  };
  documents: {
    estimate_number_prefix: string;
    invoice_number_prefix: string;
    estimate_next_number: number;
    invoice_next_number: number;
    default_payment_terms: string | null;
    default_footer: string | null;
    default_customer_notes: string | null;
    default_estimate_expiration_days: number;
    default_invoice_due_days: number;
    default_deposit_basis_points: number;
    default_show_client_signature: boolean;
    default_show_company_signature: boolean;
    default_estimate_email_message: string | null;
    default_invoice_email_message: string | null;
  };
  preferences: {
    currency: string;
    locale: string;
    email_on_estimate_approved: boolean;
    email_on_invoice_paid: boolean;
    email_on_estimate_viewed: boolean;
    email_on_invoice_viewed: boolean;
  };
  created_at?: string;
  updated_at?: string;
};

/** TECH-safe projection: no legal/tax identifiers or numbering controls. */
export type TechnicianAppSettingsContract = {
  id: string;
  business_timezone: string;
  account: AppSettingsContract['account'];
  company: {
    display_name: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    industry: string | null;
    address: AppSettingsContract['company']['address'];
    logo_asset_id: string | null;
  };
  documents: {
    default_payment_terms: string | null;
    default_footer: string | null;
    default_customer_notes: string | null;
    default_estimate_expiration_days: number;
    default_invoice_due_days: number;
    default_deposit_basis_points: number;
    default_show_client_signature: boolean;
    default_show_company_signature: boolean;
    default_estimate_email_message: string | null;
    default_invoice_email_message: string | null;
  };
  preferences: AppSettingsContract['preferences'];
  created_at?: string;
  updated_at?: string;
};

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(AppSettings.name)
    private readonly appSettingsModel: Model<AppSettingsDocument>,
    private readonly configService: ConfigService,
    private readonly documentNumbersService: DocumentNumbersService,
  ) {}

  async getAppSettings(
    organizationId: string,
    role: UserRole = UserRole.ADMIN,
  ): Promise<AppSettingsContract | TechnicianAppSettingsContract> {
    const settings = await this.findOrCreateSettings(organizationId);
    const full = await this.toAppSettingsContract(settings, organizationId);
    if (role === UserRole.TECHNICIAN) {
      return this.toTechnicianProjection(full);
    }
    return full;
  }

  async updateAppSettings(
    payload: UpdateAppSettingsDto,
    organizationId: string,
  ): Promise<AppSettingsContract> {
    const settings = await this.findOrCreateSettings(organizationId);

    if (payload.business_timezone !== undefined) {
      this.assertValidTimeZone(payload.business_timezone);
      settings.business_timezone = payload.business_timezone;
    }

    if (payload.account) {
      this.ensureAccount(settings);
      if (payload.account.first_name !== undefined) {
        settings.account.first_name = payload.account.first_name;
      }
      if (payload.account.last_name !== undefined) {
        settings.account.last_name = payload.account.last_name;
      }
      if (payload.account.email !== undefined) {
        settings.account.email = payload.account.email;
      }
    }

    if (payload.company) {
      this.applyCompanyPatch(settings, payload.company);
    }

    if (payload.documents) {
      await this.applyDocumentsPatch(
        settings,
        payload.documents,
        organizationId,
      );
    }

    if (payload.preferences) {
      this.ensurePreferences(settings);
      const prefs = payload.preferences;
      if (prefs.currency !== undefined) {
        settings.preferences.currency = prefs.currency.toLowerCase();
      }
      if (prefs.locale !== undefined) {
        settings.preferences.locale = prefs.locale;
      }
      if (prefs.email_on_estimate_approved !== undefined) {
        settings.preferences.email_on_estimate_approved =
          prefs.email_on_estimate_approved;
      }
      if (prefs.email_on_invoice_paid !== undefined) {
        settings.preferences.email_on_invoice_paid =
          prefs.email_on_invoice_paid;
      }
      if (prefs.email_on_estimate_viewed !== undefined) {
        settings.preferences.email_on_estimate_viewed =
          prefs.email_on_estimate_viewed;
      }
      if (prefs.email_on_invoice_viewed !== undefined) {
        settings.preferences.email_on_invoice_viewed =
          prefs.email_on_invoice_viewed;
      }
    }

    await settings.save();
    return this.toAppSettingsContract(settings, organizationId);
  }

  /**
   * Returns company/document/preference values for document snapshots.
   * Never includes Stripe or credential fields.
   */
  async getSnapshotSource(organizationId: string) {
    const settings = await this.findOrCreateSettings(organizationId);
    this.ensureNestedDefaults(settings);
    const account = settings.account ?? ({} as AccountSettings);
    const company = settings.company ?? ({} as CompanySettings);
    const documents = settings.documents ?? ({} as DocumentSettings);
    const preferences = settings.preferences ?? ({} as PreferenceSettings);

    return {
      business_timezone: settings.business_timezone,
      account,
      company,
      documents,
      preferences: {
        currency: preferences.currency ?? 'usd',
        locale: preferences.locale ?? 'en-US',
      },
    };
  }

  private async findOrCreateSettings(organizationId: string) {
    const defaultBusinessTimeZone = this.resolveDefaultBusinessTimeZone();
    const organizationObjectId = asObjectId(organizationId, 'organization id');

    const settings = await this.appSettingsModel
      .findOneAndUpdate(
        withOrganizationScope(organizationId, {}),
        {
          $setOnInsert: {
            organization_id: organizationObjectId,
            singleton_key: 'app',
            business_timezone: defaultBusinessTimeZone,
            account: {},
            company: {
              legal_name: this.resolveDefaultCompanyName(),
              display_name: this.resolveDefaultCompanyName(),
            },
            documents: {},
            preferences: {},
          },
        },
        {
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
        },
      )
      .exec();

    if (!settings) {
      throw new BadRequestException(
        'Unable to load business timezone settings',
      );
    }

    if (this.isValidTimeZone(settings.business_timezone)) {
      return settings;
    }

    settings.business_timezone = defaultBusinessTimeZone;
    await settings.save();

    return settings;
  }

  private resolveDefaultBusinessTimeZone() {
    const businessTimeZone =
      this.configService.get<string>('BUSINESS_TIMEZONE') ??
      FALLBACK_BUSINESS_TIMEZONE;

    this.assertValidTimeZone(businessTimeZone);
    return businessTimeZone;
  }

  private resolveDefaultCompanyName() {
    return (
      this.configService.get<string>('COMPANY_ORGANIZATION_NAME')?.trim() ||
      FALLBACK_COMPANY_NAME
    );
  }

  private async toAppSettingsContract(
    settings: AppSettingsDocument,
    organizationId: string,
  ): Promise<AppSettingsContract> {
    this.ensureNestedDefaults(settings);

    const [estimateNumbering, invoiceNumbering] = await Promise.all([
      this.documentNumbersService.getNumberingConfig(
        organizationId,
        'estimate',
      ),
      this.documentNumbersService.getNumberingConfig(organizationId, 'invoice'),
    ]);

    // Prefer live counter prefix; fall back to stored document settings / defaults.
    const estimatePrefix =
      estimateNumbering.prefix ||
      settings.documents.estimate_number_prefix ||
      DEFAULT_NUMBER_PREFIX.estimate;
    const invoicePrefix =
      invoiceNumbering.prefix ||
      settings.documents.invoice_number_prefix ||
      DEFAULT_NUMBER_PREFIX.invoice;

    return {
      id: settings.singleton_key,
      business_timezone: settings.business_timezone,
      account: {
        first_name: settings.account.first_name ?? null,
        last_name: settings.account.last_name ?? null,
        email: settings.account.email ?? null,
      },
      company: {
        legal_name:
          settings.company.legal_name ?? this.resolveDefaultCompanyName(),
        display_name:
          settings.company.display_name ?? this.resolveDefaultCompanyName(),
        phone: settings.company.phone ?? null,
        email: settings.company.email ?? null,
        website: settings.company.website ?? null,
        industry: settings.company.industry ?? null,
        address: this.serializeAddress(settings.company.address),
        license_number: settings.company.license_number ?? null,
        insurance_number: settings.company.insurance_number ?? null,
        tax_id: settings.company.tax_id ?? null,
        logo_asset_id: settings.company.logo_asset_id ?? null,
      },
      documents: {
        estimate_number_prefix: estimatePrefix,
        invoice_number_prefix: invoicePrefix,
        estimate_next_number: estimateNumbering.next_number,
        invoice_next_number: invoiceNumbering.next_number,
        default_payment_terms: buildDefaultPaymentTerms(
          settings.documents.default_invoice_due_days ?? 30,
        ),
        default_footer: settings.documents.default_footer ?? null,
        default_customer_notes:
          settings.documents.default_customer_notes ?? null,
        default_estimate_expiration_days:
          settings.documents.default_estimate_expiration_days ?? 30,
        default_invoice_due_days:
          settings.documents.default_invoice_due_days ?? 30,
        default_deposit_basis_points:
          settings.documents.default_deposit_basis_points ?? 0,
        default_show_client_signature:
          settings.documents.default_show_client_signature === true,
        default_show_company_signature:
          settings.documents.default_show_company_signature === true,
        default_estimate_email_message:
          settings.documents.default_estimate_email_message ??
          DEFAULT_ESTIMATE_EMAIL_MESSAGE,
        default_invoice_email_message:
          settings.documents.default_invoice_email_message ??
          DEFAULT_INVOICE_EMAIL_MESSAGE,
      },
      preferences: {
        currency: (settings.preferences.currency ?? 'usd').toLowerCase(),
        locale: settings.preferences.locale ?? 'en-US',
        email_on_estimate_approved:
          settings.preferences.email_on_estimate_approved !== false,
        email_on_invoice_paid:
          settings.preferences.email_on_invoice_paid !== false,
        email_on_estimate_viewed:
          settings.preferences.email_on_estimate_viewed !== false,
        email_on_invoice_viewed:
          settings.preferences.email_on_invoice_viewed === true,
      },
      created_at: settings.created_at?.toISOString?.(),
      updated_at: settings.updated_at?.toISOString?.(),
    };
  }

  private toTechnicianProjection(
    full: AppSettingsContract,
  ): TechnicianAppSettingsContract {
    return {
      id: full.id,
      business_timezone: full.business_timezone,
      account: full.account,
      company: {
        display_name: full.company.display_name,
        phone: full.company.phone,
        email: full.company.email,
        website: full.company.website,
        industry: full.company.industry,
        address: full.company.address,
        logo_asset_id: full.company.logo_asset_id,
      },
      documents: {
        default_payment_terms: full.documents.default_payment_terms,
        default_footer: full.documents.default_footer,
        default_customer_notes: full.documents.default_customer_notes,
        default_estimate_expiration_days:
          full.documents.default_estimate_expiration_days,
        default_invoice_due_days: full.documents.default_invoice_due_days,
        default_deposit_basis_points:
          full.documents.default_deposit_basis_points,
        default_show_client_signature:
          full.documents.default_show_client_signature,
        default_show_company_signature:
          full.documents.default_show_company_signature,
        default_estimate_email_message:
          full.documents.default_estimate_email_message,
        default_invoice_email_message:
          full.documents.default_invoice_email_message,
      },
      preferences: full.preferences,
      created_at: full.created_at,
      updated_at: full.updated_at,
    };
  }

  private applyCompanyPatch(
    settings: AppSettingsDocument,
    patch: UpdateCompanySettingsDto,
  ) {
    this.ensureCompany(settings);
    const fields: Array<keyof UpdateCompanySettingsDto> = [
      'legal_name',
      'display_name',
      'phone',
      'email',
      'website',
      'industry',
      'license_number',
      'insurance_number',
      'tax_id',
      'logo_asset_id',
    ];
    for (const field of fields) {
      if (patch[field] !== undefined && field !== 'address') {
        settings.company[field as keyof CompanySettings] = patch[
          field
        ] as never;
      }
    }
    if (patch.address !== undefined) {
      settings.company.address =
        patch.address === null
          ? null
          : this.mergeAddress(settings.company.address, patch.address);
    }
  }

  private async applyDocumentsPatch(
    settings: AppSettingsDocument,
    patch: UpdateDocumentSettingsDto,
    organizationId: string,
  ) {
    this.ensureDocuments(settings);

    if (patch.estimate_number_prefix !== undefined) {
      const config = await this.documentNumbersService.setPrefix(
        organizationId,
        'estimate',
        patch.estimate_number_prefix,
      );
      settings.documents.estimate_number_prefix = config.prefix;
    }
    if (patch.invoice_number_prefix !== undefined) {
      const config = await this.documentNumbersService.setPrefix(
        organizationId,
        'invoice',
        patch.invoice_number_prefix,
      );
      settings.documents.invoice_number_prefix = config.prefix;
    }
    if (patch.estimate_next_number !== undefined) {
      await this.documentNumbersService.setNextNumber(
        organizationId,
        'estimate',
        patch.estimate_next_number,
      );
    }
    if (patch.invoice_next_number !== undefined) {
      await this.documentNumbersService.setNextNumber(
        organizationId,
        'invoice',
        patch.invoice_next_number,
      );
    }

    if (patch.default_payment_terms !== undefined) {
      settings.documents.default_payment_terms = patch.default_payment_terms;
    }
    if (patch.default_footer !== undefined) {
      settings.documents.default_footer = patch.default_footer;
    }
    if (patch.default_customer_notes !== undefined) {
      settings.documents.default_customer_notes = patch.default_customer_notes;
    }
    if (patch.default_estimate_expiration_days !== undefined) {
      settings.documents.default_estimate_expiration_days =
        patch.default_estimate_expiration_days;
    }
    if (patch.default_invoice_due_days !== undefined) {
      settings.documents.default_invoice_due_days =
        patch.default_invoice_due_days;
    }
    if (patch.default_deposit_basis_points !== undefined) {
      settings.documents.default_deposit_basis_points =
        patch.default_deposit_basis_points;
    }
    if (patch.default_show_client_signature !== undefined) {
      settings.documents.default_show_client_signature =
        patch.default_show_client_signature;
    }
    if (patch.default_show_company_signature !== undefined) {
      settings.documents.default_show_company_signature =
        patch.default_show_company_signature;
    }
    if (patch.default_estimate_email_message !== undefined) {
      settings.documents.default_estimate_email_message =
        patch.default_estimate_email_message;
    }
    if (patch.default_invoice_email_message !== undefined) {
      settings.documents.default_invoice_email_message =
        patch.default_invoice_email_message;
    }
  }

  private mergeAddress(
    existing: Address | null | undefined,
    patch: SettingsAddressDto,
  ): Address {
    const base = existing ?? {
      street: null,
      suite: null,
      city: null,
      state: null,
      postal_code: null,
      country: null,
    };
    return {
      street: patch.street !== undefined ? patch.street : (base.street ?? null),
      suite: patch.suite !== undefined ? patch.suite : (base.suite ?? null),
      city: patch.city !== undefined ? patch.city : (base.city ?? null),
      state: patch.state !== undefined ? patch.state : (base.state ?? null),
      postal_code:
        patch.postal_code !== undefined
          ? patch.postal_code
          : (base.postal_code ?? null),
      country:
        patch.country !== undefined ? patch.country : (base.country ?? null),
    };
  }

  private serializeAddress(address: Address | null | undefined) {
    if (!address) {
      return null;
    }
    return {
      street: address.street ?? null,
      suite: address.suite ?? null,
      city: address.city ?? null,
      state: address.state ?? null,
      postal_code: address.postal_code ?? null,
      country: address.country ?? null,
    };
  }

  private ensureNestedDefaults(settings: AppSettingsDocument) {
    this.ensureAccount(settings);
    this.ensureCompany(settings);
    this.ensureDocuments(settings);
    this.ensurePreferences(settings);
  }

  private ensureAccount(settings: AppSettingsDocument) {
    if (!settings.account) {
      settings.account = {
        first_name: null,
        last_name: null,
        email: null,
      } as AccountSettings;
    }
  }

  private ensureCompany(settings: AppSettingsDocument) {
    if (!settings.company) {
      settings.company = {
        legal_name: this.resolveDefaultCompanyName(),
        display_name: this.resolveDefaultCompanyName(),
        phone: null,
        email: null,
        website: null,
        industry: null,
        address: null,
        license_number: null,
        insurance_number: null,
        tax_id: null,
        logo_asset_id: null,
      } as CompanySettings;
    }
    if (
      !settings.company.legal_name?.trim() &&
      !settings.company.display_name?.trim()
    ) {
      const companyName = this.resolveDefaultCompanyName();
      settings.company.legal_name = companyName;
      settings.company.display_name = companyName;
    }
  }

  private ensureDocuments(settings: AppSettingsDocument) {
    if (!settings.documents) {
      settings.documents = {
        estimate_number_prefix: DEFAULT_NUMBER_PREFIX.estimate,
        invoice_number_prefix: DEFAULT_NUMBER_PREFIX.invoice,
        default_payment_terms: DEFAULT_PAYMENT_TERMS,
        default_footer: null,
        default_customer_notes: null,
        default_estimate_expiration_days: 30,
        default_invoice_due_days: 30,
        default_deposit_basis_points: 0,
        default_show_client_signature: false,
        default_show_company_signature: false,
        default_estimate_email_message: DEFAULT_ESTIMATE_EMAIL_MESSAGE,
        default_invoice_email_message: DEFAULT_INVOICE_EMAIL_MESSAGE,
      } as DocumentSettings;
    }
  }

  private ensurePreferences(settings: AppSettingsDocument) {
    if (!settings.preferences) {
      settings.preferences = {
        currency: 'usd',
        locale: 'en-US',
        email_on_estimate_approved: true,
        email_on_invoice_paid: true,
        email_on_estimate_viewed: true,
        email_on_invoice_viewed: false,
      } as PreferenceSettings;
    }
  }

  private assertValidTimeZone(value: string) {
    if (!this.isValidTimeZone(value)) {
      throw new BadRequestException('Invalid business timezone');
    }
  }

  private isValidTimeZone(value: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
      return true;
    } catch {
      return false;
    }
  }
}
