import { Customer } from '../customers/schemas/customer.schema';
import { JobSchema } from '../jobs/schemas/job.schema';
import { JobPartSchema } from '../jobs/schemas/job-part.schema';
import { JobServiceSchema } from '../jobs/schemas/job-service.schema';
import { ServiceCatalog } from '../service-catalog/schemas/service-catalog.schema';
import { User } from '../users/schemas/user.schema';
import { UserSchema } from '../users/schemas/user.schema';
import { VehicleSchema } from '../vehicles/schemas/vehicle.schema';

describe('data layer constraints', () => {
  it('enforces uniqueness on key fields', () => {
    expect(UserSchema.path('email').options.unique).toBe(true);
    expect(VehicleSchema.path('vin').options.unique).toBe(true);
    expect(VehicleSchema.path('license_plate').options.unique).toBe(true);
    expect(JobSchema.path('job_number').options.unique).toBe(true);
  });

  it('wires job relationship refs', () => {
    expect(JobSchema.path('customer_id').options.ref).toBe(Customer.name);
    expect(JobSchema.path('assigned_user_id').options.ref).toBe(User.name);
    expect(JobServiceSchema.path('service_id').options.ref).toBe(
      ServiceCatalog.name,
    );
  });

  it('uses enum constraints on job and payment statuses', () => {
    expect(JobSchema.path('job_status').options.enum).toBeDefined();
    expect(JobSchema.path('payment_status').options.enum).toBeDefined();
    expect(JobSchema.path('payment_type').options.enum).toBeDefined();
  });

  it('requires line items to belong to a job', () => {
    expect(JobPartSchema.path('job_id').options.ref).toBe('Job');
    expect(JobServiceSchema.path('job_id').options.ref).toBe('Job');
  });
});
