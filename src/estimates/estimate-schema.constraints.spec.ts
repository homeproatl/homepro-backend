import { Customer } from '../customers/schemas/customer.schema';
import {
  EstimateLaborLineSchema,
  EstimatePartLineSchema,
  EstimateSchema,
  EstimateServiceEntrySchema,
} from '../estimates/schemas/estimate.schema';
import { ServiceCatalog } from '../service-catalog/schemas/service-catalog.schema';
import { User } from '../users/schemas/user.schema';
import { UserSchema } from '../users/schemas/user.schema';
import { VehicleSchema } from '../vehicles/schemas/vehicle.schema';

describe('estimate schema constraints', () => {
  it('enforces uniqueness on key fields', () => {
    expect(UserSchema.path('email').options.unique).toBe(true);
    expect(EstimateSchema.path('estimate_number').options.unique).toBe(true);
  });

  it('uses partial unique indexes for optional vehicle identifiers', () => {
    const indexEntries = VehicleSchema.indexes();
    expect(indexEntries).toEqual(
      expect.arrayContaining([
        [
          { vin: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { vin: { $type: 'string' } },
          }),
        ],
        [
          { license_plate: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: {
              license_plate: { $type: 'string' },
            },
          }),
        ],
      ]),
    );
  });

  it('wires estimate relationship refs', () => {
    expect(EstimateSchema.path('customer_id').options.ref).toBe(Customer.name);
    expect(EstimateSchema.path('assigned_user_id').options.ref).toBe(User.name);
    expect(EstimateLaborLineSchema.path('assigned_user_id').options.ref).toBe(
      User.name,
    );
    expect(EstimateServiceEntrySchema.path('canned_service_id').options.ref).toBe(
      ServiceCatalog.name,
    );
  });

  it('uses enum constraints on estimate and payment statuses', () => {
    expect(EstimateSchema.path('estimate_status').options.enum).toBeDefined();
    expect(EstimateSchema.path('payment_status').options.enum).toBeDefined();
    expect(EstimateSchema.path('payment_type').options.enum).toBeDefined();
  });

  it('embeds grouped service, labor, and part line collections on estimates', () => {
    expect(EstimateSchema.path('services').instance).toBe('Array');
    expect(EstimateServiceEntrySchema.path('labor_lines').instance).toBe('Array');
    expect(EstimateServiceEntrySchema.path('part_lines').instance).toBe('Array');
  });

  it('applies numeric constraints to grouped line items', () => {
    expect(EstimateLaborLineSchema.path('hours').options.min).toBe(0);
    expect(EstimateLaborLineSchema.path('rate').options.min).toBe(0);
    expect(EstimateLaborLineSchema.path('discount_percent').options.max).toBe(100);
    expect(EstimatePartLineSchema.path('quantity').options.min).toBe(1);
    expect(EstimatePartLineSchema.path('price').options.min).toBe(0);
    expect(EstimatePartLineSchema.path('discount_percent').options.max).toBe(100);
  });
});
