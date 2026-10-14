import { InvoiceStatus } from '../../domain/invoice/InvoiceStatus';
import { NotFoundError } from '../../domain/shared/errors';
import { InvoiceRecord, InvoiceRepository, RidePublisher } from '../ports/repositories';
import { Clock, Logger, Sleeper, realSleep, silentLogger, systemClock } from '../ports/runtime';
import { CertificateStore, DocumentSigner } from '../ports/signing';
import { SriCommunicationError, SriGateway, SriMessage } from '../ports/sri';

/**
 * Mensajes de recepción que no son un rechazo: el comprobante ya está en el SRI
 * (43 = clave de acceso registrada, 70 = clave en procesamiento), así que se consulta la autorización.
 */
const ALREADY_RECEIVED_CODES = new Set(['43', '70']);

/** Error 45: el secuencial ya fue usado en otro comprobante de la misma serie. */
const SEQUENTIAL_ALREADY_USED = '45';

export interface SubmitOptions {
  /** Consultas de autorización antes de dejar la factura EN PROCESO. */
  authorizationAttempts: number;
  /** Espera entre consultas (el SRI suele autorizar en 1–5 s). */
  authorizationDelayMs: number;
}

export interface SubmitInvoiceDeps {
  invoices: InvoiceRepository;
  certificates: CertificateStore;
  signer: DocumentSigner;
  sri: SriGateway;
  ride?: RidePublisher;
  clock?: Clock;
  sleep?: Sleeper;
  logger?: Logger;
  options?: Partial<SubmitOptions>;
}

const DEFAULT_OPTIONS: SubmitOptions = { authorizationAttempts: 6, authorizationDelayMs: 3000 };

/**
 * Caso de uso "enviar al SRI": firma (XAdES-BES), envía a recepción y consulta la
 * autorización. Es idempotente y reanudable: retoma desde el último paso completado,
 * por lo que sirve tanto para el primer envío como para reintentos.
 */
export class SubmitInvoiceToSri {
  private readonly options: SubmitOptions;
  private readonly clock: Clock;
  private readonly sleep: Sleeper;
  private readonly logger: Logger;

  constructor(private readonly deps: SubmitInvoiceDeps) {
    this.options = { ...DEFAULT_OPTIONS, ...deps.options };
    this.clock = deps.clock ?? systemClock;
    this.sleep = deps.sleep ?? realSleep;
    this.logger = deps.logger ?? silentLogger;
  }

  async execute(invoiceId: string): Promise<InvoiceRecord> {
    let invoice = await this.deps.invoices.findById(invoiceId);
    if (!invoice) throw new NotFoundError('Factura no encontrada');
    if (invoice.status === InvoiceStatus.AUTHORIZED) return invoice;

    try {
      if (!invoice.signedXml) {
        invoice = await this.sign(invoice);
        if (invoice.status === InvoiceStatus.SIGNING_ERROR) return invoice;
      }
      if (!isAlreadyAtSri(invoice.status)) {
        invoice = await this.send(invoice);
        if (invoice.status === InvoiceStatus.RETURNED) return invoice;
      }
      return await this.authorize(invoice);
    } catch (error) {
      if (error instanceof SriCommunicationError) {
        this.logger.warn('SRI no disponible, la factura queda para reintento', {
          accessKey: invoice.accessKey,
          error: error.message,
        });
        return this.deps.invoices.update(invoice.id, {
          status: InvoiceStatus.COMMUNICATION_ERROR,
          messages: [technicalMessage(error.message)],
        });
      }
      throw error;
    }
  }

  private async sign(invoice: InvoiceRecord): Promise<InvoiceRecord> {
    try {
      const certificate = await this.deps.certificates.forIssuer(invoice.issuerId);
      const signedXml = await this.deps.signer.sign(invoice.xml, certificate);
      return this.deps.invoices.update(invoice.id, { signedXml, status: InvoiceStatus.SIGNED, messages: [] });
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error('No se pudo firmar la factura', { accessKey: invoice.accessKey, error: message });
      return this.deps.invoices.update(invoice.id, {
        status: InvoiceStatus.SIGNING_ERROR,
        messages: [technicalMessage(message)],
      });
    }
  }

  private async send(invoice: InvoiceRecord): Promise<InvoiceRecord> {
    const sentAt = this.clock.now();
    const reception = await this.deps.sri.send(invoice.signedXml!, invoice.environment);
    const alreadyReceived = reception.messages.some((m) => ALREADY_RECEIVED_CODES.has(m.identifier));

    if (reception.status === 'DEVUELTA' && !alreadyReceived) {
      this.logger.warn('Factura DEVUELTA por el SRI', { accessKey: invoice.accessKey, messages: reception.messages });
      const messages = reception.messages.map((m) =>
        m.identifier === SEQUENTIAL_ALREADY_USED && !m.additionalInfo
          ? {
              ...m,
              additionalInfo:
                'El SRI ya tiene ese secuencial: configure `ultimo_secuencial` de la empresa con el último número emitido',
            }
          : m,
      );
      return this.deps.invoices.update(invoice.id, {
        status: InvoiceStatus.RETURNED,
        sentAt,
        respondedAt: this.clock.now(),
        messages,
      });
    }
    return this.deps.invoices.update(invoice.id, {
      status: InvoiceStatus.RECEIVED,
      sentAt,
      respondedAt: this.clock.now(),
      messages: reception.messages,
    });
  }

  private async authorize(invoice: InvoiceRecord): Promise<InvoiceRecord> {
    for (let attempt = 1; attempt <= this.options.authorizationAttempts; attempt++) {
      const result = await this.deps.sri.authorize(invoice.accessKey, invoice.environment);

      if (result.status === 'AUTORIZADO') {
        const authorized = await this.deps.invoices.update(invoice.id, {
          status: InvoiceStatus.AUTHORIZED,
          authorizationNumber: result.authorizationNumber ?? invoice.accessKey,
          authorizationDate: result.authorizationDate ?? this.clock.now(),
          authorizedXml: result.authorizedXml,
          respondedAt: this.clock.now(),
          messages: result.messages,
        });
        this.logger.info('Factura AUTORIZADA por el SRI', { accessKey: invoice.accessKey, number: invoice.number });
        await this.publishRide(authorized);
        return authorized;
      }
      if (result.status === 'NO AUTORIZADO') {
        this.logger.warn('Factura NO AUTORIZADA', { accessKey: invoice.accessKey, messages: result.messages });
        return this.deps.invoices.update(invoice.id, {
          status: InvoiceStatus.NOT_AUTHORIZED,
          respondedAt: this.clock.now(),
          messages: result.messages,
        });
      }
      if (attempt < this.options.authorizationAttempts) {
        await this.sleep(this.options.authorizationDelayMs);
      }
    }
    return this.deps.invoices.update(invoice.id, { status: InvoiceStatus.IN_PROCESS, respondedAt: this.clock.now() });
  }

  /** El RIDE es un subproducto: si falla no revierte la autorización. */
  private async publishRide(invoice: InvoiceRecord): Promise<void> {
    if (!this.deps.ride) return;
    try {
      await this.deps.ride.publish(invoice);
    } catch (error) {
      this.logger.error('No se pudo generar el RIDE', {
        accessKey: invoice.accessKey,
        error: (error as Error).message,
      });
    }
  }
}

function isAlreadyAtSri(status: string): boolean {
  return (
    status === InvoiceStatus.RECEIVED || status === InvoiceStatus.IN_PROCESS || status === InvoiceStatus.NOT_AUTHORIZED
  );
}

function technicalMessage(message: string): SriMessage {
  return { identifier: 'LOCAL', message, type: 'ERROR' };
}
