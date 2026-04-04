import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { connect, connection, disconnect } from 'mongoose';

async function main() {
  loadEnv();

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required to migrate vehicle indexes.');
  }

  await connect(mongoUri);

  const db = connection.db;
  if (!db) {
    throw new Error('Mongo connection did not expose a database handle.');
  }

  const vehicles = db.collection('vehicles');
  const existingIndexes = await vehicles.indexes();
  const dropped: string[] = [];

  for (const indexName of ['vin_1', 'license_plate_1']) {
    if (!existingIndexes.some((index) => index.name === indexName)) {
      continue;
    }
    await vehicles.dropIndex(indexName);
    dropped.push(indexName);
  }

  await vehicles.updateMany(
    {},
    [
      {
        $set: {
          vin: {
            $cond: [
              {
                $or: [
                  { $eq: ['$vin', ''] },
                  { $eq: ['$vin', null] },
                ],
              },
              null,
              '$vin',
            ],
          },
          license_plate: {
            $cond: [
              {
                $or: [
                  { $eq: ['$license_plate', ''] },
                  { $eq: ['$license_plate', null] },
                ],
              },
              null,
              '$license_plate',
            ],
          },
        },
      },
      {
        $set: {
          is_incomplete: {
            $or: [
              { $eq: ['$vin', null] },
              { $eq: ['$license_plate', null] },
            ],
          },
        },
      },
    ],
  );

  const created = await Promise.all([
    vehicles.createIndex(
      { vin: 1 },
      {
        name: 'vin_1',
        unique: true,
        partialFilterExpression: {
          vin: { $type: 'string' },
        },
      },
    ),
    vehicles.createIndex(
      { license_plate: 1 },
      {
        name: 'license_plate_1',
        unique: true,
        partialFilterExpression: {
          license_plate: { $type: 'string' },
        },
      },
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        dropped,
        created,
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
