import {
  BuyerRepository,
  IssuerRepository,
  ProductRecord,
  ProductRepository,
  SequenceGenerator,
  SriDocumentRecord,
  SriDocumentRepository,
} from '../../../application/ports/repositories';
import { Clock } from '../../../application/ports/runtime';
import { DocumentIssuance } from '../../../application/use-cases/DocumentIssuance';
import { Actor } from '../../../application/use-cases/IssueInvoice';
import { DEFAULT_IVA_CODE } from '../../../domain/invoice/catalogs';
import { EmissionDate } from '../../../domain/invoice/EmissionDate';
import { Buyer } from '../../../domain/invoice/Invoice';
import { InvoiceLineProps } from '../../../domain/invoice/InvoiceLine';
import { NotFoundError, ValidationError } from '../../../domain/shared/errors';
import { round2 } from '../../../domain/shared/money';
import { DocumentStatus } from '../../../domain/sri/DocumentStatus';
import { CreditNote, DOCUMENT_TYPE_CREDIT_NOTE } from '../domain/CreditNote';

export interface CreditNoteLineRecord {
  productId?: string;
  code: string;
  auxiliaryCode?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  subtotal: number;
  ivaCode: string;
  ivaRate: number;
  taxValue: number;
}

export interface CreditNoteTaxRecord {
  taxCode: string;
  ivaCode: string;
  rate: number;
  base: number;
  value: number;
}

export interface CreditNoteRecord extends SriDocumentRecord {
  buyerRecordId?: string;
  buyer: Buyer;
  modifiedDocument: { type: string; number: string; emissionDate: Date };
  reason: string;
  subtotal: number;
  totalTax: number;
  /** valorModificacion. */
  total: number;
  taxes: CreditNoteTaxRecord[];
  lines: CreditNoteLineRecord[];
  additionalInfo?: Record<string, string>;
  request?: unknown;
}

export type NewCreditNoteRecord = Omit<CreditNoteRecord, 'id'>;

export interface CreditNoteRepository extends SriDocumentRepository<CreditNoteRecord> {
  create(record: NewCreditNoteRecord): Promise<CreditNoteRecord>;
}

export interface CreditNoteXmlRenderer {
  render(note: CreditNote): string;
}

export interface IssueCreditNoteLine {
  /** codigoInterno. */
  code: string;
  auxiliaryCode?: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  ivaCode?: string;
  /** precioTotalSinImpuesto enviado por el cliente (solo se valida). */
  expectedSubtotal?: number;
}

export interface IssueCreditNoteCommand {
  issuerRuc: string;
  /** dd/mm/aaaa; por defecto, hoy en Ecuador. */
  emissionDate?: string;
  buyer: Partial<Buyer> & { idType: string; id: string };
  modifiedDocument: { type: string; number: string; emissionDate: string };
  reason: string;
  lines: IssueCreditNoteLine[];
  additionalInfo?: Record<string, string>;
  /** Totales calculados por el cliente: si vienen, deben coincidir con los del dominio. */
  expectedTotals?: { subtotal?: number; total?: number };
  rawRequest?: unknown;
}

export interface IssueCreditNoteDeps {
  issuers: IssuerRepository;
  buyers: BuyerRepository;
  products: ProductRepository;
  sequences: SequenceGenerator;
  creditNotes: CreditNoteRepository;
  xml: CreditNoteXmlRenderer;
  clock?: Clock;
  random?: () => number;
}

/**
 * Caso de uso "emitir nota de crédito": resuelve emisor (acotado a la empresa del usuario),
 * comprador y productos; valida el agregado con totales calculados; recién entonces reserva
 * secuencial y clave de acceso, genera el XML `notaCredito` y lo persiste PENDIENTE.
 */
export class IssueCreditNote {
  private readonly issuance: DocumentIssuance;

  constructor(private readonly deps: IssueCreditNoteDeps) {
    this.issuance = new DocumentIssuance(deps);
  }

  async execute(command: IssueCreditNoteCommand, actor: Actor = {}): Promise<CreditNoteRecord> {
    const issuerRecord = await this.issuance.issuer(command.issuerRuc, actor);
    if (!command.lines?.length) throw new ValidationError('La nota de crédito debe tener al menos un detalle');

    const emissionDate = this.issuance.emissionDate(command.emissionDate);
    const buyer = await this.resolveBuyer(command.buyer);
    const products = await this.deps.products.findByCodes(command.lines.map((l) => l.code));
    const lines = command.lines.map((line) => resolveLine(line, products.get(line.code)));

    const draft = CreditNote.create({
      issuer: issuerRecord.issuer,
      buyer,
      emissionDate,
      modifiedDocument: {
        type: command.modifiedDocument?.type,
        number: command.modifiedDocument?.number,
        emissionDate: EmissionDate.parse(command.modifiedDocument?.emissionDate),
      },
      reason: command.reason,
      lines,
      additionalInfo: { ...defaultAdditionalInfo(buyer), ...(command.additionalInfo ?? {}) },
    });
    checkExpectedLines(draft, command.lines);
    checkExpectedTotals(draft, command.expectedTotals);

    // Solo con el borrador válido se consume el secuencial.
    const { sequential, accessKey } = await this.issuance.allocate(
      issuerRecord,
      DOCUMENT_TYPE_CREDIT_NOTE,
      emissionDate,
    );
    const note = draft.numbered({ sequential, accessKey });

    return this.deps.creditNotes.create({
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
      modifiedDocument: {
        type: note.modifiedDocument.type,
        number: note.modifiedDocument.number,
        emissionDate: note.modifiedDocument.emissionDate.toDate(),
      },
      reason: note.reason,
      accessKey: note.accessKey.value,
      sequential: note.sequential,
      number: note.number,
      environment: note.issuer.environment,
      emissionDate: note.emissionDate.toDate(),
      subtotal: note.totals.subtotal,
      totalTax: note.totals.totalTax,
      total: note.modificationValue,
      taxes: note.totals.taxes.map((t) => ({
        taxCode: t.taxCode,
        ivaCode: t.iva.code,
        rate: t.iva.rate,
        base: t.base,
        value: t.value,
      })),
      status: DocumentStatus.PENDING,
      xml: this.deps.xml.render(note),
      lines: note.lines.map((l) => ({
        productId: products.get(l.code)?.id,
        code: l.code,
        auxiliaryCode: l.auxiliaryCode,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        subtotal: l.subtotal,
        ivaCode: l.iva.code,
        ivaRate: l.iva.rate,
        taxValue: l.taxValue,
      })),
      additionalInfo: note.additionalInfo,
      request: command.rawRequest,
    });
  }

  private async resolveBuyer(input: IssueCreditNoteCommand['buyer']): Promise<Buyer & { recordId?: string }> {
    if (!input?.idType || !input?.id) {
      throw new ValidationError('tipoIdentificacionComprador e identificacionComprador son requeridos');
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
    throw new NotFoundError('Client not found', 400);
  }
}

function resolveLine(line: IssueCreditNoteLine, product?: ProductRecord): InvoiceLineProps {
  if (!product && (line.unitPrice === undefined || !line.description)) {
    throw new NotFoundError(`Product not found: ${line.code}`, 400);
  }
  return {
    code: line.code,
    auxiliaryCode: line.auxiliaryCode,
    description: line.description || product!.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice ?? product!.unitPrice,
    discount: line.discount,
    ivaCode: line.ivaCode ?? (product && !product.chargesIva ? '0' : DEFAULT_IVA_CODE),
  };
}

const differs = (sent: number | undefined, computed: number) =>
  sent !== undefined && Math.abs(round2(sent) - computed) > 0.009;

function checkExpectedLines(note: CreditNote, lines: IssueCreditNoteLine[]): void {
  note.lines.forEach((line, i) => {
    if (differs(lines[i]?.expectedSubtotal, line.subtotal)) {
      throw new ValidationError(
        `precioTotalSinImpuesto del detalle ${line.code} no coincide con el calculado (${line.subtotal.toFixed(2)})`,
      );
    }
  });
}

function checkExpectedTotals(note: CreditNote, expected?: IssueCreditNoteCommand['expectedTotals']): void {
  if (differs(expected?.subtotal, note.totals.subtotal) || differs(expected?.total, note.modificationValue)) {
    throw new ValidationError(
      `Los totales enviados no coinciden con los calculados: totalSinImpuestos ${note.totals.subtotal.toFixed(2)}, ` +
        `IVA ${note.totals.totalTax.toFixed(2)}, valorModificacion ${note.modificationValue.toFixed(2)}`,
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
