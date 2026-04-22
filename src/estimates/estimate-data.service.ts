import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  calculateEstimateTotals,
  calculateServiceTotals,
} from '../common/calculators/estimate-calculators';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import { PaidStatus } from '../common/enums/paid-status.enum';
import { PaymentType } from '../common/enums/payment-type.enum';
import { EstimateStatus } from '../common/enums/estimate-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import {
  ServiceCatalog,
  ServiceCatalogDocument,
} from '../service-catalog/schemas/service-catalog.schema';
import { type TagColor } from '../tags/tag-colors';
import { type TagScope } from '../tags/tag-scopes';
import { Tag, TagDocument } from '../tags/schemas/tag.schema';
import { prepareEmbeddedTags } from '../tags/tag-write';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Vehicle, VehicleDocument } from '../vehicles/schemas/vehicle.schema';
import { Estimate, EstimateDocument } from './schemas/estimate.schema';
import { EstimateDomainService } from './estimate-domain.service';

type ObjectIdLike = Types.ObjectId | string;

type EstimateServiceWriteInput = {
  canned_service_id?: string | null;
  name: string;
  note?: string | null;
  labor_lines: {
    description: string;
    assigned_user_id?: string | null;
    hours: number;
    rate: number;
    discount_percent?: number;
    is_completed?: boolean;
    tags?: Array<{
      id?: string | null;
      scope: TagScope;
      name: string;
      color: TagColor;
    }>;
  }[];
  part_lines: {
    name: string;
    part_number?: string | null;
    quantity: number;
    cost?: number | null;
    price: number;
    discount_percent?: number;
    tags?: Array<{
      id?: string | null;
      scope: TagScope;
      name: string;
      color: TagColor;
    }>;
  }[];
};

type EstimateSourceMetadataWriteInput = {
  source_system?: string;
  document_kind?: string | null;
  external_order_id?: string | null;
  external_reference_number?: string | null;
  external_invoice_number?: string | null;
  order_path?: string | null;
  shop_timezone?: string | null;
  source_state_label?: string | null;
  invoice_status?: string | null;
  appointment_status?: string | null;
  created_at_shop_time?: string | null;
  invoiced_at_shop_time?: string | null;
};

type EstimateWriteInput = {
  title: string;
  customer_id: ObjectIdLike;
  vehicle_id: ObjectIdLike;
  scheduled_start?: Date | null;
  scheduled_end?: Date | null;
  assigned_user_id?: ObjectIdLike | null;
  complaint_or_request?: string | null;
  notes?: string | null;
  estimate_status?: EstimateStatus;
  payment_status?: PaidStatus;
  payment_type?: PaymentType;
  due_date?: Date | null;
  source_metadata?: EstimateSourceMetadataWriteInput | null;
  services: EstimateServiceWriteInput[];
};

const LABOR_ASSIGNABLE_ROLES = new Set<UserRole>([
  UserRole.TECHNICIAN,
  UserRole.ADMIN,
]);

@Injectable()
export class EstimateDataService {
  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Vehicle.name)
    private readonly vehicleModel: Model<VehicleDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(ServiceCatalog.name)
    private readonly serviceModel: Model<ServiceCatalogDocument>,
    @InjectModel(Estimate.name)
    private readonly estimateModel: Model<EstimateDocument>,
    @InjectModel(Tag.name)
    private readonly tagModel: Model<TagDocument> = {} as never,
    private readonly estimateDomainService: EstimateDomainService,
  ) {}

  async createEstimate(
    input: EstimateWriteInput & { estimate_number: string },
  ) {
    const prepared = await this.prepareEstimateWrite(input);
    const normalizedTitle = this.normalizeEstimateTitle(input.title);

    return this.estimateModel.create({
      estimate_number: input.estimate_number,
      title: normalizedTitle,
      customer_id: prepared.customer._id,
      vehicle_id: prepared.vehicle._id,
      scheduled_start: prepared.scheduledStart,
      scheduled_end: prepared.scheduledEnd,
      assigned_user_id: prepared.assignedUser?._id ?? null,
      complaint_or_request: input.complaint_or_request ?? null,
      notes: input.notes ?? null,
      estimate_status: input.estimate_status ?? EstimateStatus.SCHEDULED,
      payment_status: input.payment_status ?? PaidStatus.UNPAID,
      payment_type: input.payment_type ?? PaymentType.POS_CARD,
      due_date: input.due_date ?? null,
      source_metadata: this.normalizeSourceMetadata(input.source_metadata),
      services: prepared.services,
      labor_total: prepared.labor_total,
      parts_total: prepared.parts_total,
      subtotal: prepared.subtotal,
      tax_rate: prepared.tax_rate,
      tax_amount: prepared.tax_amount,
      total: prepared.total,
    });
  }

  async applyEstimateUpdate(
    estimate: EstimateDocument,
    input: EstimateWriteInput,
  ): Promise<EstimateDocument> {
    const prepared = await this.prepareEstimateWrite(
      {
        ...input,
        title: input.title,
      },
      String(estimate._id),
      estimate,
    );

    estimate.title = this.normalizeEstimateTitle(input.title);
    estimate.customer_id = prepared.customer._id;
    estimate.vehicle_id = prepared.vehicle._id;
    estimate.scheduled_start = prepared.scheduledStart;
    estimate.scheduled_end = prepared.scheduledEnd;
    estimate.assigned_user_id = prepared.assignedUser?._id ?? null;
    estimate.complaint_or_request = input.complaint_or_request ?? null;
    estimate.notes = input.notes ?? null;
    estimate.payment_type = input.payment_type ?? estimate.payment_type;
    estimate.due_date = input.due_date ?? null;
    estimate.services = prepared.services;
    estimate.labor_total = prepared.labor_total;
    estimate.parts_total = prepared.parts_total;
    estimate.subtotal = prepared.subtotal;
    estimate.tax_rate = prepared.tax_rate;
    estimate.tax_amount = prepared.tax_amount;
    estimate.total = prepared.total;

    await estimate.save();
    return estimate;
  }

  private normalizeEstimateTitle(value: string) {
    return value.trim().toUpperCase();
  }

  private normalizeSourceMetadata(
    metadata?: EstimateSourceMetadataWriteInput | null,
  ) {
    if (!metadata) {
      return null;
    }

    const normalize = (value?: string | null) => {
      if (typeof value !== 'string') {
        return null;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    return {
      source_system: normalize(metadata.source_system) ?? 'shopmonkey',
      document_kind: normalize(metadata.document_kind),
      external_order_id: normalize(metadata.external_order_id),
      external_reference_number: normalize(metadata.external_reference_number),
      external_invoice_number: normalize(metadata.external_invoice_number),
      order_path: normalize(metadata.order_path),
      shop_timezone: normalize(metadata.shop_timezone),
      source_state_label: normalize(metadata.source_state_label),
      invoice_status: normalize(metadata.invoice_status),
      appointment_status: normalize(metadata.appointment_status),
      created_at_shop_time: normalize(metadata.created_at_shop_time),
      invoiced_at_shop_time: normalize(metadata.invoiced_at_shop_time),
    };
  }

  private async prepareEstimateWrite(
    input: EstimateWriteInput,
    estimateId?: string,
    currentEstimate?: EstimateDocument,
  ) {
    if (input.services.length === 0) {
      throw new BadRequestException('At least one service is required');
    }

    const customer = await this.customerModel
      .findById(input.customer_id)
      .exec();
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    const isCurrentCustomer =
      currentEstimate &&
      String(currentEstimate.customer_id) === String(customer._id);
    if (customer.is_archived === true && !isCurrentCustomer) {
      throw new BadRequestException(
        'Archived customers cannot be assigned to estimates.',
      );
    }

    const vehicle = await this.vehicleModel.findById(input.vehicle_id).exec();
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    const isCurrentVehicle =
      currentEstimate &&
      String(currentEstimate.vehicle_id) === String(vehicle._id);
    if (vehicle.is_archived === true && !isCurrentVehicle) {
      throw new BadRequestException(
        'Archived vehicles cannot be assigned to estimates.',
      );
    }

    if (
      !this.estimateDomainService.vehicleBelongsToCustomer(
        String(customer._id),
        String(vehicle.customer_id),
      )
    ) {
      throw new BadRequestException('Vehicle does not belong to customer');
    }

    const scheduledStart = input.scheduled_start ?? null;
    const scheduledEnd = input.scheduled_end ?? null;
    this.estimateDomainService.assertValidScheduleRange(
      scheduledStart,
      scheduledEnd,
    );

    let assignedUser: UserDocument | null = null;
    if (input.assigned_user_id) {
      assignedUser = await this.userModel
        .findById(input.assigned_user_id)
        .exec();
      if (!assignedUser) {
        throw new NotFoundException('Assigned user not found');
      }
      if (!assignedUser.is_active) {
        throw new ConflictException('Assigned user is inactive');
      }

      const existingEstimates = await this.estimateModel
        .find(
          {
            assigned_user_id: assignedUser._id,
            estimate_status: {
              $in: [
                EstimateStatus.SCHEDULED,
                EstimateStatus.CHECKED_IN,
                EstimateStatus.IN_PROGRESS,
              ],
            },
          },
          {
            _id: 1,
            assigned_user_id: 1,
            scheduled_start: 1,
            scheduled_end: 1,
            estimate_status: 1,
          },
        )
        .exec();

      const hasConflict = this.estimateDomainService.hasAssignedUserConflict({
        estimateId,
        assignedUserId: String(assignedUser._id),
        scheduledStart,
        scheduledEnd,
        existingEstimates: existingEstimates.map((existingEstimate) => ({
          id: String(existingEstimate._id),
          assignedUserId: existingEstimate.assigned_user_id
            ? String(existingEstimate.assigned_user_id)
            : null,
          scheduledStart: existingEstimate.scheduled_start,
          scheduledEnd: existingEstimate.scheduled_end,
          estimateStatus: existingEstimate.estimate_status,
        })),
      });

      if (hasConflict) {
        throw new ConflictException('Assigned user has a schedule conflict');
      }
    }

    const services = await this.prepareServices(
      input.services,
      currentEstimate,
    );
    const totals = calculateEstimateTotals(services);

    return {
      customer,
      vehicle,
      assignedUser,
      scheduledStart,
      scheduledEnd,
      services,
      ...totals,
    };
  }

  private async prepareServices(
    services: EstimateServiceWriteInput[],
    currentEstimate?: EstimateDocument,
  ) {
    const templateIds = Array.from(
      new Set(
        services
          .map((service) => service.canned_service_id)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const templates = templateIds.length
      ? await this.serviceModel
          .find({ _id: { $in: templateIds } })
          .select({ _id: 1, name: 1, is_active: 1 })
          .exec()
      : [];
    const templatesById = new Map(
      templates.map((template) => [String(template._id), template]),
    );
    const currentTemplateIds = new Set(
      currentEstimate?.services
        .map((service) =>
          service.canned_service_id ? String(service.canned_service_id) : null,
        )
        .filter((value): value is string => Boolean(value)) ?? [],
    );
    const assignedTechnicianIds = Array.from(
      new Set(
        services.flatMap((service) =>
          service.labor_lines
            .map((line) => line.assigned_user_id?.trim() ?? null)
            .filter((value): value is string => Boolean(value)),
        ),
      ),
    );
    const technicians = assignedTechnicianIds.length
      ? await this.userModel
          .find({ _id: { $in: assignedTechnicianIds } })
          .select({ _id: 1, is_active: 1, role: 1 })
          .exec()
      : [];
    const techniciansById = new Map(
      technicians.map((technician) => [String(technician._id), technician]),
    );
    const currentLaborTechnicianIds = new Set(
      currentEstimate?.services
        .flatMap((service) =>
          service.labor_lines.map((line) =>
            line.assigned_user_id ? String(line.assigned_user_id) : null,
          ),
        )
        .filter((value): value is string => Boolean(value)) ?? [],
    );

    return Promise.all(
      services.map(async (service) => {
        if (
          service.labor_lines.length === 0 &&
          service.part_lines.length === 0
        ) {
          throw new BadRequestException(
            'Each service must include at least one labor or part row.',
          );
        }

        const template = service.canned_service_id
          ? templatesById.get(service.canned_service_id)
          : null;

        if (service.canned_service_id && !template) {
          throw new NotFoundException('Service template not found');
        }

        if (
          template?.is_active === false &&
          !currentTemplateIds.has(String(template._id))
        ) {
          throw new BadRequestException(
            'Inactive canned services cannot be attached to estimates.',
          );
        }

        const name = service.name.trim() || template?.name?.trim() || '';
        if (!name) {
          throw new BadRequestException('Service name is required');
        }
        const note =
          service.note !== undefined
            ? (service.note ?? null)
            : (template?.note ?? null);

        const preparedLaborTags = await Promise.all(
          service.labor_lines.map((line) =>
            prepareEmbeddedTags(this.tagModel, line.tags, 'LABOR'),
          ),
        );
        const preparedPartTags = await Promise.all(
          service.part_lines.map((line) =>
            prepareEmbeddedTags(this.tagModel, line.tags, 'PART'),
          ),
        );

        const totals = calculateServiceTotals({
          laborLines: service.labor_lines.map((line, index) => ({
            assignedUserId: this.resolveLaborTechnicianId({
              assignedUserId: line.assigned_user_id,
              techniciansById,
              currentLaborTechnicianIds,
            }),
            description: line.description,
            hours: line.hours,
            rate: line.rate,
            discountPercent: line.discount_percent ?? 0,
            isCompleted: line.is_completed ?? false,
            tags: preparedLaborTags[index].map((tag) => ({
              id: tag.tag_id ? String(tag.tag_id) : null,
              scope: tag.scope,
              name: tag.name,
              color: tag.color,
            })),
          })),
          partLines: service.part_lines.map((line, index) => ({
            name: line.name,
            partNumber: line.part_number ?? null,
            quantity: line.quantity,
            cost: line.cost ?? null,
            price: line.price,
            discountPercent: line.discount_percent ?? 0,
            tags: preparedPartTags[index].map((tag) => ({
              id: tag.tag_id ? String(tag.tag_id) : null,
              scope: tag.scope,
              name: tag.name,
              color: tag.color,
            })),
          })),
        });

        return {
          canned_service_id: template?._id ?? null,
          name,
          note,
          labor_lines: totals.labor_lines.map((line) => ({
            ...line,
            assigned_user_id: line.assigned_user_id
              ? new Types.ObjectId(line.assigned_user_id)
              : null,
            tags: line.tags.map((tag) => ({
              tag_id: tag.tag_id ? new Types.ObjectId(tag.tag_id) : null,
              scope: tag.scope,
              name: tag.name,
              color: tag.color,
            })),
          })),
          part_lines: totals.part_lines.map((line) => ({
            ...line,
            tags: line.tags.map((tag) => ({
              tag_id: tag.tag_id ? new Types.ObjectId(tag.tag_id) : null,
              scope: tag.scope,
              name: tag.name,
              color: tag.color,
            })),
          })),
          labor_total: totals.labor_total,
          parts_total: totals.parts_total,
          total: totals.total,
        };
      }),
    );
  }

  private resolveLaborTechnicianId(input: {
    assignedUserId?: string | null;
    techniciansById: Map<
      string,
      Pick<UserDocument, '_id' | 'is_active' | 'role'>
    >;
    currentLaborTechnicianIds: Set<string>;
  }) {
    const normalizedId = input.assignedUserId?.trim() ?? '';
    if (!normalizedId) {
      return null;
    }
    const isCurrentAssignment =
      input.currentLaborTechnicianIds.has(normalizedId);

    const technician = input.techniciansById.get(normalizedId);
    if (!technician) {
      throw new NotFoundException('Labor technician not found');
    }
    if (
      !LABOR_ASSIGNABLE_ROLES.has(technician.role as UserRole) &&
      !isCurrentAssignment
    ) {
      throw new BadRequestException(
        'Only technician-capable staff can be assigned to labor lines.',
      );
    }
    if (!technician.is_active && !isCurrentAssignment) {
      throw new ConflictException('Assigned labor technician is inactive');
    }

    return String(technician._id);
  }
}
