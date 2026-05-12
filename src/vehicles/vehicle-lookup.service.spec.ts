import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { VehicleLookupService } from './vehicle-lookup.service';

describe('VehicleLookupService', () => {
  let service: VehicleLookupService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new VehicleLookupService();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('rejects VIN lookup requests without a valid 17-character VIN', async () => {
    await expect(service.lookupByVin('123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps NHTSA VIN data into the vehicle lookup contract', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        Results: [
          {
            VIN: '2HGES165X3H619036',
            ModelYear: '2003',
            Make: 'HONDA',
            Model: 'Civic',
            Trim: 'LX',
            Series: '',
            BodyClass: 'Sedan/Saloon',
            DisplacementL: '1.7',
            EngineCylinders: '4',
            EngineModel: 'D17A1',
            FuelTypePrimary: 'Gasoline',
            Manufacturer: 'HONDA OF CANADA MFG., INC.',
            ErrorCode: '0',
            ErrorText: '0 - VIN decoded clean. Check Digit is correct.',
          },
        ],
      }),
    } as Response);

    await expect(service.lookupByVin('2hges165x3h619036')).resolves.toEqual({
      source: 'nhtsa',
      vin: '2HGES165X3H619036',
      year: 2003,
      make: 'HONDA',
      model: 'Civic',
      sub_model: 'LX',
      color: null,
      body_class: 'Sedan/Saloon',
      engine: '1.7L 4 cyl D17A1',
      fuel_type: 'Gasoline',
      manufacturer: 'HONDA OF CANADA MFG., INC.',
      error_code: '0',
      error_text: '0 - VIN decoded clean. Check Digit is correct.',
      is_valid: true,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/2HGES165X3H619036?format=json',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
        },
      }),
    );
  });

  it('surfaces unavailable NHTSA responses as a gateway error', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);

    await expect(
      service.lookupByVin('2HGES165X3H619036'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('marks NHTSA responses with VIN errors as invalid', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        Results: [
          {
            VIN: '2HGES165X3H619036',
            ModelYear: '2003',
            Make: 'HONDA',
            Model: 'Civic',
            ErrorCode: '1,5',
            ErrorText: '1 - Check Digit does not calculate properly',
          },
        ],
      }),
    } as Response);

    await expect(service.lookupByVin('2HGES165X3H619036')).resolves.toMatchObject({
      year: 2003,
      make: 'HONDA',
      model: 'Civic',
      error_code: '1,5',
      error_text: '1 - Check Digit does not calculate properly',
      is_valid: false,
    });
  });
});
