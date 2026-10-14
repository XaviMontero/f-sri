import { DocumentStatus } from '../../domain/sri/DocumentStatus';
import { NotFoundError } from '../../domain/shared/errors';
import { RidePublisher, SriDocumentRecord, SriDocumentRepository } from '../ports/repositories';
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
  /** Consultas de autorización antes de dejar el comprobante EN PROCESO. */
  authorizationAttempts: number;
  /** Espera entre consultas (el SRI suele autorizar en 1–5 s). */
  authorizationDelayMs: number;
}

export interface SubmitDocumentDeps<T extends SriDocumentRecord> {
  documents: SriDocumentRepository<T>;
  certificates: CertificateStore;
  signer: DocumentSigner;
  sri: SriGateway;
  ride?: RidePublisher<T>;
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
export class SubmitDocumentToSri<T extends SriDocumentRecord = SriDocumentRecord> {
  private readonly options: SubmitOptions;
  private readonly clock: Clock;
  private readonly sleep: Sleeper;
  private readonly logger: Logger;

  constructor(private readonly deps: SubmitDocumentDeps<T>) {
    this.options = { ...DEFAULT_OPTIONS, ...deps.options };
    this.clock = deps.clock ?? systemClock;
    this.sleep = deps.sleep ?? realSleep;
    this.logger = deps.logger ?? silentLogger;
  }

  async execute(documentId: string): Promise<T> {
    let doc = await this.deps.documents.findById(documentId);
    if (!doc) throw new NotFoundError('Comprobante no encontrado');
    if (doc.status === DocumentStatus.AUTHORIZED) return doc;

    try {
      if (!doc.signedXml) {
        doc = await this.sign(doc);
        if (doc.status === DocumentStatus.SIGNING_ERROR) return doc;
      }
      if (!isAlreadyAtSri(doc.status)) {
        doc = await this.send(doc);
        if (doc.status === DocumentStatus.RETURNED) return doc;
      }
      return await this.authorize(doc);
    } catch (error) {
      if (error instanceof SriCommunicationError) {
        this.logger.warn('SRI no disponible, el comprobante queda para reintento', {
          accessKey: doc.accessKey,
          error: error.message,
        });
        return this.deps.documents.update(doc.id, {
          status: DocumentStatus.COMMUNICATION_ERROR,
          messages: [technicalMessage(error.message)],
        });
      }
      throw error;
    }
  }

  private async sign(doc: T): Promise<T> {
    try {
      const certificate = await this.deps.certificates.forIssuer(doc.issuerId);
      const signedXml = await this.deps.signer.sign(doc.xml, certificate);
      return this.deps.documents.update(doc.id, { signedXml, status: DocumentStatus.SIGNED, messages: [] });
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error('No se pudo firmar el comprobante', { accessKey: doc.accessKey, error: message });
      return this.deps.documents.update(doc.id, {
        status: DocumentStatus.SIGNING_ERROR,
        messages: [technicalMessage(message)],
      });
    }
  }

  private async send(doc: T): Promise<T> {
    const sentAt = this.clock.now();
    const reception = await this.deps.sri.send(doc.signedXml!, doc.environment);
    const alreadyReceived = reception.messages.some((m) => ALREADY_RECEIVED_CODES.has(m.identifier));

    if (reception.status === 'DEVUELTA' && !alreadyReceived) {
      this.logger.warn('Comprobante DEVUELTO por el SRI', { accessKey: doc.accessKey, messages: reception.messages });
      const messages = reception.messages.map((m) =>
        m.identifier === SEQUENTIAL_ALREADY_USED && !m.additionalInfo
          ? {
              ...m,
              additionalInfo:
                'El SRI ya tiene ese secuencial: configure `ultimo_secuencial` de la empresa con el último número emitido',
            }
          : m,
      );
      return this.deps.documents.update(doc.id, {
        status: DocumentStatus.RETURNED,
        sentAt,
        respondedAt: this.clock.now(),
        messages,
      });
    }
    return this.deps.documents.update(doc.id, {
      status: DocumentStatus.RECEIVED,
      sentAt,
      respondedAt: this.clock.now(),
      messages: reception.messages,
    });
  }

  private async authorize(doc: T): Promise<T> {
    for (let attempt = 1; attempt <= this.options.authorizationAttempts; attempt++) {
      const result = await this.deps.sri.authorize(doc.accessKey, doc.environment);

      if (result.status === 'AUTORIZADO') {
        const authorized = await this.deps.documents.update(doc.id, {
          status: DocumentStatus.AUTHORIZED,
          authorizationNumber: result.authorizationNumber ?? doc.accessKey,
          authorizationDate: result.authorizationDate ?? this.clock.now(),
          authorizedXml: result.authorizedXml,
          respondedAt: this.clock.now(),
          messages: result.messages,
        });
        this.logger.info('Comprobante AUTORIZADO por el SRI', { accessKey: doc.accessKey, number: doc.number });
        await this.publishRide(authorized);
        return authorized;
      }
      if (result.status === 'NO AUTORIZADO') {
        this.logger.warn('Comprobante NO AUTORIZADO', { accessKey: doc.accessKey, messages: result.messages });
        return this.deps.documents.update(doc.id, {
          status: DocumentStatus.NOT_AUTHORIZED,
          respondedAt: this.clock.now(),
          messages: result.messages,
        });
      }
      if (attempt < this.options.authorizationAttempts) {
        await this.sleep(this.options.authorizationDelayMs);
      }
    }
    return this.deps.documents.update(doc.id, { status: DocumentStatus.IN_PROCESS, respondedAt: this.clock.now() });
  }

  /** El RIDE es un subproducto: si falla no revierte la autorización. */
  private async publishRide(doc: T): Promise<void> {
    if (!this.deps.ride) return;
    try {
      await this.deps.ride.publish(doc);
    } catch (error) {
      this.logger.error('No se pudo generar el RIDE', {
        accessKey: doc.accessKey,
        error: (error as Error).message,
      });
    }
  }
}

function isAlreadyAtSri(status: string): boolean {
  return (
    status === DocumentStatus.RECEIVED ||
    status === DocumentStatus.IN_PROCESS ||
    status === DocumentStatus.NOT_AUTHORIZED
  );
}

function technicalMessage(message: string): SriMessage {
  return { identifier: 'LOCAL', message, type: 'ERROR' };
}
