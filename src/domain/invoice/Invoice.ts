import { ValidationError } from '../shared/errors';
import { round2 } from '../shared/money';
import { AccessKey } from './AccessKey';
import {
  DEFAULT_PAYMENT_METHOD,
  DOCUMENT_TYPE_FACTURA,
  FINAL_CONSUMER_ID,
  FINAL_CONSUMER_ID_TYPE,
  assertBuyerIdType,
  assertPaymentMethod,
} from './catalogs';
import { EmissionDate } from './EmissionDate';
import { InvoiceLine, InvoiceLineProps } from './InvoiceLine';
import { InvoiceTotals } from './InvoiceTotals';

/** Límite del SRI para facturas a consumidor final (USD). */
export const FINAL_CONSUMER_MAX_TOTAL = 50;

/** Datos del emisor congelados en el comprobante. */
export interface Issuer {
  ruc: string;
  businessName: string;
  tradeName?: string;
  headOfficeAddress: string;
  establishmentAddress?: string;
  establishment: string;
  emissionPoint: string;
  /** 1 = pruebas, 2 = producción. */
  environment: '1' | '2';
  emissionType: '1';
  keepsAccounting: boolean;
  specialTaxpayer?: string;
}

export interface Buyer {
  idType: string;
  id: string;
  name: string;
  address?: string;
  email?: string;
  phone?: string;
}

export interface Payment {
  method: string;
  amount: number;
  term?: number;
  timeUnit?: string;
}

export interface InvoiceProps {
  issuer: Issuer;
  buyer: Buyer;
  emissionDate: EmissionDate;
  sequential: string;
  numericCode: string;
  lines: InvoiceLineProps[];
  payments?: Payment[];
  tip?: number;
  additionalInfo?: Record<string, string>;
}

/**
 * Agregado Factura (codDoc 01). Se construye validado y con sus totales
 * calculados a partir de las líneas: el XML nunca usa importes enviados por el cliente.
 */
export class Invoice {
  readonly documentType = DOCUMENT_TYPE_FACTURA;
  readonly issuer: Issuer;
  readonly buyer: Buyer;
  readonly emissionDate: EmissionDate;
  readonly sequential: string;
  readonly accessKey: AccessKey;
  readonly lines: InvoiceLine[];
  readonly totals: InvoiceTotals;
  readonly payments: Payment[];
  readonly additionalInfo: Record<string, string>;

  private constructor(props: InvoiceProps) {
    if (!props.lines?.length) throw new ValidationError('La factura debe tener al menos un detalle');

    this.issuer = Invoice.validateIssuer(props.issuer);
    this.buyer = Invoice.validateBuyer(props.buyer);
    this.emissionDate = props.emissionDate;
    this.sequential = props.sequential;
    this.lines = props.lines.map((l) => new InvoiceLine(l));
    this.totals = new InvoiceTotals(this.lines, props.tip ?? 0);
    this.payments = this.resolvePayments(props.payments);
    this.additionalInfo = Invoice.cleanAdditionalInfo(props.additionalInfo ?? {});

    if (this.buyer.idType === FINAL_CONSUMER_ID_TYPE && this.totals.total > FINAL_CONSUMER_MAX_TOTAL) {
      throw new ValidationError(
        `Una factura a consumidor final no puede superar USD ${FINAL_CONSUMER_MAX_TOTAL} (total ${this.totals.total.toFixed(2)})`,
      );
    }

    this.accessKey = AccessKey.generate({
      emissionDate: props.emissionDate,
      documentType: this.documentType,
      ruc: this.issuer.ruc,
      environment: this.issuer.environment,
      series: this.series,
      sequential: this.sequential,
      numericCode: props.numericCode,
      emissionType: this.issuer.emissionType,
    });
  }

  static create(props: InvoiceProps): Invoice {
    return new Invoice(props);
  }

  /** Establecimiento + punto de emisión, p. ej. "001001". */
  get series(): string {
    return `${this.issuer.establishment}${this.issuer.emissionPoint}`;
  }

  /** Número visible del comprobante, p. ej. "001-001-000000123". */
  get number(): string {
    return `${this.issuer.establishment}-${this.issuer.emissionPoint}-${this.sequential}`;
  }

  private resolvePayments(payments?: Payment[]): Payment[] {
    if (!payments?.length) {
      return [{ method: DEFAULT_PAYMENT_METHOD, amount: this.totals.total }];
    }
    for (const p of payments) {
      assertPaymentMethod(p.method);
      if (!(p.amount >= 0)) throw new ValidationError('El valor de cada pago debe ser positivo');
    }
    const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
    if (paid !== this.totals.total) {
      throw new ValidationError(
        `La suma de pagos (${paid.toFixed(2)}) no coincide con el importe total (${this.totals.total.toFixed(2)})`,
      );
    }
    return payments.map((p) => ({ ...p, amount: round2(p.amount) }));
  }

  private static validateIssuer(issuer: Issuer): Issuer {
    if (!/^\d{13}$/.test(issuer.ruc)) throw new ValidationError('El RUC del emisor debe tener 13 dígitos');
    if (!/^\d{3}$/.test(issuer.establishment)) throw new ValidationError('El establecimiento debe tener 3 dígitos');
    if (!/^\d{3}$/.test(issuer.emissionPoint)) throw new ValidationError('El punto de emisión debe tener 3 dígitos');
    if (!issuer.businessName?.trim()) throw new ValidationError('El emisor requiere razón social');
    if (!issuer.headOfficeAddress?.trim()) throw new ValidationError('El emisor requiere dirección matriz');
    if (issuer.environment !== '1' && issuer.environment !== '2') {
      throw new ValidationError('El ambiente debe ser 1 (pruebas) o 2 (producción)');
    }
    return issuer;
  }

  private static validateBuyer(buyer: Buyer): Buyer {
    assertBuyerIdType(buyer.idType);
    const id = buyer.id?.trim();
    if (!id) throw new ValidationError('identificacionComprador es requerida');
    if (!buyer.name?.trim()) throw new ValidationError('razonSocialComprador es requerida');
    if (buyer.idType === FINAL_CONSUMER_ID_TYPE && id !== FINAL_CONSUMER_ID) {
      throw new ValidationError(`Consumidor final debe usar la identificación ${FINAL_CONSUMER_ID}`);
    }
    if (buyer.idType === '04' && !/^\d{13}$/.test(id))
      throw new ValidationError('El RUC del comprador debe tener 13 dígitos');
    if (buyer.idType === '05' && !/^\d{10}$/.test(id))
      throw new ValidationError('La cédula del comprador debe tener 10 dígitos');
    return { ...buyer, id, name: buyer.name.trim() };
  }

  /** El XSD no admite campos adicionales vacíos ni más de 15. */
  private static cleanAdditionalInfo(info: Record<string, string>): Record<string, string> {
    const entries = Object.entries(info).filter(([k, v]) => k?.trim() && v != null && String(v).trim() !== '');
    if (entries.length > 15) throw new ValidationError('Máximo 15 campos de información adicional');
    return Object.fromEntries(entries.map(([k, v]) => [k.trim(), String(v).trim()]));
  }
}
