import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { ConflictException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import {
  Customer,
  CustomerDocument,
} from '../src/customers/schemas/customer.schema';
import {
  Estimate,
  EstimateDocument,
} from '../src/estimates/schemas/estimate.schema';
import { EstimatesService } from '../src/estimates/estimates.service';
import { EstimateStatus } from '../src/common/enums/estimate-status.enum';
import { PaidStatus } from '../src/common/enums/paid-status.enum';
import { PaymentType } from '../src/common/enums/payment-type.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ServiceCatalogService } from '../src/service-catalog/service-catalog.service';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import {
  Vehicle,
  VehicleDocument,
} from '../src/vehicles/schemas/vehicle.schema';

type ShopmonkeyCustomerInput = {
  first_name: string;
  last_name: string;
  phone: string;
  email?: string | null;
};

type ShopmonkeyVehicleInput = {
  year: number | null;
  make: string;
  model: string;
  sub_model?: string | null;
  vin?: string | null;
  license_plate?: string | null;
  mileage?: number | null;
  color?: string | null;
};

type ShopmonkeyLineTagInput = {
  id?: string | null;
  scope: 'LABOR' | 'PART';
  name: string;
  color:
    | 'slate'
    | 'red'
    | 'orange'
    | 'amber'
    | 'green'
    | 'emerald'
    | 'blue'
    | 'violet';
};

type ShopmonkeyLaborLineInput = {
  description: string;
  assigned_user_id?: string | null;
  assigned_user_email?: string | null;
  hours: number;
  rate: number;
  discount_percent?: number;
  is_completed?: boolean;
  tags?: ShopmonkeyLineTagInput[];
};

type ShopmonkeyPartLineInput = {
  name: string;
  part_number?: string | null;
  quantity: number;
  cost?: number | null;
  price: number;
  discount_percent?: number;
  tags?: ShopmonkeyLineTagInput[];
};

type ShopmonkeyServiceInput = {
  canned_service_name: string;
  estimate_service_name?: string;
  note?: string | null;
  source_displayed_total?: number | null;
  labor_lines: ShopmonkeyLaborLineInput[];
  part_lines: ShopmonkeyPartLineInput[];
};

type ShopmonkeyPasteImportInput = {
  external_order_id: string;
  external_reference_number: string;
  external_invoice_number?: string | null;
  order_path?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  document_kind?: string | null;
  shop_timezone?: string | null;
  source_state_label?: string | null;
  invoice_status?: string | null;
  appointment_status?: string | null;
  created_at_shop_time?: string | null;
  invoiced_at_shop_time?: string | null;
  title: string;
  customer: ShopmonkeyCustomerInput;
  vehicle: ShopmonkeyVehicleInput;
  assigned_user_id?: string | null;
  assigned_user_email?: string | null;
  estimate_status?: EstimateStatus;
  payment_status?: PaidStatus;
  payment_type?: PaymentType;
  source_grand_total?: number | null;
  customer_comments?: string | null;
  recommendations?: string | null;
  services: ShopmonkeyServiceInput[];
};

type ImportContext = {
  userModel: Model<UserDocument>;
  customerModel: Model<CustomerDocument>;
  vehicleModel: Model<VehicleDocument>;
  estimateModel: Model<EstimateDocument>;
  serviceCatalogService: ServiceCatalogService;
  estimatesService: EstimatesService;
};

type ServiceFinancials = {
  mappedTotal: number;
  sourceTotal: number;
  feeDelta: number;
};

const IMPORTED_FEE_PART_NAME = 'IMPORTED SHOP SUPPLIES / EPA / FEES';
const CURRENCY_TOLERANCE = 0.01;
const MAX_BATCH_SIZE = 25;
const TAG_COLORS = [
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'emerald',
  'blue',
  'violet',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStdin() {
  return new Promise<string>((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function requireString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string or null.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNumber(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number.`);
  }
  return value;
}

function optionalNumber(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number or null.`);
  }
  return value;
}

function optionalBoolean(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean or null.`);
  }
  return value;
}

function optionalEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T,
) {
  const value = optionalString(input, key);
  if (value === null) {
    return fallback;
  }
  if (!values.includes(value as T)) {
    throw new Error(`${key} must be one of: ${values.join(', ')}.`);
  }
  return value as T;
}

function requireArray(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array.`);
  }
  return value;
}

function parseTags(value: unknown, expectedScope: 'LABOR' | 'PART') {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${expectedScope} tags must be an array.`);
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(
        `${expectedScope} tag at index ${index} must be an object.`,
      );
    }
    const scope = requireString(item, 'scope');
    if (scope !== expectedScope) {
      throw new Error(
        `${expectedScope} tag at index ${index} has invalid scope ${scope}.`,
      );
    }
    const color = requireString(
      item,
      'color',
    ) as ShopmonkeyLineTagInput['color'];
    if (!TAG_COLORS.includes(color)) {
      throw new Error(
        `${expectedScope} tag at index ${index} has invalid color ${color}.`,
      );
    }
    return {
      id: optionalString(item, 'id'),
      scope,
      name: requireString(item, 'name'),
      color,
    };
  });
}

function parseOneInput(
  parsed: Record<string, unknown>,
  contextLabel: string,
): ShopmonkeyPasteImportInput {
  const customer = parsed.customer;
  if (!isRecord(customer)) {
    throw new Error(`${contextLabel}.customer is required.`);
  }

  const vehicle = parsed.vehicle;
  if (!isRecord(vehicle)) {
    throw new Error(`${contextLabel}.vehicle is required.`);
  }

  const rawServices = requireArray(parsed, 'services');
  if (rawServices.length === 0) {
    throw new Error(`${contextLabel}.services must contain at least one service.`);
  }

  const services = rawServices.map(
    (service, serviceIndex) => {
      if (!isRecord(service)) {
        throw new Error(
          `${contextLabel}.services[${serviceIndex}] must be an object.`,
        );
      }

      const laborLines = requireArray(service, 'labor_lines').map(
        (line, lineIndex) => {
          if (!isRecord(line)) {
            throw new Error(
              `${contextLabel}.services[${serviceIndex}].labor_lines[${lineIndex}] must be an object.`,
            );
          }
          return {
            description: requireString(line, 'description'),
            assigned_user_id: optionalString(line, 'assigned_user_id'),
            assigned_user_email: optionalString(line, 'assigned_user_email'),
            hours: requireNumber(line, 'hours'),
            rate: requireNumber(line, 'rate'),
            discount_percent: optionalNumber(line, 'discount_percent') ?? 0,
            is_completed: optionalBoolean(line, 'is_completed') ?? true,
            tags: parseTags(line.tags, 'LABOR'),
          };
        },
      );

      const partLines = requireArray(service, 'part_lines').map(
        (line, lineIndex) => {
          if (!isRecord(line)) {
            throw new Error(
              `${contextLabel}.services[${serviceIndex}].part_lines[${lineIndex}] must be an object.`,
            );
          }
          return {
            name: requireString(line, 'name'),
            part_number: optionalString(line, 'part_number'),
            quantity: requireNumber(line, 'quantity'),
            cost: optionalNumber(line, 'cost'),
            price: requireNumber(line, 'price'),
            discount_percent: optionalNumber(line, 'discount_percent') ?? 0,
            tags: parseTags(line.tags, 'PART'),
          };
        },
      );

      if (laborLines.length === 0 && partLines.length === 0) {
        throw new Error(
          `${contextLabel}.services[${serviceIndex}] must contain at least one labor or part line.`,
        );
      }

      return {
        canned_service_name: requireString(service, 'canned_service_name'),
        estimate_service_name:
          optionalString(service, 'estimate_service_name') ?? undefined,
        note: optionalString(service, 'note'),
        source_displayed_total: optionalNumber(
          service,
          'source_displayed_total',
        ),
        labor_lines: laborLines,
        part_lines: partLines,
      };
    },
  );

  return {
    external_order_id: requireString(parsed, 'external_order_id'),
    external_reference_number: requireString(
      parsed,
      'external_reference_number',
    ),
    external_invoice_number: optionalString(parsed, 'external_invoice_number'),
    order_path: optionalString(parsed, 'order_path'),
    scheduled_start: optionalString(parsed, 'scheduled_start'),
    scheduled_end: optionalString(parsed, 'scheduled_end'),
    document_kind: optionalString(parsed, 'document_kind'),
    shop_timezone:
      optionalString(parsed, 'shop_timezone') ?? 'America/New_York',
    source_state_label: optionalString(parsed, 'source_state_label'),
    invoice_status: optionalString(parsed, 'invoice_status'),
    appointment_status: optionalString(parsed, 'appointment_status'),
    created_at_shop_time: optionalString(parsed, 'created_at_shop_time'),
    invoiced_at_shop_time: optionalString(parsed, 'invoiced_at_shop_time'),
    title: requireString(parsed, 'title'),
    customer: {
      first_name: requireString(customer, 'first_name'),
      last_name: requireString(customer, 'last_name'),
      phone: requireString(customer, 'phone'),
      email: optionalString(customer, 'email'),
    },
    vehicle: {
      year: optionalNumber(vehicle, 'year'),
      make: requireString(vehicle, 'make'),
      model: requireString(vehicle, 'model'),
      sub_model: optionalString(vehicle, 'sub_model'),
      vin: optionalString(vehicle, 'vin'),
      license_plate: optionalString(vehicle, 'license_plate'),
      mileage: optionalNumber(vehicle, 'mileage'),
      color: optionalString(vehicle, 'color'),
    },
    assigned_user_id: optionalString(parsed, 'assigned_user_id'),
    assigned_user_email: optionalString(parsed, 'assigned_user_email'),
    estimate_status: optionalEnum(
      parsed,
      'estimate_status',
      Object.values(EstimateStatus),
      EstimateStatus.COMPLETED,
    ),
    payment_status: optionalEnum(
      parsed,
      'payment_status',
      Object.values(PaidStatus),
      PaidStatus.UNPAID,
    ),
    payment_type: optionalEnum(
      parsed,
      'payment_type',
      Object.values(PaymentType),
      PaymentType.POS_CARD,
    ),
    source_grand_total: optionalNumber(parsed, 'source_grand_total'),
    customer_comments: optionalString(parsed, 'customer_comments'),
    recommendations: optionalString(parsed, 'recommendations'),
    services,
  };
}

function parseInput(raw: string): ShopmonkeyPasteImportInput[] {
  if (raw.trim().length === 0) {
    throw new Error(
      'Pass a Shopmonkey import JSON object, array, or { estimates: [...] } object on stdin.',
    );
  }

  const parsed: unknown = JSON.parse(raw);
  const records = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.estimates)
      ? parsed.estimates
      : [parsed];

  const inputs = records.map((record, index) => {
    if (!isRecord(record)) {
      throw new Error(`estimates[${index}] must be a JSON object.`);
    }
    return parseOneInput(record, `estimates[${index}]`);
  });

  validateBatchSourceKeys(inputs);
  return inputs;
}

function validateBatchSourceKeys(inputs: ShopmonkeyPasteImportInput[]) {
  if (inputs.length > MAX_BATCH_SIZE) {
    throw new Error(
      `Batch contains ${inputs.length} estimates. The importer is capped at ${MAX_BATCH_SIZE} per run to keep duplicate review and failure recovery reliable.`,
    );
  }

  const seenOrderIds = new Map<string, number>();
  const seenInvoiceNumbers = new Map<string, number>();

  inputs.forEach((input, index) => {
    const existingOrderIndex = seenOrderIds.get(input.external_order_id);
    if (existingOrderIndex !== undefined) {
      throw new Error(
        `Duplicate external_order_id "${input.external_order_id}" at estimates[${existingOrderIndex}] and estimates[${index}].`,
      );
    }
    seenOrderIds.set(input.external_order_id, index);

    if (!input.external_invoice_number) {
      return;
    }
    const existingInvoiceIndex = seenInvoiceNumbers.get(
      input.external_invoice_number,
    );
    if (existingInvoiceIndex !== undefined) {
      throw new Error(
        `Duplicate external_invoice_number "${input.external_invoice_number}" at estimates[${existingInvoiceIndex}] and estimates[${index}].`,
      );
    }
    seenInvoiceNumbers.set(input.external_invoice_number, index);
  });
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (value.trim().startsWith('+')) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return digits ? `+${digits}` : value.trim();
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateLaborTotal(lines: ShopmonkeyLaborLineInput[]) {
  return roundCurrency(
    lines.reduce(
      (sum, line) =>
        sum + line.hours * line.rate * (1 - (line.discount_percent ?? 0) / 100),
      0,
    ),
  );
}

function calculatePartTotal(lines: ShopmonkeyPartLineInput[]) {
  return roundCurrency(
    lines.reduce(
      (sum, line) =>
        sum +
        line.quantity * line.price * (1 - (line.discount_percent ?? 0) / 100),
      0,
    ),
  );
}

function calculateServiceFinancials(
  service: ShopmonkeyServiceInput,
): ServiceFinancials {
  const mappedTotal = roundCurrency(
    calculateLaborTotal(service.labor_lines) +
      calculatePartTotal(service.part_lines),
  );
  const sourceTotal = service.source_displayed_total ?? mappedTotal;
  const feeDelta = roundCurrency(sourceTotal - mappedTotal);

  if (feeDelta < -CURRENCY_TOLERANCE) {
    throw new Error(
      `Service "${service.canned_service_name}" has a negative fee delta ${feeDelta}. Review totals before import.`,
    );
  }

  return { mappedTotal, sourceTotal, feeDelta };
}

function preflightFinancials(input: ShopmonkeyPasteImportInput) {
  const serviceFinancials = input.services.map(calculateServiceFinancials);
  const importedFeeTotal = roundCurrency(
    serviceFinancials.reduce((sum, financials) => sum + financials.feeDelta, 0),
  );
  const computedTotal = roundCurrency(
    serviceFinancials.reduce(
      (sum, financials) => sum + financials.sourceTotal,
      0,
    ),
  );

  if (
    input.source_grand_total !== null &&
    input.source_grand_total !== undefined &&
    Math.abs(roundCurrency(input.source_grand_total - computedTotal)) >
      CURRENCY_TOLERANCE
  ) {
    throw new Error(
      `Source grand total ${input.source_grand_total} does not match computed import total ${computedTotal}. Review before import.`,
    );
  }

  return { serviceFinancials, importedFeeTotal, computedTotal };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSourceMetadata(input: ShopmonkeyPasteImportInput) {
  return {
    source_system: 'shopmonkey',
    document_kind: input.document_kind ?? null,
    external_order_id: input.external_order_id,
    external_reference_number: input.external_reference_number,
    external_invoice_number: input.external_invoice_number ?? null,
    order_path: input.order_path ?? null,
    shop_timezone: input.shop_timezone ?? 'America/New_York',
    source_state_label: input.source_state_label ?? null,
    invoice_status: input.invoice_status ?? null,
    appointment_status: input.appointment_status ?? null,
    created_at_shop_time: input.created_at_shop_time ?? null,
    invoiced_at_shop_time: input.invoiced_at_shop_time ?? null,
  };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  });
  const offsetPart = formatter
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = offsetPart?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);

  if (!match) {
    throw new Error(`Unable to resolve timezone offset for ${timeZone}.`);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  return sign * (hours * 60 + minutes);
}

function parseShopmonkeyTimestampToDate(value: string, timeZone: string) {
  const match = value
    .trim()
    .match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
    );
  if (!match) {
    throw new Error(
      `Shopmonkey timestamp "${value}" is not in MM/DD/YYYY at h:mm AM/PM format.`,
    );
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const minute = Number(match[5]);
  const meridiem = match[6].toUpperCase();
  const rawHour = Number(match[4]);
  const hour = meridiem === 'PM' ? (rawHour % 12) + 12 : rawHour % 12;
  const naiveUtc = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMinutes = getTimeZoneOffsetMinutes(naiveUtc, timeZone);

  return new Date(naiveUtc.getTime() - offsetMinutes * 60_000);
}

function resolveScheduleWindow(input: ShopmonkeyPasteImportInput) {
  if (input.scheduled_start && input.scheduled_end) {
    return {
      scheduled_start: input.scheduled_start,
      scheduled_end: input.scheduled_end,
    };
  }

  if (input.scheduled_start || input.scheduled_end) {
    throw new Error(
      'scheduled_start and scheduled_end must be provided together.',
    );
  }

  if (!input.created_at_shop_time) {
    return {
      scheduled_start: undefined,
      scheduled_end: undefined,
    };
  }

  const scheduledStart = parseShopmonkeyTimestampToDate(
    input.created_at_shop_time,
    input.shop_timezone ?? 'America/New_York',
  );
  const scheduledEnd = new Date(scheduledStart.getTime() + 60 * 60_000);

  return {
    scheduled_start: scheduledStart.toISOString(),
    scheduled_end: scheduledEnd.toISOString(),
  };
}

function ensureAssignableUser(user: UserDocument, label: string) {
  if (!user.is_active) {
    throw new Error(`${label} user ${String(user._id)} is inactive.`);
  }
  if (![UserRole.ADMIN, UserRole.TECHNICIAN].includes(user.role)) {
    throw new Error(
      `${label} user ${String(user._id)} must be an admin or technician.`,
    );
  }
}

async function resolveAssignedUser(
  userModel: Model<UserDocument>,
  input: {
    assigned_user_id?: string | null;
    assigned_user_email?: string | null;
  },
) {
  if (input.assigned_user_id) {
    const user = await userModel.findById(input.assigned_user_id).exec();
    if (!user) {
      throw new Error(
        `Assigned user ${input.assigned_user_id} was not found or is inactive.`,
      );
    }
    ensureAssignableUser(user, 'Assigned');
    return user;
  }

  if (input.assigned_user_email) {
    const user = await userModel
      .findOne({
        email: input.assigned_user_email.toLowerCase(),
        is_active: true,
      })
      .exec();
    if (!user) {
      throw new Error(
        `Assigned user ${input.assigned_user_email} was not found or is inactive.`,
      );
    }
    ensureAssignableUser(user, 'Assigned');
    return user;
  }

  return null;
}

async function resolveLineAssignedUserIds(
  userModel: Model<UserDocument>,
  services: ShopmonkeyServiceInput[],
  fallbackAssignedUser: UserDocument | null,
) {
  const lineAssignedUserIds = new Map<string, string | null>();

  for (const [serviceIndex, service] of services.entries()) {
    for (const [lineIndex, line] of service.labor_lines.entries()) {
      const key = `${serviceIndex}:${lineIndex}`;
      const lineAssignedUser = await resolveAssignedUser(userModel, {
        assigned_user_id: line.assigned_user_id,
        assigned_user_email: line.assigned_user_email,
      });

      lineAssignedUserIds.set(
        key,
        lineAssignedUser
          ? String(lineAssignedUser._id)
          : fallbackAssignedUser
            ? String(fallbackAssignedUser._id)
            : null,
      );
    }
  }

  return lineAssignedUserIds;
}

function normalizeCustomerName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function pickExistingCustomerCandidate(
  candidates: CustomerDocument[],
  input: ShopmonkeyCustomerInput,
  vehicleCustomerId?: string | null,
) {
  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  if (vehicleCustomerId) {
    const vehicleOwnedCandidate = candidates.find(
      (candidate) => String(candidate._id) === vehicleCustomerId,
    );
    if (vehicleOwnedCandidate) {
      return vehicleOwnedCandidate;
    }
  }

  if (input.email) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const emailMatches = candidates.filter(
      (candidate) => candidate.email?.trim().toLowerCase() === normalizedEmail,
    );
    if (emailMatches.length === 1) {
      return emailMatches[0];
    }
  }

  const normalizedFirstName = normalizeCustomerName(input.first_name);
  const normalizedLastName = normalizeCustomerName(input.last_name);
  const nameMatches = candidates.filter(
    (candidate) =>
      normalizeCustomerName(candidate.first_name) === normalizedFirstName &&
      normalizeCustomerName(candidate.last_name) === normalizedLastName,
  );
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }

  throw new Error(
    `Customer phone ${normalizePhone(input.phone)} matched ${candidates.length} customers and could not be disambiguated by vehicle, email, or exact name.`,
  );
}

async function preflightCustomerVehicleRelationship(
  customerModel: Model<CustomerDocument>,
  vehicleModel: Model<VehicleDocument>,
  input: ShopmonkeyPasteImportInput,
) {
  const phone = normalizePhone(input.customer.phone);
  const customerCandidates = await customerModel.find({ phone }).exec();
  const vin = input.vehicle.vin?.trim().toUpperCase() ?? null;
  const licensePlate =
    input.vehicle.license_plate?.trim().toUpperCase() ?? null;
  const customerCandidateForScopedVehicleLookup =
    !vin && !licensePlate
      ? pickExistingCustomerCandidate(customerCandidates, input.customer, null)
      : null;

  const vehicleLookup =
    vin || licensePlate
      ? vehicleModel
          .find({
            $or: [
              ...(vin ? [{ vin }] : []),
              ...(licensePlate ? [{ license_plate: licensePlate }] : []),
            ],
          })
          .exec()
      : findCustomerScopedVehicleCandidates(
          vehicleModel,
          customerCandidateForScopedVehicleLookup,
          input,
        );

  const vehicleMatches = await vehicleLookup;
  if (vehicleMatches.length > 1) {
    throw new Error(
      `Vehicle import matched ${vehicleMatches.length} possible vehicles. Add VIN/plate or review manually before import.`,
    );
  }
  const existingVehicle = vehicleMatches[0] ?? null;
  const existingCustomer = pickExistingCustomerCandidate(
    customerCandidates,
    input.customer,
    existingVehicle
      ? String(existingVehicle.customer_id)
      : customerCandidateForScopedVehicleLookup
        ? String(customerCandidateForScopedVehicleLookup._id)
        : null,
  );

  if (
    existingVehicle &&
    (!existingCustomer ||
      String(existingVehicle.customer_id) !== String(existingCustomer._id))
  ) {
    throw new Error(
      `Vehicle ${String(existingVehicle._id)} matched by VIN/plate but does not belong to the pasted customer.`,
    );
  }

  return { existingCustomer, existingVehicle };
}

async function findCustomerScopedVehicleCandidates(
  vehicleModel: Model<VehicleDocument>,
  customer: CustomerDocument | null,
  input: ShopmonkeyPasteImportInput,
) {
  if (!customer) {
    throw new Error(
      'Vehicle import without VIN/plate requires an existing customer match for customer-scoped duplicate review.',
    );
  }

  if (!input.vehicle.year || !input.vehicle.make || !input.vehicle.model) {
    throw new Error(
      'Vehicle import without VIN/plate requires year, make, and model for customer-scoped duplicate review.',
    );
  }

  return vehicleModel
    .find({
      customer_id: customer._id,
      year: input.vehicle.year,
      make: new RegExp(`^${escapeRegex(input.vehicle.make.trim())}$`, 'i'),
      model: new RegExp(`^${escapeRegex(input.vehicle.model.trim())}$`, 'i'),
      ...(input.vehicle.sub_model
        ? {
            sub_model: new RegExp(
              `^${escapeRegex(input.vehicle.sub_model.trim())}$`,
              'i',
            ),
          }
        : {}),
    })
    .exec();
}

async function resolveCustomer(
  customerModel: Model<CustomerDocument>,
  input: ShopmonkeyCustomerInput,
  existingCustomer: CustomerDocument | null,
) {
  const phone = normalizePhone(input.phone);
  if (existingCustomer) {
    return { document: existingCustomer, action: 'linked_existing' as const };
  }

  const created = await customerModel.create({
    first_name: input.first_name.trim(),
    last_name: input.last_name.trim(),
    phone,
    email: input.email ? input.email.trim().toLowerCase() : null,
    is_archived: false,
  });
  return { document: created, action: 'created' as const };
}

async function resolveVehicle(
  vehicleModel: Model<VehicleDocument>,
  customer: CustomerDocument,
  input: ShopmonkeyVehicleInput,
  existingVehicle: VehicleDocument | null,
) {
  const vin = input.vin?.trim().toUpperCase() ?? null;
  const licensePlate = input.license_plate?.trim().toUpperCase() ?? null;

  if (existingVehicle) {
    if (String(existingVehicle.customer_id) !== String(customer._id)) {
      throw new Error(
        `Vehicle ${String(existingVehicle._id)} matched by VIN/plate but belongs to a different customer.`,
      );
    }

    let didChange = false;
    if (
      input.mileage !== null &&
      input.mileage !== undefined &&
      (existingVehicle.mileage ?? 0) < input.mileage
    ) {
      existingVehicle.mileage = input.mileage;
      didChange = true;
    }
    if (!existingVehicle.color && input.color) {
      existingVehicle.color = input.color;
      didChange = true;
    }
    if (didChange) {
      await existingVehicle.save();
    }
    return {
      document: existingVehicle,
      action: didChange ? 'linked_existing_updated' : 'linked_existing',
    };
  }

  const created = await vehicleModel.create({
    customer_id: customer._id,
    color: input.color ?? null,
    year: input.year,
    make: input.make.trim(),
    model: input.model.trim(),
    sub_model: input.sub_model?.trim() ?? null,
    mileage: input.mileage ?? null,
    vin,
    license_plate: licensePlate,
    is_incomplete: !vin || !licensePlate,
    is_archived: false,
  });
  return { document: created, action: 'created' as const };
}

async function resolveCannedService(
  serviceCatalogService: ServiceCatalogService,
  service: ShopmonkeyServiceInput,
) {
  try {
    const created = await serviceCatalogService.create({
      name: service.canned_service_name,
      note: service.note ?? null,
      labor_lines: service.labor_lines.map((line) => ({
        description: line.description,
        hours: line.hours,
        rate: line.rate,
        discount_percent: line.discount_percent ?? 0,
        tags: line.tags ?? [],
      })),
      part_lines: service.part_lines.map((line) => ({
        name: line.name,
        part_number: line.part_number ?? null,
        quantity: line.quantity,
        cost: line.cost ?? null,
        price: line.price,
        discount_percent: line.discount_percent ?? 0,
        tags: line.tags ?? [],
      })),
    });
    return { service: created, action: 'created' as const };
  } catch (error) {
    const duplicateId = (
      error as { response?: { duplicate_service?: { id?: string } } }
    ).response?.duplicate_service?.id;

    if (error instanceof ConflictException && duplicateId) {
      const matched = await serviceCatalogService.findById(duplicateId);
      return { service: matched, action: 'linked_existing' as const };
    }

    throw error;
  }
}

function buildPartLinesWithFee(
  service: ShopmonkeyServiceInput,
  financials: ServiceFinancials,
) {
  const partLines = service.part_lines.map((line) => ({
    name: line.name,
    part_number: line.part_number ?? null,
    quantity: line.quantity,
    cost: line.cost ?? null,
    price: line.price,
    discount_percent: line.discount_percent ?? 0,
    tags: line.tags ?? [],
  }));

  if (financials.feeDelta > CURRENCY_TOLERANCE) {
    partLines.push({
      name: IMPORTED_FEE_PART_NAME,
      part_number: null,
      quantity: 1,
      cost: null,
      price: financials.feeDelta,
      discount_percent: 0,
      tags: [],
    });
  }

  return partLines;
}

async function importShopmonkeyPaste(
  input: ShopmonkeyPasteImportInput,
  context: ImportContext,
) {
  const scheduleWindow = resolveScheduleWindow(input);
  const duplicateChecks: Record<string, unknown>[] = [
    { 'source_metadata.external_order_id': input.external_order_id },
  ];
  if (input.external_invoice_number) {
    duplicateChecks.push({
      'source_metadata.external_invoice_number': input.external_invoice_number,
    });
  }

  const existingEstimate = await context.estimateModel
    .findOne({
      $or: duplicateChecks,
    })
    .exec();

  if (existingEstimate) {
    return {
      skipped: true,
      reason: 'estimate already imported',
      estimate_id: String(existingEstimate._id),
      estimate_number: existingEstimate.estimate_number,
    };
  }

  const financials = preflightFinancials(input);
  const assignedUser = await resolveAssignedUser(context.userModel, {
    assigned_user_id: input.assigned_user_id,
    assigned_user_email: input.assigned_user_email,
  });
  const lineAssignedUserIds = await resolveLineAssignedUserIds(
    context.userModel,
    input.services,
    assignedUser,
  );
  const { existingCustomer, existingVehicle } =
    await preflightCustomerVehicleRelationship(
      context.customerModel,
      context.vehicleModel,
      input,
    );

  let customerResult: Awaited<ReturnType<typeof resolveCustomer>> | null =
    await resolveCustomer(
      context.customerModel,
      input.customer,
      existingCustomer,
    );
  let vehicleResult: Awaited<ReturnType<typeof resolveVehicle>> | null =
    await resolveVehicle(
      context.vehicleModel,
      customerResult.document,
      input.vehicle,
      existingVehicle,
    );

  const cannedServices: Array<{ id: string; name: string; action: string }> =
    [];
  const estimateServices = [];
  let didCreateEstimate = false;

  try {
    for (const [serviceIndex, service] of input.services.entries()) {
      const cannedServiceResult = await resolveCannedService(
        context.serviceCatalogService,
        service,
      );
      cannedServices.push({
        id: cannedServiceResult.service.id,
        name: cannedServiceResult.service.name,
        action: cannedServiceResult.action,
      });

      const partLines = buildPartLinesWithFee(
        service,
        financials.serviceFinancials[serviceIndex],
      );

      estimateServices.push({
        canned_service_id: cannedServiceResult.service.id,
        name: service.estimate_service_name ?? service.canned_service_name,
        note: service.note ?? null,
        labor_lines: service.labor_lines.map((line, lineIndex) => ({
          description: line.description,
          assigned_user_id:
            lineAssignedUserIds.get(`${serviceIndex}:${lineIndex}`) ?? null,
          hours: line.hours,
          rate: line.rate,
          discount_percent: line.discount_percent ?? 0,
          is_completed: line.is_completed ?? true,
          tags: line.tags ?? [],
        })),
        part_lines: partLines,
      });
    }

    const createdEstimate = await context.estimatesService.create({
      title: input.title,
      customer_id: String(customerResult.document._id),
      vehicle_id: String(vehicleResult.document._id),
      scheduled_start: scheduleWindow.scheduled_start,
      scheduled_end: scheduleWindow.scheduled_end,
      assigned_user_id: assignedUser ? String(assignedUser._id) : undefined,
      complaint_or_request: input.customer_comments ?? undefined,
      payment_status: input.payment_status,
      payment_type: input.payment_type,
      source_metadata: buildSourceMetadata(input),
      services: estimateServices,
      notes: input.recommendations ?? undefined,
    });
    didCreateEstimate = true;

    if (
      input.estimate_status &&
      input.estimate_status !== EstimateStatus.SCHEDULED
    ) {
      await context.estimatesService.updateStatus(String(createdEstimate.id), {
        estimate_status: input.estimate_status,
      });
    }

    const finalEstimate = await context.estimatesService.findById(
      String(createdEstimate.id),
    );

    return {
      skipped: false,
      estimate_id: finalEstimate.id,
      estimate_number: finalEstimate.estimate_number,
      customer_id: String(customerResult.document._id),
      customer_action: customerResult.action,
      vehicle_id: String(vehicleResult.document._id),
      vehicle_action: vehicleResult.action,
      estimate_status: finalEstimate.estimate_status,
      payment_status: finalEstimate.payment_status,
      payment_type: finalEstimate.payment_type,
      total: finalEstimate.total,
      labor_total: finalEstimate.labor_total,
      parts_total: finalEstimate.parts_total,
      canned_services: cannedServices,
      imported_fee_total: financials.importedFeeTotal,
    };
  } catch (error) {
    if (!didCreateEstimate) {
      await cleanupCreatedCannedServices(context, cannedServices);
      await cleanupCreatedVehicle(context.vehicleModel, vehicleResult);
      await cleanupCreatedCustomer(context.customerModel, customerResult);
    }
    throw error;
  }
}

async function cleanupCreatedCannedServices(
  context: ImportContext,
  cannedServices: Array<{ id: string; action: string }>,
) {
  const createdServices = cannedServices.filter(
    (service) => service.action === 'created',
  );

  for (const service of createdServices.reverse()) {
    try {
      await context.serviceCatalogService.remove(service.id);
    } catch {
      await context.serviceCatalogService.deactivate(service.id);
    }
  }
}

async function cleanupCreatedVehicle(
  vehicleModel: Model<VehicleDocument>,
  vehicleResult: { document: VehicleDocument; action: string } | null,
) {
  if (!vehicleResult || vehicleResult.action !== 'created') {
    return;
  }

  await vehicleModel.deleteOne({ _id: vehicleResult.document._id }).exec();
}

async function cleanupCreatedCustomer(
  customerModel: Model<CustomerDocument>,
  customerResult: { document: CustomerDocument; action: string } | null,
) {
  if (!customerResult || customerResult.action !== 'created') {
    return;
  }

  await customerModel.deleteOne({ _id: customerResult.document._id }).exec();
}

async function main() {
  loadEnv();
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  const inputs = parseInput(await readStdin());
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const context = {
      userModel: app.get<Model<UserDocument>>(getModelToken(User.name)),
      customerModel: app.get<Model<CustomerDocument>>(
        getModelToken(Customer.name),
      ),
      vehicleModel: app.get<Model<VehicleDocument>>(
        getModelToken(Vehicle.name),
      ),
      estimateModel: app.get<Model<EstimateDocument>>(
        getModelToken(Estimate.name),
      ),
      serviceCatalogService: app.get(ServiceCatalogService),
      estimatesService: app.get(EstimatesService),
    };
    const results = [];

    for (const [index, input] of inputs.entries()) {
      try {
        const result = await importShopmonkeyPaste(input, context);
        results.push({
          index,
          external_order_id: input.external_order_id,
          external_invoice_number: input.external_invoice_number ?? null,
          ok: true,
          ...result,
        });
      } catch (error) {
        results.push({
          index,
          external_order_id: input.external_order_id,
          external_invoice_number: input.external_invoice_number ?? null,
          ok: false,
          reason: 'import failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failedCount = results.filter((result) => !result.ok).length;
    const skippedCount = results.filter(
      (result) => result.ok && 'skipped' in result && result.skipped,
    ).length;
    const importedCount = results.filter(
      (result) => result.ok && (!('skipped' in result) || !result.skipped),
    ).length;
    const output =
      inputs.length === 1
        ? results[0]
        : {
            ok: failedCount === 0,
            total: inputs.length,
            imported: importedCount,
            skipped: skippedCount,
            succeeded: inputs.length - failedCount,
            failed: failedCount,
            results,
          };

    console.log(JSON.stringify(output, null, 2));
    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        skipped: true,
        reason: 'import failed',
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
