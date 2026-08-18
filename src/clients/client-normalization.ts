import { BadRequestException } from '@nestjs/common';
import type { Address } from '../common/schemas/address.schema';
import type { AddressDto } from './dto/create-client.dto';

export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizePhoneSearch(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value.replace(/\D+/g, '');
}

export function buildClientContactKeys(input: {
  email?: string | null;
  phone?: string | null;
  secondary_phone?: string | null;
}): string[] {
  const keys = new Set<string>();
  const email = input.email?.trim().toLowerCase() ?? '';
  if (email) {
    keys.add(`email:${email}`);
  }
  for (const value of [input.phone, input.secondary_phone]) {
    const phone = normalizePhoneSearch(value);
    if (phone) {
      keys.add(`phone:${phone}`);
    }
  }
  return [...keys];
}

export function assertClientPhonesAreDistinct(input: {
  phone?: string | null;
  secondary_phone?: string | null;
}) {
  const primary = normalizePhoneSearch(input.phone);
  const secondary = normalizePhoneSearch(input.secondary_phone);
  if (primary && secondary && primary === secondary) {
    throw new BadRequestException(
      'Mobile phone and other phone must be different.',
    );
  }
}

export function normalizeAddress(
  value?: AddressDto | Address | null,
): Address | null {
  if (!value) {
    return null;
  }

  const address: Address = {
    street: value.street ?? null,
    suite: value.suite ?? null,
    city: value.city ?? null,
    state: value.state ?? null,
    postal_code: value.postal_code ?? null,
    country: value.country ?? null,
  };

  const hasAnyValue = Object.values(address).some(
    (entry) => typeof entry === 'string' && entry.trim().length > 0,
  );
  return hasAnyValue ? address : null;
}

export function normalizeAddressList(
  values?: AddressDto[] | Address[] | null,
): Address[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((entry) => normalizeAddress(entry))
    .filter((entry): entry is Address => entry != null);
}

export function buildDisplayName(input: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
}): string {
  const explicit = input.display_name?.trim();
  if (explicit) {
    return explicit;
  }

  const company = input.company_name?.trim();
  if (company) {
    return company;
  }

  const person = [input.first_name, input.last_name]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' ')
    .trim();
  if (person) {
    return person;
  }

  const phone = input.phone?.trim();
  if (phone) {
    return phone;
  }

  const email = input.email?.trim();
  if (email) {
    return email;
  }

  throw new BadRequestException(
    'A client requires a display name, person name, company name, phone, or email.',
  );
}

export function buildSearchFields(input: {
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  billing_address: Address | null;
  service_addresses: Address[];
}) {
  const nameParts = [input.display_name, input.first_name, input.last_name]
    .map((part) => normalizeSearchText(part))
    .filter((part) => part.length > 0);

  const addressParts = [input.billing_address, ...input.service_addresses]
    .filter((address): address is Address => address != null)
    .flatMap((address) => [
      address.street,
      address.suite,
      address.city,
      address.state,
      address.postal_code,
      address.country,
    ])
    .map((part) => normalizeSearchText(part))
    .filter((part) => part.length > 0);

  return {
    search_name: Array.from(new Set(nameParts)).join(' '),
    search_company: normalizeSearchText(input.company_name),
    search_email: normalizeSearchText(input.email),
    search_phone: normalizePhoneSearch(input.phone),
    search_secondary_phone: normalizePhoneSearch(input.secondary_phone),
    search_addresses: Array.from(new Set(addressParts)).join(' '),
  };
}

export function assertClientHasIdentity(payload: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}) {
  const hasIdentity = [
    payload.display_name,
    payload.first_name,
    payload.last_name,
    payload.company_name,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);

  if (!hasIdentity) {
    throw new BadRequestException('A client name or company name is required.');
  }
}
