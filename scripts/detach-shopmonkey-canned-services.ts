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

type EstimateServiceEntryLike = {
  canned_service_id?: unknown;
} & Record<string, unknown>;

function hasCannedServiceId(service: unknown): service is EstimateServiceEntryLike {
  return (
    typeof service === 'object' &&
    service !== null &&
    'canned_service_id' in service &&
    (service as { canned_service_id?: unknown }).canned_service_id !== null &&
    (service as { canned_service_id?: unknown }).canned_service_id !== undefined
  );
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
    const estimateModel = app.get<Model<EstimateDocument>>(
      getModelToken(Estimate.name),
    );

    const estimates = await estimateModel
      .find({
        'source_metadata.source_system': 'shopmonkey',
        'services.canned_service_id': { $ne: null },
      })
      .select({ _id: 1, services: 1 })
      .lean()
      .exec();

    const operations: Array<{
      updateOne: {
        filter: { _id: unknown };
        update: { $set: { services: unknown[] } };
      };
      detachedServices: number;
    }> = [];

    for (const estimate of estimates) {
      const services = Array.isArray(estimate.services) ? estimate.services : [];
      let detachedServices = 0;
      const nextServices = services.map((service) => {
        if (!hasCannedServiceId(service)) {
          return service;
        }
        detachedServices += 1;
        return {
          ...service,
          canned_service_id: null,
        };
      });

      if (detachedServices === 0) {
        continue;
      }

      operations.push({
        updateOne: {
          filter: { _id: estimate._id },
          update: { $set: { services: nextServices } },
        },
        detachedServices,
      });
    }

    if (operations.length === 0) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            estimates_reviewed: estimates.length,
            estimates_updated: 0,
            services_detached: 0,
          },
          null,
          2,
        ),
      );
      return;
    }

    await estimateModel.bulkWrite(
      operations.map((operation) => ({
        updateOne: operation.updateOne,
      })) as never,
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          estimates_reviewed: estimates.length,
          estimates_updated: operations.length,
          services_detached: operations.reduce(
            (sum, operation) => sum + operation.detachedServices,
            0,
          ),
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
