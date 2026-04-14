import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import {
  Estimate,
  EstimateDocument,
} from '../src/estimates/schemas/estimate.schema';
import {
  ServiceCatalog,
  ServiceCatalogDocument,
} from '../src/service-catalog/schemas/service-catalog.schema';

function shouldHardDelete() {
  return process.argv.includes('--delete');
}

async function main() {
  loadEnv();
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  const hardDelete = shouldHardDelete();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const estimateModel = app.get<Model<EstimateDocument>>(
      getModelToken(Estimate.name),
    );
    const serviceCatalogModel = app.get<Model<ServiceCatalogDocument>>(
      getModelToken(ServiceCatalog.name),
    );

    const services = await serviceCatalogModel
      .find({})
      .select({ _id: 1, name: 1, is_active: 1 })
      .lean()
      .exec();

    let deleted = 0;
    let deactivated = 0;
    let stillReferenced = 0;

    for (const service of services) {
      const usageCount = await estimateModel.countDocuments({
        'services.canned_service_id': service._id,
      });

      if (usageCount > 0) {
        stillReferenced += 1;
        continue;
      }

      if (hardDelete) {
        await serviceCatalogModel.deleteOne({ _id: service._id }).exec();
        deleted += 1;
        continue;
      }

      if (service.is_active) {
        await serviceCatalogModel
          .updateOne({ _id: service._id }, { $set: { is_active: false } })
          .exec();
        deactivated += 1;
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: hardDelete ? 'delete' : 'deactivate',
          reviewed: services.length,
          still_referenced: stillReferenced,
          deactivated,
          deleted,
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
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
