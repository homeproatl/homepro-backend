import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Resend } from 'resend';
import { SettingsService } from '../settings/settings.service';
import {
  OrgDocument,
  OrgDocumentDocument,
} from '../documents/schemas/document.schema';
import { PaymentDocument } from './schemas/payment.schema';

@Injectable()
export class PaymentNotificationService {
  private readonly logger = new Logger(PaymentNotificationService.name);
  private resendClient: Resend | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
  ) {}

  async send(input: {
    payment: PaymentDocument;
    eventType: string;
    message: string;
  }) {
    const organizationId = String(input.payment.organization_id);
    const settings =
      await this.settingsService.getSnapshotSource(organizationId);
    const recipient = settings.company.email?.trim();
    if (!recipient) {
      this.logger.warn(
        `Payment email skipped: Company email is not configured for org=${organizationId}`,
      );
      return;
    }

    const document = await this.documentModel
      .findOne({
        _id: input.payment.document_id,
        organization_id: input.payment.organization_id,
        type: 'invoice',
      })
      .select('number client_snapshot total_minor balance_due_minor')
      .lean()
      .exec();
    if (!document) {
      throw new Error(
        `Invoice not found for payment=${String(input.payment._id)}`,
      );
    }

    const transport =
      this.configService.get<string>('INVOICE_EMAIL_TRANSPORT') ?? 'DISABLED';
    const companyName =
      settings.company.display_name ??
      settings.company.legal_name ??
      'Home Pro';
    const amount = this.formatMoney(input.payment.amount_minor);
    const balance = this.formatMoney(document.balance_due_minor);
    const subject = `${companyName}: ${input.message} ${document.number}`;
    const text = [
      input.message,
      `Invoice: ${document.number}`,
      `Client: ${document.client_snapshot?.display_name ?? 'Client'}`,
      `Amount: ${amount}`,
      `Remaining balance: ${balance}`,
    ].join('\n');

    if (transport === 'DISABLED') {
      return;
    }
    if (transport === 'LOG') {
      this.logger.log(`Payment email LOG mode -> ${recipient} | ${subject}`);
      return;
    }
    if (transport !== 'RESEND') {
      throw new Error(`Unsupported email transport: ${transport}`);
    }

    const from = this.configService.get<string>('INVOICE_EMAIL_FROM');
    const apiKey = this.configService.get<string>(
      'INVOICE_EMAIL_RESEND_API_KEY',
    );
    if (!from || !apiKey) {
      throw new Error('Resend payment email configuration is incomplete');
    }
    if (!this.resendClient) {
      this.resendClient = new Resend(apiKey);
    }

    const result = await this.resendClient.emails.send(
      {
        from,
        to: [recipient],
        subject,
        text,
      },
      {
        idempotencyKey: [
          'payment-notification',
          String(input.payment._id),
          input.eventType,
          String(input.payment.status),
          String(input.payment.amount_minor),
          String(document.balance_due_minor),
        ]
          .join(':')
          .slice(0, 256),
      },
    );
    if (result.error) {
      throw new Error(result.error.message ?? 'Resend send failed');
    }
  }

  private formatMoney(minor: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(minor / 100);
  }
}
