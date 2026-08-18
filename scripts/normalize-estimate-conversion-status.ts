import 'reflect-metadata';
import { getModelToken } from '@nestjs/mongoose';
import { NestFactory } from '@nestjs/core';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import {
  OrgDocument,
  OrgDocumentDocument,
} from '../src/documents/schemas/document.schema';
import { normalizeEstimateConversionStatus } from '../src/migrations/joist/normalize-estimate-conversion-status';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const documentModel = app.get<Model<OrgDocumentDocument>>(
      getModelToken(OrgDocument.name),
    );
    const result = await normalizeEstimateConversionStatus(documentModel);
    console.log(
      `Normalized ${result.modifiedCount} estimate status record(s).`,
    );
  } finally {
    await app.close();
  }
}

void run();
