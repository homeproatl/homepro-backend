import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from './schemas/organization.schema';

export const FIXED_COMPANY_SLUG = 'joseph-company';

export type OrganizationContract = {
  id: string;
  name: string;
  normalized_slug: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    private readonly configService: ConfigService,
  ) {}

  normalizeSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  resolveCompanyName(): string {
    return (
      this.configService.get<string>('COMPANY_ORGANIZATION_NAME')?.trim() ||
      this.configService.get<string>('OWNER_ADMIN_NAME')?.trim() ||
      'Home Pro'
    );
  }

  /**
   * Idempotent single-company bootstrap.
   * Production must never create a second organization.
   */
  async ensureFixedCompany(options?: {
    allowTestSecondOrg?: boolean;
    name?: string;
    slug?: string;
  }): Promise<OrganizationDocument> {
    const slug = this.normalizeSlug(options?.slug ?? FIXED_COMPANY_SLUG);
    const name = options?.name?.trim() || this.resolveCompanyName();

    const existingBySlug = await this.organizationModel
      .findOne({ normalized_slug: slug })
      .exec();
    if (existingBySlug) {
      let needsSave = false;
      if (existingBySlug.name !== name) {
        existingBySlug.name = name;
        needsSave = true;
      }
      if (!existingBySlug.is_active) {
        existingBySlug.is_active = true;
        needsSave = true;
      }
      if (needsSave) {
        await existingBySlug.save();
      }
      return existingBySlug;
    }

    const existingCount = await this.organizationModel.countDocuments().exec();
    if (existingCount > 0 && !options?.allowTestSecondOrg) {
      throw new ConflictException(
        'A company organization already exists. Production bootstrap refuses to create a second organization.',
      );
    }

    return this.organizationModel.create({
      name,
      normalized_slug: slug,
      is_active: true,
    });
  }

  /**
   * Test-only helper. Never used by production bootstrap/seed paths.
   */
  async createSyntheticTestOrganization(input: {
    name: string;
    slug: string;
  }): Promise<OrganizationDocument> {
    return this.ensureFixedCompany({
      allowTestSecondOrg: true,
      name: input.name,
      slug: input.slug,
    });
  }

  async findById(id: string): Promise<OrganizationDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return this.organizationModel.findById(id).exec();
  }

  async requireActiveOrganization(id: string): Promise<OrganizationDocument> {
    const organization = await this.findById(id);
    if (!organization) {
      throw new UnauthorizedException('Company ownership is missing');
    }
    if (!organization.is_active) {
      throw new UnauthorizedException('Company ownership is inactive');
    }
    return organization;
  }

  async requireFixedCompany(): Promise<OrganizationDocument> {
    const organization = await this.organizationModel
      .findOne({ normalized_slug: FIXED_COMPANY_SLUG })
      .exec();
    if (!organization) {
      throw new NotFoundException(
        'Fixed company organization has not been bootstrapped',
      );
    }
    return organization;
  }

  toContract(organization: OrganizationDocument): OrganizationContract {
    return {
      id: String(organization._id),
      name: organization.name,
      normalized_slug: organization.normalized_slug,
      is_active: organization.is_active,
      created_at: organization.created_at?.toISOString?.(),
      updated_at: organization.updated_at?.toISOString?.(),
    };
  }
}
