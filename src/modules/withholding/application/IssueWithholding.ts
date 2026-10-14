import { DocumentIssuance, DocumentIssuanceDeps } from '../../../application/use-cases/DocumentIssuance';
import { Actor } from '../../../application/use-cases/IssueInvoice';
import { DocumentStatus } from '../../../domain/sri/DocumentStatus';
import { SupportDocumentInput, Withholding, WithholdingProps } from '../domain/Withholding';
import { WithholdingRecord, WithholdingRepository, WithholdingXmlRenderer } from './ports';

export interface IssueWithholdingCommand {
  issuerRuc: string;
  /** dd/mm/aaaa; por defecto, hoy en Ecuador. */
  emissionDate?: string;
  /** mm/aaaa; por defecto, el mes de emisión. */
  fiscalPeriod?: string;
  subject: WithholdingProps['subject'];
  supportDocuments: SupportDocumentInput[];
  additionalInfo?: Record<string, string>;
  /** Payload original, para auditoría. */
  rawRequest?: unknown;
}

export interface IssueWithholdingDeps extends DocumentIssuanceDeps {
  withholdings: WithholdingRepository;
  xml: WithholdingXmlRenderer;
}

/**
 * Caso de uso "emitir comprobante de retención": valida el agregado (antes de reservar el
 * secuencial), genera el XML y lo persiste PENDIENTE. El envío lo hace el pipeline común.
 */
export class IssueWithholding {
  private readonly issuance: DocumentIssuance;

  constructor(private readonly deps: IssueWithholdingDeps) {
    this.issuance = new DocumentIssuance(deps);
  }

  async execute(command: IssueWithholdingCommand, actor: Actor = {}): Promise<WithholdingRecord> {
    const issuer = await this.issuance.issuer(command.issuerRuc, actor);
    const emissionDate = this.issuance.emissionDate(command.emissionDate);
    const withholding = Withholding.create({
      issuer: issuer.issuer,
      emissionDate,
      fiscalPeriod: command.fiscalPeriod,
      subject: command.subject,
      supportDocuments: command.supportDocuments,
      additionalInfo: command.additionalInfo,
    });

    const { sequential, accessKey, number } = await this.issuance.allocate(
      issuer,
      withholding.documentType,
      emissionDate,
    );

    return this.deps.withholdings.create({
      issuerId: issuer.id,
      documentType: withholding.documentType,
      accessKey: accessKey.value,
      sequential,
      number,
      environment: issuer.issuer.environment,
      emissionDate: emissionDate.toDate(),
      status: DocumentStatus.PENDING,
      xml: this.deps.xml.render(withholding, { accessKey: accessKey.value, sequential }),
      subject: withholding.subject,
      fiscalPeriod: withholding.fiscalPeriod,
      totalWithheld: withholding.totalWithheld,
      supportDocuments: withholding.supportDocuments,
      additionalInfo: withholding.additionalInfo,
      request: command.rawRequest,
    });
  }
}
