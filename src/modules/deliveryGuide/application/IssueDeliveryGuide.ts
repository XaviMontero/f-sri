import { IssuerRepository, SequenceGenerator } from '../../../application/ports/repositories';
import { Clock } from '../../../application/ports/runtime';
import { DocumentIssuance } from '../../../application/use-cases/DocumentIssuance';
import { Actor } from '../../../application/use-cases/IssueInvoice';
import { EmissionDate } from '../../../domain/invoice/EmissionDate';
import { DocumentStatus } from '../../../domain/sri/DocumentStatus';
import { Carrier, DeliveryGuide, DeliveryGuideRecipient } from '../domain/DeliveryGuide';
import { DeliveryGuideRecord, DeliveryGuideRepository, DeliveryGuideXml } from './ports';

export interface IssueDeliveryGuideCommand {
  issuerRuc: string;
  /** dd/mm/aaaa; por defecto, hoy en Ecuador. Solo se usa en la clave de acceso. */
  emissionDate?: string;
  departureAddress: string;
  carrier: Carrier;
  /** dd/mm/aaaa. */
  transportStart: string;
  /** dd/mm/aaaa. */
  transportEnd: string;
  plate: string;
  recipients: DeliveryGuideRecipient[];
  additionalInfo?: Record<string, string>;
  /** Payload original, para auditoría. */
  rawRequest?: unknown;
}

export interface IssueDeliveryGuideDeps {
  issuers: IssuerRepository;
  sequences: SequenceGenerator;
  guides: DeliveryGuideRepository;
  xml: DeliveryGuideXml;
  clock?: Clock;
  random?: () => number;
}

/**
 * Caso de uso "emitir guía de remisión": resuelve el emisor (acotado a la empresa del
 * usuario), valida el agregado, reserva secuencial + clave de acceso, genera el XML y lo
 * persiste PENDIENTE. Firma y envío al SRI van por el pipeline común.
 */
export class IssueDeliveryGuide {
  private readonly issuance: DocumentIssuance;

  constructor(private readonly deps: IssueDeliveryGuideDeps) {
    this.issuance = new DocumentIssuance(deps);
  }

  async execute(command: IssueDeliveryGuideCommand, actor: Actor = {}): Promise<DeliveryGuideRecord> {
    const issuerRecord = await this.issuance.issuer(command.issuerRuc, actor);
    const emissionDate = this.issuance.emissionDate(command.emissionDate);

    // Validar antes de consumir un secuencial: un error de datos no debe dejar huecos.
    const draft = DeliveryGuide.create({
      issuer: issuerRecord.issuer,
      emissionDate,
      departureAddress: command.departureAddress,
      carrier: command.carrier,
      transportStart: EmissionDate.parse(command.transportStart),
      transportEnd: EmissionDate.parse(command.transportEnd),
      plate: command.plate,
      recipients: command.recipients,
      additionalInfo: command.additionalInfo,
    });

    const { sequential, accessKey } = await this.issuance.allocate(issuerRecord, draft.documentType, emissionDate);
    const guide = draft.withNumbering({ sequential, accessKey: accessKey.value });

    return this.deps.guides.create({
      issuerId: issuerRecord.id,
      documentType: guide.documentType,
      accessKey: guide.accessKey,
      sequential: guide.sequential,
      number: guide.number,
      environment: guide.issuer.environment,
      emissionDate: guide.emissionDate.toDate(),
      status: DocumentStatus.PENDING,
      xml: this.deps.xml.render(guide),
      departureAddress: guide.departureAddress,
      carrier: guide.carrier,
      transportStart: guide.transportStart.toDate(),
      transportEnd: guide.transportEnd.toDate(),
      plate: guide.plate,
      recipients: guide.recipients,
      additionalInfo: guide.additionalInfo,
      request: command.rawRequest,
    });
  }
}
