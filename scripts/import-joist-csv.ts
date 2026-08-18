/**
 * Idempotent Joist CSV migration staging.
 *
 * Dry-run is the default. Use --apply to persist the review queue and add
 * --promote-catalog to upsert only Clients and Items with stable Joist IDs.
 * Estimate/invoice summary rows are never promoted into editable documents.
 */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { connect, connection, disconnect, Types } from 'mongoose';
import {
  normalizeJoistName,
  parseJoistCsv,
  type JoistImportRow,
} from '../src/migrations/joist/joist-csv-parser';

type Args = {
  organizationId: string | null;
  sourceAccountId: string | null;
  batchId: string;
  files: string[];
  apply: boolean;
  promoteCatalog: boolean;
  reportFile: string | null;
};

type ClientCandidate = {
  id: string | null;
  source_id: string | null;
  display_name: string;
};

function argumentValues(argv: string[], name: string) {
  const prefix = `--${name}=`;
  return argv
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => entry.slice(prefix.length));
}

function parseArgs(argv: string[]): Args {
  const organizationId = argumentValues(argv, 'organization-id')[0] ?? '';
  const files = argumentValues(argv, 'file');
  if (files.length === 0) {
    throw new Error(
      'Provide at least one --file=/absolute/path/export.csv argument.',
    );
  }
  const apply = argv.includes('--apply') && !argv.includes('--dry-run');
  if (apply && !Types.ObjectId.isValid(organizationId)) {
    throw new Error(
      '--organization-id=<Mongo ObjectId> is required with --apply.',
    );
  }
  if (!apply && organizationId && !Types.ObjectId.isValid(organizationId)) {
    throw new Error(
      '--organization-id must be a valid Mongo ObjectId when supplied.',
    );
  }
  const promoteCatalog = argv.includes('--promote-catalog');
  if (promoteCatalog && !apply) {
    throw new Error('--promote-catalog requires --apply.');
  }
  return {
    organizationId: organizationId || null,
    sourceAccountId: argumentValues(argv, 'source-account-id')[0] ?? null,
    batchId:
      argumentValues(argv, 'batch-id')[0] ??
      `joist-${new Date().toISOString().slice(0, 10)}`,
    files: files.map((file) => resolve(file)),
    apply,
    promoteCatalog,
    reportFile: argumentValues(argv, 'report-file')[0]
      ? resolve(argumentValues(argv, 'report-file')[0])
      : null,
  };
}

function searchPhone(value: unknown) {
  return typeof value === 'string' ? value.replace(/\D+/g, '') : '';
}

function clientContactKeys(data: Record<string, unknown>) {
  const keys = new Set<string>();
  const email =
    typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (email) keys.add(`email:${email}`);
  for (const value of [data.phone, data.secondary_phone]) {
    const phone = searchPhone(value);
    if (phone) keys.add(`phone:${phone}`);
  }
  return [...keys];
}

function searchAddress(address: Record<string, unknown> | null) {
  return address
    ? Object.values(address)
        .filter((value): value is string => typeof value === 'string')
        .map(normalizeJoistName)
        .filter(Boolean)
        .join(' ')
    : '';
}

async function ensureIndexes() {
  const staging = connection.collection('joist_import_rows');
  await staging.createIndex(
    { organization_id: 1, entity_type: 1, source_key: 1 },
    { unique: true, name: 'uniq_joist_staged_source_key' },
  );
  await staging.createIndex(
    { organization_id: 1, resolution_status: 1, entity_type: 1 },
    { name: 'joist_review_queue' },
  );
  await Promise.all([
    ensureSourceIdentityIndex('clients', 'uniq_client_source_identity'),
    ensureSourceIdentityIndex('items', 'uniq_item_source_identity'),
    ensureSourceIdentityIndex('documents', 'uniq_document_source_identity'),
    ensureSourceIdentityIndex('assets', 'uniq_asset_source_identity'),
    ensureSourceIdentityIndex('payments', 'uniq_payment_source_identity'),
  ]);
  await connection.collection('clients').createIndex(
    { organization_id: 1, contact_keys: 1 },
    {
      unique: true,
      partialFilterExpression: { contact_keys: { $type: 'string' } },
      name: 'uniq_client_contact_identity',
    },
  );
}

async function ensureSourceIdentityIndex(
  collectionName: string,
  indexName: string,
) {
  const collection = connection.collection(collectionName);
  const key = {
    organization_id: 1,
    'source_metadata.source_system': 1,
    'source_metadata.source_entity': 1,
    'source_metadata.source_id': 1,
  } as const;
  const expectedKey = JSON.stringify(key);
  const indexes = await collection.indexes().catch(() => []);
  for (const index of indexes) {
    if (JSON.stringify(index.key) !== expectedKey) continue;
    const hasCorrectFilter =
      JSON.stringify(index.partialFilterExpression) ===
      JSON.stringify({ 'source_metadata.source_id': { $type: 'string' } });
    if (
      index.name !== indexName ||
      index.sparse === true ||
      !hasCorrectFilter
    ) {
      await collection.dropIndex(index.name!);
    }
  }
  await collection.createIndex(key, {
    unique: true,
    partialFilterExpression: {
      'source_metadata.source_id': { $type: 'string' },
    },
    name: indexName,
  });
}

async function loadClientCandidates(
  organizationId: Types.ObjectId,
  rows: JoistImportRow[],
) {
  const candidates = new Map<string, ClientCandidate[]>();
  const add = (name: string, candidate: ClientCandidate) => {
    const key = normalizeJoistName(name);
    if (!key) return;
    candidates.set(key, [...(candidates.get(key) ?? []), candidate]);
  };
  const existing = await connection
    .collection('clients')
    .find(
      { organization_id: organizationId },
      { projection: { _id: 1, display_name: 1, source_metadata: 1 } },
    )
    .toArray();
  for (const client of existing) {
    add(String(client.display_name ?? ''), {
      id: String(client._id),
      source_id: client.source_metadata?.source_id
        ? String(client.source_metadata.source_id)
        : null,
      display_name: String(client.display_name ?? ''),
    });
  }
  for (const row of rows.filter((entry) => entry.entity_type === 'client')) {
    const data = row.normalized_data;
    add(String(data.display_name ?? ''), {
      id: null,
      source_id: row.source_id,
      display_name: String(data.display_name ?? ''),
    });
  }
  return candidates;
}

function resolutionFor(
  row: JoistImportRow,
  candidates: Map<string, ClientCandidate[]>,
) {
  if (row.validation_errors.length > 0) {
    return { status: 'invalid', candidates: [] as ClientCandidate[] };
  }
  if (
    row.entity_type === 'estimate_summary' ||
    row.entity_type === 'invoice_summary'
  ) {
    const matches =
      candidates.get(
        String(row.normalized_data.normalized_client_name ?? ''),
      ) ?? [];
    if (matches.length !== 1) {
      row.validation_warnings.push(
        matches.length === 0
          ? 'No unique client match was found.'
          : `${matches.length} clients share this normalized name; manual source-ID matching is required.`,
      );
    }
    return { status: 'needs_review', candidates: matches };
  }
  return { status: 'ready', candidates: [] as ClientCandidate[] };
}

async function promoteCatalogRow(
  row: JoistImportRow,
  organizationId: Types.ObjectId,
  sourceAccountId: string | null,
  batchId: string,
) {
  if (!row.source_id || row.validation_errors.length > 0) return null;
  const now = new Date();
  const sourceMetadata = {
    source_system: 'joist',
    source_account_id: sourceAccountId,
    source_entity: row.entity_type,
    source_id: row.source_id,
    source_created_at: null,
    source_updated_at: null,
    raw_sha256: row.raw_sha256,
    import_batch_id: batchId,
  };
  const identity = {
    organization_id: organizationId,
    'source_metadata.source_system': 'joist',
    'source_metadata.source_entity': row.entity_type,
    'source_metadata.source_id': row.source_id,
  };
  const data = row.normalized_data;
  if (row.entity_type === 'client') {
    const address =
      (data.billing_address as Record<string, unknown> | null) ?? null;
    const displayName = String(data.display_name);
    const result = await connection.collection('clients').findOneAndUpdate(
      identity,
      {
        $set: {
          display_name: displayName,
          first_name: null,
          last_name: null,
          company_name: null,
          phone: data.phone ?? null,
          secondary_phone: data.secondary_phone ?? null,
          email: data.email ?? null,
          billing_address: address,
          service_addresses: data.service_addresses ?? [],
          notes: data.notes ?? null,
          search_name: normalizeJoistName(displayName),
          search_company: '',
          search_email: normalizeJoistName(String(data.email ?? '')),
          search_phone: searchPhone(data.phone),
          search_secondary_phone: searchPhone(data.secondary_phone),
          contact_keys: clientContactKeys(data),
          search_addresses: searchAddress(address),
          customer_source: 'Joist import',
          source_metadata: sourceMetadata,
          updated_at: now,
        },
        $setOnInsert: {
          organization_id: organizationId,
          is_archived: false,
          allows_phone: true,
          allows_sms: true,
          allows_email: true,
          created_at: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    return result?._id ?? null;
  }
  if (row.entity_type === 'item') {
    const result = await connection.collection('items').findOneAndUpdate(
      identity,
      {
        $set: {
          name: data.name,
          normalized_name: data.normalized_name,
          description_template: data.description_template ?? null,
          default_rate_minor: data.default_rate_minor,
          source_rate_decimal: data.source_rate_decimal,
          item_type: data.item_type ?? 'service',
          default_unit_of_measure: null,
          default_internal_unit_cost_minor: null,
          default_vendor_name: null,
          default_sku_or_part_number: null,
          default_waste_basis_points: 0,
          default_markup_type: 'none',
          default_markup_value: 0,
          taxable_default: data.taxable_default ?? true,
          category: null,
          private_notes: null,
          source_metadata: sourceMetadata,
          updated_at: now,
        },
        $setOnInsert: {
          organization_id: organizationId,
          tax_ids: [],
          is_active: true,
          created_at: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    return result?._id ?? null;
  }
  return null;
}

async function run() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required with --apply.');
  }
  if (args.apply) await connect(process.env.MONGO_URI!);
  const organizationId = args.organizationId
    ? new Types.ObjectId(args.organizationId)
    : null;
  const parsedFiles = await Promise.all(
    args.files.map(async (file) => {
      const content = await readFile(file, 'utf8');
      return {
        file,
        fileHash: createHash('sha256').update(content).digest('hex'),
        parsed: parseJoistCsv(content),
      };
    }),
  );
  const allRows = parsedFiles.flatMap((entry) => entry.parsed.rows);
  const candidates = organizationId
    ? await loadClientCandidates(organizationId, allRows)
    : await loadClientCandidatesOffline(allRows);
  const duplicateKeys = new Set<string>();
  const seenKeys = new Set<string>();
  const duplicateClientContacts = new Set<string>();
  const seenClientContacts = new Set<string>();
  for (const row of allRows) {
    const key = `${row.entity_type}::${row.source_key}`;
    if (seenKeys.has(key)) duplicateKeys.add(key);
    seenKeys.add(key);
    if (row.entity_type === 'client') {
      for (const contactKey of clientContactKeys(row.normalized_data)) {
        if (seenClientContacts.has(contactKey)) {
          duplicateClientContacts.add(contactKey);
        }
        seenClientContacts.add(contactKey);
      }
    }
  }

  const report = {
    mode: args.apply ? 'apply' : 'dry-run',
    batch_id: args.batchId,
    files: [] as Array<Record<string, unknown>>,
    totals: { rows: 0, ready: 0, needs_review: 0, invalid: 0, promoted: 0 },
    issues: [] as Array<Record<string, unknown>>,
  };

  if (args.apply) await ensureIndexes();
  const staging = args.apply
    ? connection.collection('joist_import_rows')
    : null;
  for (const parsedFile of parsedFiles) {
    const fileReport = {
      file: parsedFile.file,
      entity_type: parsedFile.parsed.entity_type,
      rows: parsedFile.parsed.rows.length,
      ready: 0,
      needs_review: 0,
      invalid: 0,
      warnings: 0,
      client_match_missing: 0,
      client_match_unique: 0,
      client_match_ambiguous: 0,
    };
    for (const row of parsedFile.parsed.rows) {
      if (duplicateKeys.has(`${row.entity_type}::${row.source_key}`)) {
        row.validation_errors.push(
          'Duplicate source key exists in the supplied files.',
        );
      }
      if (
        row.entity_type === 'client' &&
        clientContactKeys(row.normalized_data).some((key) =>
          duplicateClientContacts.has(key),
        )
      ) {
        row.validation_errors.push(
          'Email or phone is shared by multiple Joist clients; merge or choose the canonical client before promotion.',
        );
      }
      const resolution = resolutionFor(row, candidates);
      if (row.validation_errors.length || row.validation_warnings.length) {
        report.issues.push({
          file: basename(parsedFile.file),
          entity_type: row.entity_type,
          source_row_number: row.source_row_number,
          source_key: row.source_key,
          errors: row.validation_errors,
          warnings: row.validation_warnings,
        });
      }
      if (
        row.entity_type === 'estimate_summary' ||
        row.entity_type === 'invoice_summary'
      ) {
        if (resolution.candidates.length === 0)
          fileReport.client_match_missing += 1;
        else if (resolution.candidates.length === 1)
          fileReport.client_match_unique += 1;
        else fileReport.client_match_ambiguous += 1;
      }
      fileReport[resolution.status as 'ready' | 'needs_review' | 'invalid'] +=
        1;
      fileReport.warnings += row.validation_warnings.length;
      report.totals[
        resolution.status as 'ready' | 'needs_review' | 'invalid'
      ] += 1;
      report.totals.rows += 1;

      let importedEntityId: Types.ObjectId | null = null;
      if (
        args.apply &&
        args.promoteCatalog &&
        resolution.status === 'ready' &&
        organizationId
      ) {
        importedEntityId = await promoteCatalogRow(
          row,
          organizationId,
          args.sourceAccountId,
          args.batchId,
        );
        if (importedEntityId) report.totals.promoted += 1;
      }
      if (args.apply && staging && organizationId) {
        await staging.updateOne(
          {
            organization_id: organizationId,
            entity_type: row.entity_type,
            source_key: row.source_key,
          },
          {
            $set: {
              import_batch_id: args.batchId,
              source_file_name: basename(parsedFile.file),
              source_file_sha256: parsedFile.fileHash,
              source_row_number: row.source_row_number,
              source_id: row.source_id,
              raw_values: row.raw_values,
              raw_sha256: row.raw_sha256,
              normalized_data: row.normalized_data,
              validation_errors: row.validation_errors,
              validation_warnings: row.validation_warnings,
              resolution_status: importedEntityId
                ? 'imported'
                : resolution.status,
              candidate_clients: resolution.candidates,
              imported_entity_id: importedEntityId,
              imported_at: importedEntityId ? new Date() : null,
              updated_at: new Date(),
            },
            $setOnInsert: {
              organization_id: organizationId,
              created_at: new Date(),
            },
          },
          { upsert: true },
        );
      }
    }
    report.files.push(fileReport);
  }
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  if (args.reportFile) {
    await mkdir(resolve(args.reportFile, '..'), { recursive: true });
    await writeFile(args.reportFile, serializedReport, 'utf8');
  }
  console.log(serializedReport);
}

void run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (connection.readyState !== 0) await disconnect();
  });

async function loadClientCandidatesOffline(rows: JoistImportRow[]) {
  const candidates = new Map<string, ClientCandidate[]>();
  for (const row of rows.filter((entry) => entry.entity_type === 'client')) {
    const displayName = String(row.normalized_data.display_name ?? '');
    const key = normalizeJoistName(displayName);
    if (!key) continue;
    candidates.set(key, [
      ...(candidates.get(key) ?? []),
      {
        id: null,
        source_id: row.source_id,
        display_name: displayName,
      },
    ]);
  }
  return candidates;
}
