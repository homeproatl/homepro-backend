import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { Customer, CustomerDocument } from '../src/customers/schemas/customer.schema';
import { Vehicle, VehicleDocument } from '../src/vehicles/schemas/vehicle.schema';
import { Estimate, EstimateDocument } from '../src/estimates/schemas/estimate.schema';
import { ServiceCatalogService } from '../src/service-catalog/service-catalog.service';
import { EstimatesService } from '../src/estimates/estimates.service';
import { EstimateStatus } from '../src/common/enums/estimate-status.enum';
import { PaidStatus } from '../src/common/enums/paid-status.enum';
import { PaymentType } from '../src/common/enums/payment-type.enum';

type ManualCustomerInput = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
};

type ManualVehicleInput = {
  year: number | null;
  make: string;
  model: string;
  sub_model: string | null;
  vin: string | null;
  license_plate: string | null;
  mileage: number | null;
  color: string | null;
};

type ManualLaborLineInput = {
  description: string;
  hours: number;
  rate: number;
  discount_percent?: number;
};

type ManualPartLineInput = {
  name: string;
  part_number?: string | null;
  quantity: number;
  cost: number | null;
  price: number;
  discount_percent?: number;
};

type ManualServiceInput = {
  canned_service_name: string;
  estimate_service_name: string;
  labor_lines: ManualLaborLineInput[];
  part_lines: ManualPartLineInput[];
  source_displayed_total: number;
};

type ManualEstimateImport = {
  external_order_id: string;
  external_estimate_number: string;
  order_path: string;
  title: string;
  customer: ManualCustomerInput;
  vehicle: ManualVehicleInput;
  estimate_status: EstimateStatus;
  payment_status: PaidStatus;
  payment_type: PaymentType;
  services: ManualServiceInput[];
};

const IMPORT: ManualEstimateImport = {
  external_order_id: 'df3ce7d4-5f53-4283-a1cd-befcad0c4dc9',
  external_estimate_number: '1692',
  order_path: '/order/df3ce7d4-5f53-4283-a1cd-befcad0c4dc9',
  title: 'TUNE UP SERVICE and 1 more',
  customer: {
    first_name: 'Dimitry',
    last_name: 'BENZZZ',
    phone: '+13476518148',
    email: null,
  },
  vehicle: {
    year: 2018,
    make: 'Mercedes-Benz',
    model: 'E400',
    sub_model: '4Matic',
    vin: 'WDD1J6GB9JF028606',
    license_plate: 'KGR2490',
    mileage: 69318,
    color: null,
  },
  estimate_status: EstimateStatus.COMPLETED,
  payment_status: PaidStatus.UNPAID,
  payment_type: PaymentType.POS_CARD,
  services: [
    {
      canned_service_name: 'TUNE UP SERVICE',
      estimate_service_name: 'TUNE UP SERVICE',
      labor_lines: [
        {
          description: 'LABOR RATE',
          hours: 3.25,
          rate: 200,
          discount_percent: 0,
        },
      ],
      part_lines: [
        {
          name: 'SPARK PLUGS',
          quantity: 4,
          cost: 34,
          price: 23,
          discount_percent: 0,
        },
        {
          name: 'COOLANT FLUSH - BENZ AMG',
          quantity: 1,
          cost: 344,
          price: 150,
          discount_percent: 0,
        },
        {
          name: 'BRAKE FLUSH - BENZ AMG',
          quantity: 1,
          cost: 290,
          price: 170,
          discount_percent: 0,
        },
        {
          name: 'AIR FILTER - BENZ AMG',
          quantity: 1,
          cost: 89,
          price: 55,
          discount_percent: 0,
        },
        {
          name: 'CARBINE FILTER - BNEZ AMG',
          quantity: 1,
          cost: 56,
          price: 30,
          discount_percent: 0,
        },
        {
          name: 'DRIVER WIPER - BENZ AMG',
          quantity: 1,
          cost: 89,
          price: 70,
          discount_percent: 0,
        },
        {
          name: 'PASSENDER WIPER - BENZ AMG',
          quantity: 1,
          cost: 89,
          price: 70,
          discount_percent: 0,
        },
      ],
      source_displayed_total: 1401.22,
    },
    {
      canned_service_name: 'OIL CHANGE-- BWM, BENZ, AUDI, PORSCHE',
      estimate_service_name: 'OIL CHANGE-- BWM, BENZ, AUDI, PORSCHE',
      labor_lines: [
        {
          description: 'LABOR',
          hours: 0.6,
          rate: 150,
          discount_percent: 0,
        },
      ],
      part_lines: [
        {
          name: 'OILS',
          quantity: 1,
          cost: 120,
          price: 70,
          discount_percent: 0,
        },
        {
          name: 'OIL FILTER',
          quantity: 1,
          cost: 30,
          price: 20,
          discount_percent: 0,
        },
      ],
      source_displayed_total: 195.98,
    },
  ],
};

const IMPORTED_FEE_PART_NAME = 'IMPORTED SHOP SUPPLIES / EPA / FEES';

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, '');
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function sumLaborTotal(lines: ManualLaborLineInput[]) {
  return roundCurrency(
    lines.reduce(
      (sum, line) =>
        sum + line.hours * line.rate * (1 - (line.discount_percent ?? 0) / 100),
      0,
    ),
  );
}

function sumPartTotal(lines: ManualPartLineInput[]) {
  return roundCurrency(
    lines.reduce(
      (sum, line) =>
        sum +
        line.quantity * line.price * (1 - (line.discount_percent ?? 0) / 100),
      0,
    ),
  );
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildImportMarker(input: ManualEstimateImport) {
  return `Shopmonkey order ${input.external_order_id}`;
}

async function resolveCustomer(
  customerModel: Model<CustomerDocument>,
  input: ManualCustomerInput,
) {
  const normalizedPhone = normalizePhone(input.phone);
  const existing = await customerModel.findOne({ phone: normalizedPhone }).exec();
  if (existing) {
    return existing;
  }

  return customerModel.create({
    first_name: input.first_name.trim(),
    last_name: input.last_name.trim(),
    phone: normalizedPhone,
    email: input.email ? input.email.trim().toLowerCase() : null,
    is_archived: false,
  });
}

async function resolveVehicle(
  vehicleModel: Model<VehicleDocument>,
  customer: CustomerDocument,
  input: ManualVehicleInput,
) {
  const vin = input.vin?.trim().toUpperCase() ?? null;
  const licensePlate = input.license_plate?.trim().toUpperCase() ?? null;

  const existing = await vehicleModel
    .findOne({
      $or: [
        ...(vin ? [{ vin }] : []),
        ...(licensePlate ? [{ license_plate: licensePlate }] : []),
      ],
    })
    .exec();

  if (existing) {
    let didChange = false;

    if (String(existing.customer_id) !== String(customer._id)) {
      existing.customer_id = customer._id;
      didChange = true;
    }

    if (input.mileage !== null && (existing.mileage ?? 0) < input.mileage) {
      existing.mileage = input.mileage;
      didChange = true;
    }

    if (!existing.color && input.color) {
      existing.color = input.color;
      didChange = true;
    }

    if (didChange) {
      await existing.save();
    }

    return existing;
  }

  return vehicleModel.create({
    customer_id: customer._id,
    color: input.color,
    year: input.year,
    make: input.make.trim(),
    model: input.model.trim(),
    sub_model: input.sub_model?.trim() ?? null,
    mileage: input.mileage,
    vin,
    license_plate: licensePlate,
    is_incomplete: !vin || !licensePlate,
    is_archived: false,
  });
}

async function resolveCannedService(
  serviceCatalogService: ServiceCatalogService,
  service: ManualServiceInput,
) {
  try {
    return await serviceCatalogService.create({
      name: service.canned_service_name,
      labor_lines: service.labor_lines.map((line) => ({
        description: line.description,
        hours: line.hours,
        rate: line.rate,
        discount_percent: line.discount_percent ?? 0,
      })),
      part_lines: service.part_lines.map((line) => ({
        name: line.name,
        part_number: line.part_number ?? null,
        quantity: line.quantity,
        cost: line.cost,
        price: line.price,
        discount_percent: line.discount_percent ?? 0,
      })),
    });
  } catch (error) {
    const duplicateId = (
      error as {
        response?: { duplicate_service?: { id?: string } };
      }
    ).response?.duplicate_service?.id;

    if (error instanceof ConflictException && duplicateId) {
      return serviceCatalogService.findById(duplicateId);
    }

    throw error;
  }
}

async function main() {
  loadEnv();

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const customerModel = app.get<Model<CustomerDocument>>(getModelToken(Customer.name));
    const vehicleModel = app.get<Model<VehicleDocument>>(getModelToken(Vehicle.name));
    const estimateModel = app.get<Model<EstimateDocument>>(getModelToken(Estimate.name));
    const serviceCatalogService = app.get(ServiceCatalogService);
    const estimatesService = app.get(EstimatesService);

    const importMarker = buildImportMarker(IMPORT);
    const existingEstimate = await estimateModel
      .findOne({
        notes: {
          $regex: escapeRegex(importMarker),
          $options: 'i',
        },
      })
      .exec();

    if (existingEstimate) {
      console.log(
        JSON.stringify(
          {
            skipped: true,
            reason: 'estimate already imported',
            estimate_id: String(existingEstimate._id),
            estimate_number: existingEstimate.estimate_number,
          },
          null,
          2,
        ),
      );
      return;
    }

    const customer = await resolveCustomer(customerModel, IMPORT.customer);
    const vehicle = await resolveVehicle(vehicleModel, customer, IMPORT.vehicle);

    const estimateServices = [];
    const createdOrMatchedCannedServices: Array<{ id: string; name: string }> = [];

    for (const service of IMPORT.services) {
      const cannedService = await resolveCannedService(serviceCatalogService, service);
      createdOrMatchedCannedServices.push({
        id: cannedService.id,
        name: cannedService.name,
      });

      const laborLines = service.labor_lines.map((line) => ({
        description: line.description,
        hours: line.hours,
        rate: line.rate,
        discount_percent: line.discount_percent ?? 0,
      }));

      const partLines = service.part_lines.map((line) => ({
        name: line.name,
        part_number: line.part_number ?? null,
        quantity: line.quantity,
        cost: line.cost,
        price: line.price,
        discount_percent: line.discount_percent ?? 0,
      }));

      const mappedTotal = roundCurrency(
        sumLaborTotal(service.labor_lines) + sumPartTotal(service.part_lines),
      );
      const importedFeeDelta = roundCurrency(
        service.source_displayed_total - mappedTotal,
      );

      if (importedFeeDelta > 0) {
        partLines.push({
          name: IMPORTED_FEE_PART_NAME,
          part_number: null,
          quantity: 1,
          cost: null,
          price: importedFeeDelta,
          discount_percent: 0,
        });
      }

      estimateServices.push({
        canned_service_id: cannedService.id,
        name: service.estimate_service_name,
        labor_lines: laborLines,
        part_lines: partLines,
      });
    }

    const importedFeeTotal = roundCurrency(
      IMPORT.services.reduce((sum, service) => {
        const mappedTotal = roundCurrency(
          sumLaborTotal(service.labor_lines) + sumPartTotal(service.part_lines),
        );
        return sum + (service.source_displayed_total - mappedTotal);
      }, 0),
    );

    const notes = [
      `Imported from ${importMarker} (estimate #${IMPORT.external_estimate_number}).`,
      `Source path: ${IMPORT.order_path}.`,
      importedFeeTotal > 0
        ? `Preserved $${importedFeeTotal.toFixed(2)} of non-itemized Shopmonkey fees as "${IMPORTED_FEE_PART_NAME}" part lines.`
        : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ');

    const createdEstimate = await estimatesService.create({
      title: IMPORT.title,
      customer_id: String(customer._id),
      vehicle_id: String(vehicle._id),
      payment_status: IMPORT.payment_status,
      payment_type: IMPORT.payment_type,
      services: estimateServices,
      notes,
    });

    if (IMPORT.estimate_status !== EstimateStatus.SCHEDULED) {
      await estimatesService.updateStatus(String(createdEstimate.id), {
        estimate_status: IMPORT.estimate_status,
      });
    }

    const finalEstimate = await estimatesService.findById(String(createdEstimate.id));

    console.log(
      JSON.stringify(
        {
          skipped: false,
          estimate_id: finalEstimate.id,
          estimate_number: finalEstimate.estimate_number,
          customer_id: String(customer._id),
          vehicle_id: String(vehicle._id),
          estimate_status: finalEstimate.estimate_status,
          payment_status: finalEstimate.payment_status,
          payment_type: finalEstimate.payment_type,
          total: finalEstimate.total,
          labor_total: finalEstimate.labor_total,
          parts_total: finalEstimate.parts_total,
          canned_services: createdOrMatchedCannedServices,
          imported_fee_total: importedFeeTotal,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
