import { AccessKey } from '../../domain/invoice/AccessKey';
import {
  DEFAULT_IVA_CODE,
  FINAL_CONSUMER_ID,
  FINAL_CONSUMER_ID_TYPE,
  FINAL_CONSUMER_NAME,
} from '../../domain/invoice/catalogs';
import { EmissionDate } from '../../domain/invoice/EmissionDate';
import { Buyer, Invoice, Payment } from '../../domain/invoice/Invoice';
import { InvoiceLineProps } from '../../domain/invoice/InvoiceLine';
import { InvoiceStatus } from '../../domain/invoice/InvoiceStatus';
import { ForbiddenError, NotFoundError, ValidationError } from '../../domain/shared/errors';
import { round2 } from '../../domain/shared/money';
import {
  BuyerRepository,
  InvoiceRecord,
  InvoiceRepository,
  IssuerRepository,
  ProductRecord,
  ProductRepository,
  SequenceGenerator,
} from '../ports/repositories';
import { Clock, systemClock } from '../ports/runtime';
import { InvoiceXmlRenderer } from '../ports/xml';

export interface IssueInvoiceLine {
  code: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  ivaCode?: string;
}

export interface IssueInvoiceCommand {
  issuerRuc: string;
  /** dd/mm/aaaa; por defecto, hoy en Ecuador. */
  emissionDate?: string;
  buyer: Partial<Buyer> & { idType: string; id: string };
  lines: IssueInvoiceLine[];
  payments?: Payment[];
  tip?: number;
  additionalInfo?: Record<string, string>;
  /** Totales que calculó el cliente: si se envían, deben coincidir con los del dominio. */
  expectedTotals?: { subtotal?: number; total?: number };
  /** Payload original, para auditoría. */
  rawRequest?: unknown;
}

export interface Actor {
  /** Empresa del usuario autenticado; si viene, solo puede facturar con ese emisor. */
  companyId?: string;
}

export interface IssueInvoiceDeps {
  issuers: IssuerRepository;
  buyers: BuyerRepository;
  products: ProductRepository;
  sequences: SequenceGenerator;
  invoices: InvoiceRepository;
  xml: InvoiceXmlRenderer;
  clock?: Clock;
  random?: () => number;
}

/**
 * Caso de uso "emitir factura": resuelve emisor, comprador y productos, arma el
 * agregado con totales calculados, genera el XML y lo persiste como PENDIENTE.
 * La firma y el envío al SRI son responsabilidad de {@link SubmitInvoiceToSri}.
 */
export class IssueInvoice {
  constructor(private readonly deps: IssueInvoiceDeps) {}

  async execute(command: IssueInvoiceCommand, actor: Actor = {}): Promise<InvoiceRecord> {
    const issuerRecord = await this.deps.issuers.findByRuc(command.issuerRuc);
    if (!issuerRecord) throw new NotFoundError('Empresa emisora no encontrada', 400);
    if (actor.companyId && actor.companyId !== issuerRecord.id) {
      throw new ForbiddenError('No puede emitir facturas a nombre de otra empresa');
    }
    if (!command.lines?.length) throw new ValidationError('La factura debe tener al menos un detalle');

    const clock = this.deps.clock ?? systemClock;
    const emissionDate = command.emissionDate
      ? EmissionDate.parse(command.emissionDate)
      : EmissionDate.todayInEcuador(clock.now());
    const buyer = await this.resolveBuyer(command.buyer);
    const products = await this.deps.products.findByCodes(command.lines.map((l) => l.code));
    const lines = command.lines.map((line) => this.resolveLine(line, products.get(line.code)));

    const additionalInfo = { ...defaultAdditionalInfo(buyer), ...(command.additionalInfo ?? {}) };

    // Validar antes de consumir un secuencial: un error de datos no debe dejar huecos.
    const draft = Invoice.create({
      issuer: issuerRecord.issuer,
      buyer,
      emissionDate,
      sequential: '000000001',
      numericCode: '00000000',
      lines,
      payments: command.payments,
      tip: command.tip,
      additionalInfo,
    });
    this.checkExpectedTotals(draft, command.expectedTotals);

    const sequential = await this.deps.sequences.next({
      ruc: issuerRecord.issuer.ruc,
      establishment: issuerRecord.issuer.establishment,
      emissionPoint: issuerRecord.issuer.emissionPoint,
      documentType: draft.documentType,
    });
    const invoice = Invoice.create({
      issuer: issuerRecord.issuer,
      buyer,
      emissionDate,
      sequential,
      numericCode: AccessKey.randomNumericCode(this.deps.random),
      lines,
      payments: command.payments,
      tip: command.tip,
      additionalInfo,
    });

    return this.deps.invoices.create({
      issuerId: issuerRecord.id,
      buyerRecordId: (buyer as { recordId?: string }).recordId,
      buyer: {
        idType: buyer.idType,
        id: buyer.id,
        name: buyer.name,
        address: buyer.address,
        email: buyer.email,
        phone: buyer.phone,
      },
      accessKey: invoice.accessKey.value,
      sequential: invoice.sequential,
      number: invoice.number,
      environment: invoice.issuer.environment,
      emissionDate: invoice.emissionDate.toDate(),
      subtotal: invoice.totals.subtotal,
      totalTax: invoice.totals.totalTax,
      total: invoice.totals.total,
      status: InvoiceStatus.PENDING,
      xml: this.deps.xml.render(invoice),
      lines: invoice.lines.map((l) => ({
        productId: products.get(l.code)?.id,
        code: l.code,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        subtotal: l.subtotal,
        ivaCode: l.iva.code,
        ivaRate: l.iva.rate,
        taxValue: l.taxValue,
      })),
      payments: invoice.payments,
      additionalInfo: invoice.additionalInfo,
      request: command.rawRequest,
    });
  }

  private async resolveBuyer(input: IssueInvoiceCommand['buyer']): Promise<Buyer & { recordId?: string }> {
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
    throw new NotFoundError('Client not found', 400);
  }

  private resolveLine(line: IssueInvoiceLine, product?: ProductRecord): InvoiceLineProps {
    if (!product && (line.unitPrice === undefined || !line.description)) {
      throw new NotFoundError(`Product not found: ${line.code}`, 400);
    }
    return {
      code: line.code,
      description: line.description || product!.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? product!.unitPrice,
      discount: line.discount,
      ivaCode: line.ivaCode ?? (product && !product.chargesIva ? '0' : DEFAULT_IVA_CODE),
    };
  }

  private checkExpectedTotals(invoice: Invoice, expected?: IssueInvoiceCommand['expectedTotals']): void {
    const mismatch = (a: number | undefined, b: number) => a !== undefined && Math.abs(round2(a) - b) > 0.009;
    if (mismatch(expected?.subtotal, invoice.totals.subtotal) || mismatch(expected?.total, invoice.totals.total)) {
      throw new ValidationError(
        `Los totales enviados no coinciden con los calculados: subtotal ${invoice.totals.subtotal.toFixed(2)}, ` +
          `IVA ${invoice.totals.totalTax.toFixed(2)}, total ${invoice.totals.total.toFixed(2)}`,
      );
    }
  }
}

function defaultAdditionalInfo(buyer: Buyer): Record<string, string> {
  const info: Record<string, string> = {};
  if (buyer.email) info.Email = buyer.email;
  if (buyer.phone) info['Teléfono'] = buyer.phone;
  if (buyer.address) info['Dirección'] = buyer.address;
  return info;
}
