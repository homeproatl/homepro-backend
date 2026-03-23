import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { connect, connection, disconnect } from 'mongoose';

async function main() {
  loadEnv();

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required to reset the database.');
  }

  await connect(mongoUri);

  const db = connection.db;
  if (!db) {
    throw new Error('Mongo connection did not expose a database handle.');
  }

  const collections = await db.listCollections().toArray();
  const keep = new Set(['users']);
  const dropped: string[] = [];

  for (const collection of collections) {
    if (!collection.name || keep.has(collection.name)) {
      continue;
    }
    await db.collection(collection.name).drop().catch((error: unknown) => {
      const codeName = (error as { codeName?: string }).codeName;
      if (codeName !== 'NamespaceNotFound') {
        throw error;
      }
    });
    dropped.push(collection.name);
  }

  console.log(
    JSON.stringify(
      {
        preserved: ['users'],
        dropped: dropped.sort(),
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
