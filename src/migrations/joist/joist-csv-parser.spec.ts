import { parseJoistCsv, parseMoneyDecimal } from './joist-csv-parser';

describe('Joist CSV parser', () => {
  it('parses quoted multiline item notes and retains sub-cent source prices', () => {
    const csv = [
      'Name,Price,Notes,**(Do not change this) Joist Item ID',
      'Custom material,105.852,"First line, with comma\\nSecond line",77381982',
    ]
      .join('\n')
      .replace('\\n', '\n');

    const parsed = parseJoistCsv(csv);

    expect(parsed.entity_type).toBe('item');
    expect(parsed.rows[0].normalized_data).toMatchObject({
      name: 'Custom material',
      default_rate_minor: 10585,
      source_rate_decimal: '105.852',
      description_template: 'First line, with comma\nSecond line',
      item_type: 'service',
      taxable_default: false,
      tax_configuration_state: 'not_exported',
    });
    expect(parsed.rows[0].validation_warnings).toContain(
      'Price has sub-cent precision; rounded cents and the exact source decimal are both retained.',
    );
  });

  it('preserves client source identity and maps the exported address', () => {
    const csv = [
      'Name,Email Address,Phone (mobile),Phone (other),Address,Address 2,City,State / Province,Zip / Postal Code,Private Notes,**(Do not change this) Joist Client ID',
      'Joseph Client,CLIENT@EXAMPLE.COM,6785550100,,1 Main St,Suite 2,Atlanta,GA,30303,Keep this,14679796',
    ].join('\n');

    const row = parseJoistCsv(csv).rows[0];

    expect(row.source_id).toBe('14679796');
    expect(row.normalized_data).toMatchObject({
      display_name: 'Joseph Client',
      email: 'client@example.com',
      billing_address: {
        street: '1 Main St',
        suite: 'Suite 2',
        city: 'Atlanta',
        state: 'GA',
        postal_code: '30303',
      },
    });
  });

  it('keeps named taxes and flags unexplained document totals as read-only', () => {
    const csv = [
      'Invoice #,Client Name,Subtotal,sales,Sales Tax,Total,Date Issued,Date Created,Payment Received Less Refunds',
      '105,Ms Joseph,55885.94,715.75,0,56629.45,2025-12-24,2025-12-25 03:02:45 UTC,10.00',
    ].join('\n');

    const row = parseJoistCsv(csv).rows[0];

    expect(row.normalized_data).toMatchObject({
      number: '105',
      subtotal_minor: 5_588_594,
      tax_total_minor: 71_575,
      total_minor: 5_662_945,
      payment_received_minor: 1_000,
      unexplained_adjustment_minor: 2776,
      migration_state: 'imported_summary',
      tax_breakdown: [
        { name: 'sales', amount_minor: 71_575 },
        { name: 'Sales Tax', amount_minor: 0 },
      ],
    });
    expect(row.validation_warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Export total differs'),
        expect.stringContaining('no line items'),
      ]),
    );
  });

  it('rounds exact decimals deterministically without floating-point drift', () => {
    expect(parseMoneyDecimal('25.814')).toEqual({
      minor: 2581,
      exact_decimal: '25.814',
      had_subcent_precision: true,
    });
    expect(parseMoneyDecimal('25.815').minor).toBe(2582);
  });
});
