import { EstimateStatus } from '../src/common/enums/estimate-status.enum';
import { PaidStatus } from '../src/common/enums/paid-status.enum';
import { PaymentType } from '../src/common/enums/payment-type.enum';

export type ShopmonkeyCustomerInput = {
  first_name: string;
  last_name: string;
  phone: string;
  email?: string | null;
};

export type ShopmonkeyVehicleInput = {
  year: number | null;
  make: string;
  model: string;
  sub_model?: string | null;
  vin?: string | null;
  license_plate?: string | null;
  mileage?: number | null;
  color?: string | null;
};

export type ShopmonkeyLineTagInput = {
  id?: string | null;
  scope: 'LABOR' | 'PART';
  name: string;
  color:
    | 'slate'
    | 'red'
    | 'orange'
    | 'amber'
    | 'green'
    | 'emerald'
    | 'blue'
    | 'violet';
};

export type ShopmonkeyLaborLineInput = {
  description: string;
  assigned_user_id?: string | null;
  assigned_user_email?: string | null;
  hours: number;
  rate: number;
  discount_percent?: number;
  is_completed?: boolean;
  tags?: ShopmonkeyLineTagInput[];
};

export type ShopmonkeyPartLineInput = {
  name: string;
  part_number?: string | null;
  quantity: number;
  cost?: number | null;
  price: number;
  discount_percent?: number;
  tags?: ShopmonkeyLineTagInput[];
};

export type ShopmonkeyServiceInput = {
  canned_service_name: string;
  estimate_service_name?: string;
  note?: string | null;
  source_displayed_total?: number | null;
  labor_lines: ShopmonkeyLaborLineInput[];
  part_lines: ShopmonkeyPartLineInput[];
};

export type ShopmonkeyPasteImportInput = {
  external_order_id: string;
  external_reference_number: string;
  external_invoice_number?: string | null;
  order_path?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  document_kind?: string | null;
  shop_timezone?: string | null;
  source_state_label?: string | null;
  invoice_status?: string | null;
  appointment_status?: string | null;
  created_at_shop_time?: string | null;
  invoiced_at_shop_time?: string | null;
  title: string;
  customer: ShopmonkeyCustomerInput;
  vehicle: ShopmonkeyVehicleInput;
  assigned_user_id?: string | null;
  assigned_user_email?: string | null;
  estimate_status?: EstimateStatus;
  payment_status?: PaidStatus;
  payment_type?: PaymentType;
  source_grand_total?: number | null;
  customer_comments?: string | null;
  recommendations?: string | null;
  services: ShopmonkeyServiceInput[];
};

const SHOP_TIMEZONE = 'America/New_York';

function cleanLine(line: string) {
  return line.replace(/\u00a0/g, ' ').trim();
}

function splitSegments(raw: string) {
  return raw
    .replace(/\r/g, '')
    .split(/Hyper Icon[^\n]*\n?/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment.includes('Grand Total') && /#\d+:/m.test(segment));
}

function parseCurrency(value: string) {
  const normalized = value.replace(/[$,]/g, '').trim();
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNumber(value: string) {
  const normalized = value.replace(/,/g, '').trim();
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePercent(value: string) {
  const normalized = value.replace(/%/g, '').trim();
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function isCurrencyLine(value: string) {
  return /^\$[\d,]+(?:\.\d+)?$/.test(value.trim());
}

function isNumericLine(value: string) {
  return /^-?\d+(?:\.\d+)?$/.test(value.trim().replace(/,/g, ''));
}

function isPercentLine(value: string) {
  return /^\d+(?:\.\d+)?%$/.test(value.trim());
}

function isDividerLine(value: string) {
  return value.trim() === '—';
}

function isDocumentFooterLine(value: string) {
  return /^(Invoice|Estimate) #\d+$/i.test(value);
}

function isHeaderNoise(value: string) {
  return (
    value === 'Attention: Your browser timezone is different from the . All times are shown using the shop\'s timezone (America/New York).' ||
    /^#\d+:$/.test(value) ||
    /^\d+\s+more$/.test(value) ||
    value === 'OIL SERVICE' ||
    value === 'No file chosen' ||
    value === 'Assignments' ||
    value === 'Add' ||
    value === 'Due Date' ||
    value === 'Payment Terms' ||
    value === 'Customer PO #' ||
    value === 'Workflow Status' ||
    value === 'Order Status' ||
    value === 'Service Writer' ||
    value === 'Technicians' ||
    value === 'Appointment' ||
    value === 'Completed' ||
    value === 'Created' ||
    value === 'Invoiced'
  );
}

function parseName(fullName: string) {
  const normalized = fullName.replace(/\s+/g, ' ').trim();
  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Customer name is missing.');
  }
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: parts[0] };
  }
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(' '),
  };
}

function parseVehicleLine(line: string) {
  const normalized = line.replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(\d{4})\s+(.+)$/);
  if (!match) {
    throw new Error(`Vehicle header "${line}" is not in YEAR MAKE MODEL format.`);
  }
  const year = Number(match[1]);
  const descriptor = match[2].trim();
  const words = descriptor.split(' ').filter(Boolean);
  if (words.length < 2) {
    throw new Error(`Vehicle header "${line}" does not include make and model.`);
  }
  return {
    year,
    make: words[0],
    model: words.slice(1).join(' '),
  };
}

function parseMileageFromVinBlock(lines: string[], vinIndex: number) {
  for (let index = vinIndex + 1; index < Math.min(lines.length, vinIndex + 5); index += 1) {
    const line = lines[index];
    if (!line || line === '/' || line === 'Plate:' || line === 'No file chosen') {
      continue;
    }
    const numeric = parseNumber(line);
    if (numeric !== null) {
      return numeric;
    }
    if (line.includes('/')) {
      const [firstPart] = line.split('/');
      const fromSplit = parseNumber(firstPart);
      if (fromSplit !== null) {
        return fromSplit;
      }
    }
  }
  return null;
}

function nextNonEmpty(lines: string[], start: number) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index]) {
      return { index, value: lines[index] };
    }
  }
  return null;
}

function hasTableStartSoon(lines: string[], start: number, lookahead = 2) {
  let seen = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    if (line === 'Labor' || line === 'Part') {
      return true;
    }
    seen += 1;
    if (seen >= lookahead) {
      return false;
    }
  }
  return false;
}

function joinMeaningfulLines(lines: string[]) {
  const filtered = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return filtered.length > 0 ? filtered.join('\n') : null;
}

function normalizeServiceTitle(value: string) {
  return value === 'Enter Service Title...' ? 'Untitled Service' : value;
}

function parseLaborLines(lines: string[], startIndex: number) {
  let index = startIndex;
  if (lines[index] !== 'Labor') {
    return { lines: [] as ShopmonkeyLaborLineInput[], nextIndex: index };
  }
  index += 7;
  const results: ShopmonkeyLaborLineInput[] = [];

  while (index < lines.length) {
    const description = lines[index];
    if (!description || description === 'Part' || description === 'Add' || isDocumentFooterLine(description)) {
      break;
    }

    index += 1;
    while (
      index < lines.length &&
      !isNumericLine(lines[index]) &&
      !isCurrencyLine(lines[index]) &&
      lines[index] !== 'Part' &&
      lines[index] !== 'Add'
    ) {
      index += 1;
    }

    const hours = index < lines.length ? parseNumber(lines[index]) : null;
    const rate = index + 1 < lines.length ? parseCurrency(lines[index + 1]) : null;
    const discount = index + 2 < lines.length ? parsePercent(lines[index + 2]) : null;
    const subtotal = index + 3 < lines.length ? parseCurrency(lines[index + 3]) : null;
    if (hours === null || rate === null || discount === null || subtotal === null) {
      break;
    }

    results.push({
      description:
        description === 'Enter labor...' ? 'LABOR' : description,
      hours,
      rate,
      discount_percent: discount,
      is_completed: true,
      tags: [],
    });
    index += 4;
  }

  return { lines: results, nextIndex: index };
}

function parsePartLines(lines: string[], startIndex: number) {
  let index = startIndex;
  if (lines[index] !== 'Part') {
    return { lines: [] as ShopmonkeyPartLineInput[], nextIndex: index };
  }
  index += 7;
  const results: ShopmonkeyPartLineInput[] = [];

  while (index < lines.length) {
    const name = lines[index];
    if (!name || name === 'Add' || isDocumentFooterLine(name)) {
      break;
    }

    index += 1;
    const detailLines: string[] = [];
    while (index < lines.length && !isDividerLine(lines[index]) && lines[index] !== 'Add') {
      detailLines.push(lines[index]);
      index += 1;
    }

    if (index >= lines.length || lines[index] !== '—') {
      break;
    }

    const quantity = index + 1 < lines.length ? parseNumber(lines[index + 1]) : null;
    const cost = index + 2 < lines.length ? parseCurrency(lines[index + 2]) : null;
    const price = index + 3 < lines.length ? parseCurrency(lines[index + 3]) : null;
    const discount = index + 4 < lines.length ? parsePercent(lines[index + 4]) : null;
    const subtotal = index + 5 < lines.length ? parseCurrency(lines[index + 5]) : null;

    if (quantity === null || price === null || discount === null || subtotal === null) {
      break;
    }

    const normalizedName =
      detailLines.length > 0 ? `${name} | ${detailLines.join(' | ')}` : name;

    const isPlaceholder =
      name === 'Enter part...' &&
      price === 0 &&
      subtotal === 0;

    if (!isPlaceholder) {
      results.push({
        name: normalizedName,
        part_number: null,
        quantity,
        cost,
        price,
        discount_percent: discount,
        tags: [],
      });
    }

    index += 6;
  }

  return { lines: results, nextIndex: index };
}

function parseServiceDisplayedTotal(lines: string[], startIndex: number) {
  let index = startIndex;
  while (index < lines.length && lines[index] !== 'EPA') {
    index += 1;
  }
  if (index >= lines.length) {
    return { total: null, nextIndex: index };
  }
  const totalLine = nextNonEmpty(lines, index + 1);
  return {
    total: totalLine ? parseCurrency(totalLine.value) : null,
    nextIndex: totalLine ? totalLine.index + 1 : index + 1,
  };
}

function parseServices(contentLines: string[]) {
  const services: ShopmonkeyServiceInput[] = [];
  let index = 0;
  let customerComments: string[] = [];
  let recommendations: string[] = [];

  while (index < contentLines.length) {
    const line = contentLines[index];
    if (!line) {
      index += 1;
      continue;
    }

    if (line === 'Enter customer comments...' || line === 'Enter recommendations...') {
      const target = line === 'Enter customer comments...' ? customerComments : recommendations;
      index += 1;
      while (index < contentLines.length) {
        const current = contentLines[index];
        if (!current) {
          index += 1;
          continue;
        }
        if (hasTableStartSoon(contentLines, index + 1, 2)) {
          break;
        }
        if (current === 'Labor' || current === 'Part' || isDocumentFooterLine(current)) {
          break;
        }
        target.push(current);
        index += 1;
      }
      continue;
    }

    const title = normalizeServiceTitle(line);
    index += 1;
    const noteLines: string[] = [];
    while (index < contentLines.length && contentLines[index] !== 'Labor' && contentLines[index] !== 'Part') {
      if (contentLines[index] === 'Add' || isDocumentFooterLine(contentLines[index])) {
        break;
      }
      if (contentLines[index] !== title) {
        noteLines.push(contentLines[index]);
      }
      index += 1;
    }

    const laborResult = parseLaborLines(contentLines, index);
    index = laborResult.nextIndex;
    const partResult = parsePartLines(contentLines, index);
    index = partResult.nextIndex;
    const displayedTotal = parseServiceDisplayedTotal(contentLines, index);
    index = displayedTotal.nextIndex;

    services.push({
      canned_service_name: title,
      estimate_service_name: title,
      note: joinMeaningfulLines(noteLines),
      source_displayed_total: displayedTotal.total,
      labor_lines: laborResult.lines,
      part_lines: partResult.lines,
    });

    while (
      index < contentLines.length &&
      (contentLines[index] === 'Add' ||
        contentLines[index] === 'Disc.' ||
        contentLines[index] === 'Shop Supplies' ||
        contentLines[index] === 'EPA')
    ) {
      index += 1;
    }
  }

  return {
    services,
    customer_comments: joinMeaningfulLines(customerComments),
    recommendations: joinMeaningfulLines(recommendations),
  };
}

function parseOneSegment(segment: string): ShopmonkeyPasteImportInput {
  const lines = segment
    .split('\n')
    .map(cleanLine)
    .filter((line) => line.length > 0);

  const footerIndex = lines.findIndex(isDocumentFooterLine);
  if (footerIndex === -1) {
    throw new Error('Could not find Invoice/Estimate footer in raw Shopmonkey record.');
  }
  const footerMatch = lines[footerIndex].match(/^(Invoice|Estimate) #(\d+)$/i);
  if (!footerMatch) {
    throw new Error('Could not parse document footer.');
  }
  const documentKind = footerMatch[1].toLowerCase() === 'estimate' ? 'estimate' : 'invoice';
  const orderId = footerMatch[2];
  const orderMarkerIndex = lines.findIndex((line) => line === `#${orderId}:`);
  if (orderMarkerIndex === -1) {
    throw new Error(`Could not find order marker #${orderId}: in raw Shopmonkey record.`);
  }

  const noFileIndex = lines.findIndex((line) => line === 'No file chosen');
  const headerLines = lines.slice(0, noFileIndex === -1 ? orderMarkerIndex : noFileIndex);

  const mobileIndex = headerLines.findIndex((line) => line === 'Mobile:');
  const phone = mobileIndex >= 0 ? headerLines[mobileIndex + 1] ?? null : null;
  const email = headerLines.find((line) => line.includes('@')) ?? null;
  const plateIndex = headerLines.findIndex((line) => line === 'Plate:');
  const plate = plateIndex >= 0 ? headerLines[plateIndex + 1] ?? null : null;
  const vinIndex = headerLines.findIndex((line) => line === 'VIN:');
  const mileage = vinIndex >= 0 ? parseMileageFromVinBlock(headerLines, vinIndex) : null;
  const vehicleHeaderIndex = plateIndex > 0 ? plateIndex - 1 : vinIndex > 0 ? vinIndex - 1 : -1;
  if (vehicleHeaderIndex === -1) {
    throw new Error(`Order #${orderId} is missing a vehicle header.`);
  }
  const vehicleHeader = headerLines[vehicleHeaderIndex];
  const vehicle = parseVehicleLine(vehicleHeader);

  let customerName: string | null = null;
  if (mobileIndex > 0) {
    for (let index = mobileIndex - 1; index >= 0; index -= 1) {
      const candidate = headerLines[index];
      if (
        candidate &&
        !candidate.includes('@') &&
        !isHeaderNoise(candidate) &&
        !/^#\d+:$/.test(candidate) &&
        !/^\d+\s+more$/.test(candidate) &&
        candidate !== vehicleHeader
      ) {
        customerName = candidate;
        break;
      }
    }
  }

  if (!customerName || !phone) {
    throw new Error(
      `Order #${orderId} is missing customer identity required for safe import.`,
    );
  }

  const orderTitle = normalizeServiceTitle(lines[orderMarkerIndex + 1] ?? `Shopmonkey ${orderId}`);
  const contentLines = lines.slice(orderMarkerIndex + 1, footerIndex);
  const parsedBody = parseServices(contentLines);
  const createdAtIndex = lines.findIndex((line) => line === 'Created');
  const invoicedAtIndex = lines.findIndex((line) => line === 'Invoiced');
  const grandTotalIndex = lines.findIndex((line) => line === 'Grand Total');
  const sourceStateLabel =
    lines[footerIndex + 1]?.toLowerCase().includes('paid') ? lines[footerIndex + 1] : null;

  return {
    external_order_id: orderId,
    external_reference_number: orderId,
    external_invoice_number: orderId,
    order_path: null,
    document_kind: documentKind,
    shop_timezone: SHOP_TIMEZONE,
    source_state_label: sourceStateLabel,
    invoice_status: sourceStateLabel,
    appointment_status: lines.includes('Completed') ? 'Completed' : null,
    created_at_shop_time: createdAtIndex >= 0 ? lines[createdAtIndex + 1] ?? null : null,
    invoiced_at_shop_time:
      documentKind === 'invoice' && invoicedAtIndex >= 0
        ? lines[invoicedAtIndex + 1] ?? null
        : null,
    title: parsedBody.services[0]?.estimate_service_name ?? orderTitle,
    customer: {
      ...parseName(customerName),
      phone,
      email,
    },
    vehicle: {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      vin: null,
      license_plate: plate,
      mileage,
    },
    estimate_status: EstimateStatus.COMPLETED,
    payment_status:
      documentKind === 'estimate' ? PaidStatus.UNPAID : PaidStatus.PAID,
    payment_type: PaymentType.POS_CARD,
    source_grand_total:
      grandTotalIndex >= 0 ? parseCurrency(lines[grandTotalIndex + 1] ?? '') : null,
    customer_comments: parsedBody.customer_comments,
    recommendations: parsedBody.recommendations,
    services: parsedBody.services,
  };
}

export function parseRawShopmonkeyPaste(raw: string) {
  const segments = splitSegments(raw);
  if (segments.length === 0) {
    throw new Error('Raw Shopmonkey paste did not contain any recognizable order records.');
  }

  const parsed: ShopmonkeyPasteImportInput[] = [];
  const failures: string[] = [];

  segments.forEach((segment, index) => {
    try {
      parsed.push(parseOneSegment(segment));
    } catch (error) {
      const match =
        segment.match(/(?:Invoice|Estimate) #(\d+)/i) ??
        segment.match(/#(\d+):/);
      const orderId = match?.[1] ?? `segment ${index + 1}`;
      const message =
        error instanceof Error ? error.message : 'Unknown parser failure.';
      failures.push(`Order #${orderId}: ${message}`);
    }
  });

  if (parsed.length === 0) {
    throw new Error(failures.join('\n'));
  }

  if (failures.length > 0) {
    console.warn(
      `[shopmonkey-raw-parser] Skipped ${failures.length} record(s):\n${failures.join('\n')}`,
    );
  }

  return parsed;
}
