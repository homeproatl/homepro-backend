import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';

const NHTSA_VPIC_BASE_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const NHTSA_LOOKUP_TIMEOUT_MS = 6000;
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

type NhtsaDecodeVinValuesResponse = {
  Results?: unknown;
};

type NhtsaDecodeVinResult = Record<string, unknown>;

export type VehicleLookupResult = {
  source: 'nhtsa';
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sub_model: string | null;
  color: null;
  body_class: string | null;
  engine: string | null;
  fuel_type: string | null;
  manufacturer: string | null;
  error_code: string | null;
  error_text: string | null;
  is_valid: boolean;
};

function asTrimmedString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseModelYear(value: unknown) {
  const parsed = Number(asTrimmedString(value));
  return Number.isInteger(parsed) && parsed >= 1900 ? parsed : null;
}

function combineEngineSummary(result: NhtsaDecodeVinResult) {
  const engineModel = asTrimmedString(result.EngineModel);
  const displacement = asTrimmedString(result.DisplacementL);
  const cylinders = asTrimmedString(result.EngineCylinders);
  const parts = [
    displacement ? `${displacement}L` : null,
    cylinders ? `${cylinders} cyl` : null,
    engineModel,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' ') : null;
}

function isCleanNhtsaDecode(errorCode: string | null) {
  if (!errorCode) {
    return false;
  }

  return errorCode
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean)
    .every((code) => code === '0');
}

@Injectable()
export class VehicleLookupService {
  async lookupByVin(rawVin: string): Promise<VehicleLookupResult> {
    const vin = rawVin.trim().toUpperCase();

    if (!VIN_PATTERN.test(vin)) {
      throw new BadRequestException(
        'VIN lookup requires a valid 17-character VIN.',
      );
    }

    const result = await this.fetchNhtsaVinValues(vin);
    const errorCode = asTrimmedString(result.ErrorCode);

    return {
      source: 'nhtsa',
      vin,
      year: parseModelYear(result.ModelYear),
      make: asTrimmedString(result.Make),
      model: asTrimmedString(result.Model),
      sub_model:
        asTrimmedString(result.Trim) ?? asTrimmedString(result.Series) ?? null,
      color: null,
      body_class: asTrimmedString(result.BodyClass),
      engine: combineEngineSummary(result),
      fuel_type: asTrimmedString(result.FuelTypePrimary),
      manufacturer: asTrimmedString(result.Manufacturer),
      error_code: errorCode,
      error_text: asTrimmedString(result.ErrorText),
      is_valid: isCleanNhtsaDecode(errorCode),
    };
  }

  private async fetchNhtsaVinValues(vin: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NHTSA_LOOKUP_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${NHTSA_VPIC_BASE_URL}/DecodeVinValues/${encodeURIComponent(
          vin,
        )}?format=json`,
        {
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new BadGatewayException('NHTSA VIN lookup failed.');
      }

      const payload = (await response.json()) as NhtsaDecodeVinValuesResponse;
      const firstResult = Array.isArray(payload.Results)
        ? payload.Results[0]
        : null;

      if (!firstResult || typeof firstResult !== 'object') {
        throw new BadGatewayException('NHTSA VIN lookup returned no vehicle data.');
      }

      return firstResult as NhtsaDecodeVinResult;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException('NHTSA VIN lookup is unavailable.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
