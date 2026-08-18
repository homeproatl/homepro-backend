import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditLog,
  AuditLogDocument,
} from '../audit-logs/schemas/audit-log.schema';
import { ClientContract } from '../common/contracts/domain.contract';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import {
  OrgDocument,
  OrgDocumentDocument,
} from '../documents/schemas/document.schema';
import {
  assertClientHasIdentity,
  assertClientPhonesAreDistinct,
  buildClientContactKeys,
  buildDisplayName,
  buildSearchFields,
  normalizeAddress,
  normalizeAddressList,
  normalizePhoneSearch,
  normalizeSearchText,
} from './client-normalization';
import { CreateClientDto } from './dto/create-client.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import {
  CLIENT_FIELD_LIMITS,
  Client,
  ClientDocument,
} from './schemas/client.schema';

@Injectable()
export class ClientsService {
  constructor(
    @InjectModel(Client.name)
    private readonly clientModel: Model<ClientDocument>,
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async create(payload: CreateClientDto, organizationId: string) {
    assertClientHasIdentity(payload);
    assertClientPhonesAreDistinct(payload);
    const fields = this.buildPersistedFields(payload);
    await this.assertContactsAvailable(fields.contact_keys, organizationId);
    let client: ClientDocument;
    try {
      client = await this.clientModel.create({
        organization_id: asObjectId(organizationId, 'organization id'),
        ...fields,
        is_archived: false,
      });
    } catch (error) {
      this.rethrowDuplicateContact(error);
    }
    return this.toClientContract(client);
  }

  async findAll(query: ListClientsQueryDto = {}, organizationId: string) {
    const searchQuery = this.buildListQuery(query, organizationId);
    const clients = await this.clientModel
      .find(searchQuery)
      .sort({ is_archived: 1, created_at: -1, _id: -1 })
      .exec();
    return clients.map((client) => this.toClientContract(client));
  }

  async findPage(query: ListClientsQueryDto = {}, organizationId: string) {
    const searchQuery = this.buildListQuery(query, organizationId);
    const requestedPage = query.page ?? 1;
    const pageSize = Math.min(
      query.page_size ?? 25,
      CLIENT_FIELD_LIMITS.page_size_max,
    );

    const total = await this.clientModel.countDocuments(searchQuery).exec();
    const pageCount = total === 0 ? 1 : Math.ceil(total / pageSize);
    const page = Math.min(Math.max(requestedPage, 1), pageCount);
    const skip = (page - 1) * pageSize;

    const clients = await this.clientModel
      .find(searchQuery)
      .sort({ is_archived: 1, created_at: -1, _id: -1 })
      .skip(skip)
      .limit(pageSize)
      .exec();

    return {
      items: clients.map((client) => this.toClientContract(client)),
      total,
      page,
      page_size: pageSize,
      page_count: pageCount,
    };
  }

  async findById(id: string, organizationId: string): Promise<ClientContract> {
    const client = await this.findClientDocumentById(id, organizationId);
    return this.toClientContract(client);
  }

  async update(
    id: string,
    payload: UpdateClientDto,
    organizationId: string,
  ): Promise<ClientContract> {
    const client = await this.findClientDocumentById(id, organizationId);
    const next = {
      display_name:
        payload.display_name !== undefined
          ? payload.display_name
          : client.display_name,
      first_name:
        payload.first_name !== undefined
          ? payload.first_name
          : client.first_name,
      last_name:
        payload.last_name !== undefined ? payload.last_name : client.last_name,
      company_name:
        payload.company_name !== undefined
          ? payload.company_name
          : client.company_name,
      phone: payload.phone !== undefined ? payload.phone : client.phone,
      secondary_phone:
        payload.secondary_phone !== undefined
          ? payload.secondary_phone
          : client.secondary_phone,
      email: payload.email !== undefined ? payload.email : client.email,
      billing_address:
        payload.billing_address !== undefined
          ? normalizeAddress(payload.billing_address)
          : client.billing_address,
      service_addresses:
        payload.service_addresses !== undefined
          ? normalizeAddressList(payload.service_addresses)
          : client.service_addresses,
      notes: payload.notes !== undefined ? payload.notes : client.notes,
    };

    assertClientHasIdentity(next);
    assertClientPhonesAreDistinct(next);
    const fields = this.buildPersistedFields(next);
    await this.assertContactsAvailable(
      fields.contact_keys,
      organizationId,
      String(client._id),
    );
    Object.assign(client, fields);
    client.markModified('billing_address');
    client.markModified('service_addresses');
    try {
      await client.save();
    } catch (error) {
      this.rethrowDuplicateContact(error);
    }
    return this.toClientContract(client);
  }

  async archive(
    id: string,
    organizationId: string,
    actorUserId?: string,
  ): Promise<ClientContract> {
    const client = await this.findClientDocumentById(id, organizationId);
    if (client.is_archived === true) {
      return this.toClientContract(client);
    }

    const before = client.toObject();
    client.is_archived = true;
    await client.save();

    await this.recordAudit({
      organizationId,
      actorUserId,
      entityType: 'client',
      entityId: String(client._id),
      action: 'client.archived',
      before,
      after: client.toObject(),
    });

    return this.toClientContract(client);
  }

  async unarchive(
    id: string,
    organizationId: string,
    actorUserId?: string,
  ): Promise<ClientContract> {
    const client = await this.findClientDocumentById(id, organizationId);
    if (client.is_archived !== true) {
      return this.toClientContract(client);
    }

    const before = client.toObject();
    client.is_archived = false;
    await client.save();

    await this.recordAudit({
      organizationId,
      actorUserId,
      entityType: 'client',
      entityId: String(client._id),
      action: 'client.unarchived',
      before,
      after: client.toObject(),
    });

    return this.toClientContract(client);
  }

  async remove(id: string, organizationId: string, actorUserId?: string) {
    const client = await this.findClientDocumentById(id, organizationId);
    const before = client.toObject();
    const documentReferenceFilter = withOrganizationScope(organizationId, {
      client_id: client._id,
    });
    const documentCount = await this.documentModel
      .countDocuments(documentReferenceFilter)
      .exec();

    if (documentCount > 0) {
      throw new ConflictException(
        `Client cannot be deleted while ${documentCount} document${documentCount === 1 ? '' : 's'} still reference this client. Archive the client instead.`,
      );
    }

    await this.clientModel
      .deleteOne(
        withOrganizationScope(organizationId, {
          _id: client._id,
        }),
      )
      .exec();

    await this.recordAudit({
      organizationId,
      actorUserId,
      entityType: 'client',
      entityId: String(client._id),
      action: 'client.deleted',
      before,
      after: null,
    });

    return { deleted: true };
  }

  private buildPersistedFields(
    payload: CreateClientDto | UpdateClientDto | Record<string, unknown>,
  ) {
    const first_name =
      typeof payload.first_name === 'string' || payload.first_name === null
        ? payload.first_name
        : null;
    const last_name =
      typeof payload.last_name === 'string' || payload.last_name === null
        ? payload.last_name
        : null;
    const company_name =
      typeof payload.company_name === 'string' || payload.company_name === null
        ? payload.company_name
        : null;
    const phone =
      typeof payload.phone === 'string' || payload.phone === null
        ? payload.phone
        : null;
    const secondary_phone =
      typeof payload.secondary_phone === 'string' ||
      payload.secondary_phone === null
        ? payload.secondary_phone
        : null;
    const email =
      typeof payload.email === 'string'
        ? payload.email.toLowerCase()
        : payload.email === null
          ? null
          : null;
    const billing_address = normalizeAddress(
      (payload.billing_address as CreateClientDto['billing_address']) ?? null,
    );
    const service_addresses = normalizeAddressList(
      (payload.service_addresses as CreateClientDto['service_addresses']) ?? [],
    );
    const notes =
      typeof payload.notes === 'string' || payload.notes === null
        ? payload.notes
        : null;

    const display_name = buildDisplayName({
      display_name:
        typeof payload.display_name === 'string' ||
        payload.display_name === null
          ? payload.display_name
          : null,
      first_name,
      last_name,
      company_name,
      phone,
      email,
    });

    const search = buildSearchFields({
      display_name,
      first_name,
      last_name,
      company_name,
      phone,
      secondary_phone,
      email,
      billing_address,
      service_addresses,
    });

    return {
      display_name,
      first_name,
      last_name,
      company_name,
      phone,
      secondary_phone,
      email,
      billing_address,
      service_addresses,
      notes,
      contact_keys: buildClientContactKeys({
        email,
        phone,
        secondary_phone,
      }),
      ...search,
    };
  }

  private async assertContactsAvailable(
    contactKeys: string[],
    organizationId: string,
    excludedClientId?: string,
  ) {
    if (contactKeys.length === 0) return;

    const emailKey = contactKeys.find((key) => key.startsWith('email:'));
    const phoneKeys = contactKeys.filter((key) => key.startsWith('phone:'));
    const collision = await this.clientModel
      .findOne(
        withOrganizationScope(organizationId, {
          ...(excludedClientId
            ? { _id: { $ne: asObjectId(excludedClientId, 'client id') } }
            : {}),
          $or: [
            { contact_keys: { $in: contactKeys } },
            ...(emailKey
              ? [
                  {
                    search_email: normalizeSearchText(emailKey.slice(6)),
                  },
                ]
              : []),
            ...phoneKeys.flatMap((key) => {
              const phone = key.slice(6);
              return [
                { search_phone: phone },
                { search_secondary_phone: phone },
              ];
            }),
          ],
        }),
      )
      .select({ display_name: 1, contact_keys: 1, search_email: 1 })
      .exec();
    if (!collision) return;

    const field =
      emailKey && (collision.contact_keys ?? []).includes(emailKey)
        ? 'email'
        : emailKey &&
            collision.search_email === normalizeSearchText(emailKey.slice(6))
          ? 'email'
          : 'phone';
    throw new ConflictException({
      code: 'CLIENT_CONTACT_EXISTS',
      field,
      message: `Another client already uses this ${field}.`,
      existing_client_id: String(collision._id),
      existing_client_name: collision.display_name,
    });
  }

  private rethrowDuplicateContact(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    ) {
      throw new ConflictException({
        code: 'CLIENT_CONTACT_EXISTS',
        message: 'Another client already uses this email or phone.',
      });
    }
    throw error;
  }

  private async recordAudit(input: {
    organizationId: string;
    actorUserId?: string;
    entityType: string;
    entityId: string;
    action: string;
    before: object | null;
    after: object | null;
  }) {
    await this.auditLogModel.create({
      organization_id: asObjectId(input.organizationId, 'organization id'),
      actor_user_id: input.actorUserId
        ? asObjectId(input.actorUserId, 'actor user id')
        : null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      before_json: input.before as Record<string, unknown> | null,
      after_json: input.after as Record<string, unknown> | null,
    });
  }

  private async findClientDocumentById(id: string, organizationId: string) {
    const client = await this.clientModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(id, 'client id'),
        }),
      )
      .exec();
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  private toClientContract(client: ClientDocument): ClientContract {
    return {
      id: String(client._id),
      display_name: client.display_name,
      first_name: client.first_name ?? null,
      last_name: client.last_name ?? null,
      company_name: client.company_name ?? null,
      phone: client.phone ?? null,
      secondary_phone: client.secondary_phone ?? null,
      email: client.email ?? null,
      billing_address: client.billing_address
        ? {
            street: client.billing_address.street ?? null,
            suite: client.billing_address.suite ?? null,
            city: client.billing_address.city ?? null,
            state: client.billing_address.state ?? null,
            postal_code: client.billing_address.postal_code ?? null,
            country: client.billing_address.country ?? null,
          }
        : null,
      service_addresses: (client.service_addresses ?? []).map((address) => ({
        street: address.street ?? null,
        suite: address.suite ?? null,
        city: address.city ?? null,
        state: address.state ?? null,
        postal_code: address.postal_code ?? null,
        country: address.country ?? null,
      })),
      notes: client.notes ?? null,
      is_archived: client.is_archived === true,
      created_at: this.toIsoString(client.created_at) ?? '',
      updated_at: this.toIsoString(client.updated_at) ?? '',
    };
  }

  private toIsoString(value?: Date) {
    return value?.toISOString();
  }

  private buildListQuery(query: ListClientsQueryDto, organizationId: string) {
    const searchQuery = this.buildSearchQuery(query.search);
    const scoped = withOrganizationScope(organizationId, searchQuery);
    if (query.is_archived === undefined) {
      return scoped;
    }
    return {
      ...scoped,
      is_archived: query.is_archived,
    };
  }

  private buildSearchQuery(search?: string) {
    if (!search) {
      return {};
    }

    const searchTokens = search
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .slice(0, CLIENT_FIELD_LIMITS.search_token_max);

    if (searchTokens.length === 0) {
      return {};
    }

    return {
      $and: searchTokens.map((token) => {
        const text = normalizeSearchText(token);
        const phone = normalizePhoneSearch(token);
        const pattern = new RegExp(this.escapeRegExp(text || token), 'i');
        const clauses: Array<Record<string, unknown>> = [
          { display_name: pattern },
          { first_name: pattern },
          { last_name: pattern },
          { company_name: pattern },
          { email: pattern },
          { phone: pattern },
          { secondary_phone: pattern },
          { search_name: pattern },
          { search_company: pattern },
          { search_email: pattern },
          { search_addresses: pattern },
          { 'billing_address.street': pattern },
          { 'billing_address.city': pattern },
          { 'billing_address.state': pattern },
          { 'billing_address.postal_code': pattern },
          { 'service_addresses.street': pattern },
          { 'service_addresses.city': pattern },
          { 'service_addresses.state': pattern },
          { 'service_addresses.postal_code': pattern },
        ];
        if (phone) {
          clauses.push(
            { search_phone: new RegExp(this.escapeRegExp(phone)) },
            { search_secondary_phone: new RegExp(this.escapeRegExp(phone)) },
          );
        }
        return { $or: clauses };
      }),
    };
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
