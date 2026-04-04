import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'fs';
import path from 'path';
import { Types, connect, connection, disconnect } from 'mongoose';

type SeedCustomerVehicle = {
  source_row: number;
  source_vehicle_id: string;
  payload: {
    color: string | null;
    year: number | null;
    make: string;
    model: string;
    sub_model: string | null;
    mileage: number | null;
    vin: string | null;
    license_plate: string | null;
  };
  is_incomplete?: boolean;
  missing_fields?: string[];
};

type SeedCustomer = {
  source_customer_id: string;
  alias_source_customer_ids?: string[];
  payload: {
    first_name: string;
    last_name: string;
    phone: string;
    email: string | null;
  };
  vehicles: SeedCustomerVehicle[];
};

type SeedFile = {
  customers: SeedCustomer[];
};

function getSeedPath() {
  const fromArg = process.argv[2];
  if (fromArg) {
    return path.resolve(process.cwd(), fromArg);
  }

  return path.resolve(
    __dirname,
    '..',
    '..',
    'customer-vehicles-24_03_2026.seed.json',
  );
}

async function ensureVehicleIndexes() {
  const db = connection.db;
  if (!db) {
    throw new Error('Mongo connection did not expose a database handle.');
  }

  const vehicles = db.collection('vehicles');
  const existingIndexes = await vehicles.indexes();
  for (const indexName of ['vin_1', 'license_plate_1']) {
    if (existingIndexes.some((index) => index.name === indexName)) {
      await vehicles.dropIndex(indexName);
    }
  }

  await vehicles.createIndex(
    { vin: 1 },
    {
      name: 'vin_1',
      unique: true,
      partialFilterExpression: {
        vin: { $type: 'string' },
      },
    },
  );
  await vehicles.createIndex(
    { license_plate: 1 },
    {
      name: 'license_plate_1',
      unique: true,
      partialFilterExpression: {
        license_plate: { $type: 'string' },
      },
    },
  );
}

async function main() {
  loadEnv();

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required to import customer and vehicle seed data.');
  }

  const seedPath = getSeedPath();
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile;
  if (!Array.isArray(seed.customers) || seed.customers.length === 0) {
    throw new Error(`Seed file ${seedPath} does not contain any customers.`);
  }

  await connect(mongoUri);

  const db = connection.db;
  if (!db) {
    throw new Error('Mongo connection did not expose a database handle.');
  }

  const customers = db.collection('customers');
  const vehicles = db.collection('vehicles');

  const [customerCount, vehicleCount] = await Promise.all([
    customers.countDocuments(),
    vehicles.countDocuments(),
  ]);
  if (customerCount > 0 || vehicleCount > 0) {
    throw new Error(
      `Import expects empty customers and vehicles collections. Found customers=${customerCount}, vehicles=${vehicleCount}.`,
    );
  }

  await ensureVehicleIndexes();

  const now = new Date();
  const customerDocs = seed.customers.map((customer) => ({
    _id: new Types.ObjectId(),
    first_name: customer.payload.first_name,
    last_name: customer.payload.last_name,
    phone: customer.payload.phone,
    email: customer.payload.email,
    is_archived: false,
    created_at: now,
    updated_at: now,
  }));

  await customers.insertMany(customerDocs, { ordered: true });

  const customerIdBySourceId = new Map<string, Types.ObjectId>();
  seed.customers.forEach((customer, index) => {
    const insertedId = customerDocs[index]._id as Types.ObjectId;
    customerIdBySourceId.set(customer.source_customer_id, insertedId);
    for (const aliasId of customer.alias_source_customer_ids || []) {
      customerIdBySourceId.set(aliasId, insertedId);
    }
  });

  const vehicleDocs = seed.customers.flatMap((customer) => {
    const customerId = customerIdBySourceId.get(customer.source_customer_id);
    if (!customerId) {
      throw new Error(
        `Unable to resolve inserted customer id for source customer ${customer.source_customer_id}.`,
      );
    }

    return customer.vehicles.map((vehicle) => ({
      _id: new Types.ObjectId(),
      customer_id: customerId,
      color: vehicle.payload.color,
      year: vehicle.payload.year,
      make: vehicle.payload.make,
      model: vehicle.payload.model,
      sub_model: vehicle.payload.sub_model,
      mileage: vehicle.payload.mileage,
      vin: vehicle.payload.vin,
      license_plate: vehicle.payload.license_plate,
      is_incomplete:
        vehicle.is_incomplete === true ||
        !vehicle.payload.vin ||
        !vehicle.payload.license_plate,
      is_archived: false,
      created_at: now,
      updated_at: now,
    }));
  });

  if (vehicleDocs.length > 0) {
    await vehicles.insertMany(vehicleDocs, { ordered: true });
  }

  console.log(
    JSON.stringify(
      {
        seedPath,
        inserted_customers: customerDocs.length,
        inserted_vehicles: vehicleDocs.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnect();
  });
