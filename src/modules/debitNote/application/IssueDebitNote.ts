import { BuyerRepository, IssuerRepository, SequenceGenerator } from '../../../application/ports/repositories';
import { Clock } from '../../../application/ports/runtime';
import { DocumentIssuance } from '../../../application/use-cases/DocumentIssuance';
import { Actor } from '../../../application/use-cases/IssueInvoice';
import { FINAL_CONSUMER_ID, FINAL_CONSUMER_ID_TYPE, FINAL_CONSUMER_NAME } from '../../../domain/invoice/catalogs';
import { EmissionDate } from '../../../domain/invoice/EmissionDate';
import { Buyer, Payment } from '../../../domain/invoice/Invoice';
import { DocumentStatus } from '../../../domain/sri/DocumentStatus';
import { NotFoundError, ValidationError } from '../../../domain/shared/errors';
import { round2 } from '../../../domain/shared/money';
import { DebitNote, DebitNoteReasonProps, DeclaredTax } from '../domain/DebitNote';
import { DebitNoteRecord, DebitNoteRepository, DebitNoteXmlRenderer } from './DebitNoteRecord';

export interface IssueDebitNoteCommand {
  issuerRuc: string;
  /** dd/mm/aaaa; por defecto, hoy en Ecuador. */
  emissionDate?: string;
  buyer: Partial<Buyer> & { idType: string; id: string };
  modifiedDocument: { type: string; number: string; emissionDate: string };
  reasons: DebitNoteReasonProps[];
  declaredTaxes?: DeclaredTax[];
  payments?: Payment[];
  additionalInfo?: Record<string, string>;
  /** Totales calculados por el cliente: si se envían, deben coincidir con los del dominio. */
  expectedTotals?: { subtotal?: number; total?: number };
  rawRequest?: unknown;
}

export interface IssueDebitNoteDeps {
  issuers: IssuerRepository;
  buyers: BuyerRepository;
  sequences: SequenceGenerator;
  debitNotes: DebitNoteRepository;
  xml: DebitNoteXmlRenderer;
  clock?: Clock;
  random?: () => number;
}

/**
 * Caso de uso "emitir nota de débito": valida el agregado (antes de reservar secuencial),
 * asigna numeración, genera el XML y lo persiste como PENDIENTE. La firma y el envío
 * los hace el pipeline genérico {@link SubmitDocumentToSri}.
 */
export class IssueDebitNote {
  private readonly issuance: DocumentIssuance;

  constructor(private readonly deps: IssueDebitNoteDeps) {
    this.issuance = new DocumentIssuance(deps);
  }

  async execute(command: IssueDebitNoteCommand, actor: Actor = {}): Promise<DebitNoteRecord> {
    const issuerRecord = await this.issuance.issuer(command.issuerRuc, actor);
    const emissionDate = this.issuance.emissionDate(command.emissionDate);
    const buyer = await this.resolveBuyer(command.buyer);
    const additionalInfo = { ...defaultAdditionalInfo(buyer), ...(command.additionalInfo ?? {}) };

    const note = DebitNote.create({
      issuer: issuerRecord.issuer,
      buyer,
      emissionDate,
      modifiedDocument: {
        type: command.modifiedDocument?.type,
        number: command.modifiedDocument?.number,
        emissionDate: EmissionDate.parse(command.modifiedDocument?.emissionDate),
      },
      reasons: command.reasons,
      declaredTaxes: command.declaredTaxes,
      payments: command.payments,
      additionalInfo,
    });
    checkExpectedTotals(note, command.expectedTotals);

    const { sequential, accessKey, number } = await this.issuance.allocate(
      issuerRecord,
      note.documentType,
      emissionDate,
    );

    return this.deps.debitNotes.create({
      issuerId: issuerRecord.id,
      documentType: note.documentType,
      buyerRecordId: buyer.recordId,
      buyer: {
        idType: note.buyer.idType,
        id: note.buyer.id,
        name: note.buyer.name,
        address: note.buyer.address,
        email: note.buyer.email,
        phone: note.buyer.phone,
      },
      accessKey: accessKey.value,
      sequential,
      number,
      environment: note.issuer.environment,
      emissionDate: emissionDate.toDate(),
      status: DocumentStatus.PENDING,
      xml: this.deps.xml.render(note, { accessKey: accessKey.value, sequential }),
      modifiedDocument: {
        type: note.modifiedDocument.type,
        number: note.modifiedDocument.number,
        emissionDate: note.modifiedDocument.emissionDate.toDate(),
      },
      reasons: note.reasons,
      taxes: note.taxes.map((t) => ({
        taxCode: t.taxCode,
        ivaCode: t.iva.code,
        rate: t.iva.rate,
        base: t.base,
        value: t.value,
      })),
      subtotal: note.subtotal,
      totalTax: note.totalTax,
      total: note.total,
      payments: note.payments,
      additionalInfo: note.additionalInfo,
      request: command.rawRequest,
    });
  }

  private async resolveBuyer(input: IssueDebitNoteCommand['buyer']): Promise<Buyer & { recordId?: string }> {
    if (!input?.idType || !input.id) {
      throw new ValidationError('tipoIdentificacionComprador e identificacionComprador son requeridos');
    }
    if (input.idType === FINAL_CONSUMER_ID_TYPE) {
      return { idType: FINAL_CONSUMER_ID_TYPE, id: input.id || FINAL_CONSUMER_ID, name: FINAL_CONSUMER_NAME };
    }
    const stored = await this.deps.buyers.findByIdentification(input.id);
    if (stored) {
      return {
        idType: input.idType,
        id: stored.id,
        name: stored.name,
        address: stored.address,
        email: stored.email,
        phone: stored.phone,
        recordId: stored.recordId,
      };
    }
    if (input.name?.trim()) {
      return {
        idType: input.idType,
        id: input.id,
        name: input.name,
        address: input.address,
        email: input.email,
        phone: input.phone,
      };
    }
    throw new NotFoundError('Client not found: envíe razonSocialComprador o registre el cliente', 400);
  }
}

function checkExpectedTotals(note: DebitNote, expected?: IssueDebitNoteCommand['expectedTotals']): void {
  const mismatch = (a: number | undefined, b: number) => a !== undefined && Math.abs(round2(a) - b) > 0.009;
  if (mismatch(expected?.subtotal, note.subtotal) || mismatch(expected?.total, note.total)) {
    throw new ValidationError(
      `Los totales enviados no coinciden con los calculados: totalSinImpuestos ${note.subtotal.toFixed(2)}, ` +
        `IVA ${note.totalTax.toFixed(2)}, valorTotal ${note.total.toFixed(2)}`,
    );
  }
}

function defaultAdditionalInfo(buyer: Buyer): Record<string, string> {
  const info: Record<string, string> = {};
  if (buyer.email) info.Email = buyer.email;
  if (buyer.phone) info['Teléfono'] = buyer.phone;
  if (buyer.address) info['Dirección'] = buyer.address;
  return info;
}
