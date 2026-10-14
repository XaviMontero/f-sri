import {
  DEFAULT_IVA_CODE,
  DEFAULT_PAYMENT_METHOD,
  FINAL_CONSUMER_ID,
  FINAL_CONSUMER_ID_TYPE,
  IVA_TAX_CODE,
  IvaRate,
  assertBuyerIdType,
  assertPaymentMethod,
  ivaRate,
} from '../../../domain/invoice/catalogs';
import { EmissionDate } from '../../../domain/invoice/EmissionDate';
import { Buyer, Issuer, Payment } from '../../../domain/invoice/Invoice';
import { ValidationError } from '../../../domain/shared/errors';
import { round2 } from '../../../domain/shared/money';

/** codDoc de la nota de débito (tabla 3). */
export const DOCUMENT_TYPE_DEBIT_NOTE = '05';

/** Comprobantes que puede modificar una nota de débito (tabla 3). */
export const MODIFIABLE_DOCUMENT_TYPES: Record<string, string> = {
  '01': 'FACTURA',
  '03': 'LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS',
  '04': 'NOTA DE CRÉDITO',
  '05': 'NOTA DE DÉBITO',
  '06': 'GUÍA DE REMISIÓN',
  '07': 'COMPROBANTE DE RETENCIÓN',
};

/** Longitud máxima de `razon` en el XSD de notaDebito 1.0.0. */
export const MAX_REASON_LENGTH = 300;

/** Documento de sustento que se modifica. */
export interface ModifiedDocument {
  /** codDocModificado (tabla 3), normalmente "01" (factura). */
  type: string;
  /** numDocModificado, formato 001-001-000000001. */
  number: string;
  /** fechaEmisionDocSustento. */
  emissionDate: EmissionDate;
}

/** Motivo (recargo) de la nota de débito. */
export interface DebitNoteReasonProps {
  reason: string;
  value: number;
  /** codigoPorcentaje de IVA (tabla 17) aplicable a este motivo. */
  ivaCode?: string;
}

/** Impuesto declarado por el cliente: solo se usa para asignar bases y validar. */
export interface DeclaredTax {
  /** codigo (tabla 16); solo se admite IVA ("2"). */
  taxCode?: string;
  ivaCode: string;
  rate?: number;
  base?: number;
  value?: number;
}

export interface DebitNoteTax {
  taxCode: string;
  iva: IvaRate;
  base: number;
  value: number;
}

export interface DebitNoteProps {
  issuer: Issuer;
  buyer: Buyer;
  emissionDate: EmissionDate;
  modifiedDocument: ModifiedDocument;
  reasons: DebitNoteReasonProps[];
  declaredTaxes?: DeclaredTax[];
  payments?: Payment[];
  additionalInfo?: Record<string, string>;
}

const TOLERANCE = 0.009;
const differs = (a: number, b: number) => Math.abs(round2(a) - round2(b)) > TOLERANCE;

/**
 * Agregado Nota de débito (codDoc 05, notaDebito 1.0.0). Los totales se calculan en el
 * servidor a partir de los motivos y de las tarifas del catálogo; los importes que envíe
 * el cliente solo se usan para validar.
 */
export class DebitNote {
  readonly documentType = DOCUMENT_TYPE_DEBIT_NOTE;
  readonly issuer: Issuer;
  readonly buyer: Buyer;
  readonly emissionDate: EmissionDate;
  readonly modifiedDocument: ModifiedDocument;
  readonly reasons: Array<{ reason: string; value: number; ivaCode?: string }>;
  readonly taxes: DebitNoteTax[];
  readonly subtotal: number;
  readonly totalTax: number;
  readonly total: number;
  readonly payments: Payment[];
  readonly additionalInfo: Record<string, string>;

  private constructor(props: DebitNoteProps) {
    this.issuer = validateIssuer(props.issuer);
    this.buyer = validateBuyer(props.buyer);
    this.emissionDate = props.emissionDate;
    this.modifiedDocument = validateModifiedDocument(props.modifiedDocument, props.emissionDate);
    this.reasons = validateReasons(props.reasons);
    this.subtotal = round2(this.reasons.reduce((sum, r) => sum + r.value, 0));
    this.taxes = computeTaxes(this.reasons, this.subtotal, props.declaredTaxes ?? []);
    this.totalTax = round2(this.taxes.reduce((sum, t) => sum + t.value, 0));
    this.total = round2(this.subtotal + this.totalTax);
    this.payments = this.resolvePayments(props.payments);
    this.additionalInfo = cleanAdditionalInfo(props.additionalInfo ?? {});
  }

  static create(props: DebitNoteProps): DebitNote {
    return new DebitNote(props);
  }

  private resolvePayments(payments?: Payment[]): Payment[] {
    if (!payments?.length) return [{ method: DEFAULT_PAYMENT_METHOD, amount: this.total }];
    for (const p of payments) {
      assertPaymentMethod(p.method);
      if (!(p.amount >= 0)) throw new ValidationError('El valor de cada pago debe ser positivo');
      if (p.term !== undefined && !(p.term >= 0)) throw new ValidationError('El plazo del pago no puede ser negativo');
    }
    const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
    if (paid !== this.total) {
      throw new ValidationError(
        `La suma de pagos (${paid.toFixed(2)}) no coincide con el valor total (${this.total.toFixed(2)})`,
      );
    }
    return payments.map((p) => ({ ...p, amount: round2(p.amount) }));
  }
}

function validateIssuer(issuer: Issuer): Issuer {
  if (!/^\d{13}$/.test(issuer.ruc)) throw new ValidationError('El RUC del emisor debe tener 13 dígitos');
  if (!/^\d{3}$/.test(issuer.establishment)) throw new ValidationError('El establecimiento debe tener 3 dígitos');
  if (!/^\d{3}$/.test(issuer.emissionPoint)) throw new ValidationError('El punto de emisión debe tener 3 dígitos');
  if (!issuer.businessName?.trim()) throw new ValidationError('El emisor requiere razón social');
  if (!issuer.headOfficeAddress?.trim()) throw new ValidationError('El emisor requiere dirección matriz');
  return issuer;
}

function validateBuyer(buyer: Buyer): Buyer {
  assertBuyerIdType(buyer.idType);
  const id = buyer.id?.trim();
  if (!id) throw new ValidationError('identificacionComprador es requerida');
  if (!buyer.name?.trim()) throw new ValidationError('razonSocialComprador es requerida');
  if (buyer.idType === FINAL_CONSUMER_ID_TYPE && id !== FINAL_CONSUMER_ID) {
    throw new ValidationError(`Consumidor final debe usar la identificación ${FINAL_CONSUMER_ID}`);
  }
  if (buyer.idType === '04' && !/^\d{13}$/.test(id)) {
    throw new ValidationError('El RUC del comprador debe tener 13 dígitos');
  }
  if (buyer.idType === '05' && !/^\d{10}$/.test(id)) {
    throw new ValidationError('La cédula del comprador debe tener 10 dígitos');
  }
  return { ...buyer, id, name: buyer.name.trim() };
}

function validateModifiedDocument(doc: ModifiedDocument, emissionDate: EmissionDate): ModifiedDocument {
  if (!doc || !MODIFIABLE_DOCUMENT_TYPES[doc.type]) {
    throw new ValidationError(`codDocModificado inválido: "${doc?.type ?? ''}"`);
  }
  const number = doc.number?.trim() ?? '';
  if (!/^\d{3}-\d{3}-\d{9}$/.test(number)) {
    throw new ValidationError(`numDocModificado debe tener el formato 001-001-000000001 (recibido "${number}")`);
  }
  if (doc.emissionDate.toDate().getTime() > emissionDate.toDate().getTime()) {
    throw new ValidationError(
      'fechaEmisionDocSustento no puede ser posterior a la fecha de emisión de la nota de débito',
    );
  }
  return { ...doc, number };
}

function validateReasons(reasons: DebitNoteReasonProps[]): DebitNote['reasons'] {
  if (!reasons?.length) throw new ValidationError('La nota de débito debe tener al menos un motivo');
  return reasons.map((r, index) => {
    const reason = r.reason?.trim();
    if (!reason) throw new ValidationError(`El motivo ${index + 1} requiere razon`);
    if (reason.length > MAX_REASON_LENGTH) {
      throw new ValidationError(`La razon del motivo ${index + 1} supera ${MAX_REASON_LENGTH} caracteres`);
    }
    if (!Number.isFinite(r.value) || r.value <= 0) {
      throw new ValidationError(`El valor del motivo ${index + 1} debe ser mayor que cero`);
    }
    if (r.ivaCode !== undefined) ivaRate(r.ivaCode);
    return { reason, value: round2(r.value), ivaCode: r.ivaCode };
  });
}

/**
 * Bases imponibles por tarifa de IVA:
 * - si cada motivo indica su codigoPorcentaje, se agrupan los motivos;
 * - si ninguno lo indica: con 0 o 1 impuesto declarado, todos los motivos van a esa tarifa
 *   (por defecto la general); con varios, se toman las bases declaradas, que deben sumar los motivos.
 * El IVA siempre se recalcula con la tarifa del catálogo.
 */
function computeTaxes(reasons: DebitNote['reasons'], subtotal: number, declared: DeclaredTax[]): DebitNoteTax[] {
  for (const tax of declared) {
    if (tax.taxCode !== undefined && tax.taxCode !== IVA_TAX_CODE) {
      throw new ValidationError(`Solo se admite el impuesto IVA (codigo ${IVA_TAX_CODE}); recibido "${tax.taxCode}"`);
    }
    const iva = ivaRate(tax.ivaCode);
    if (tax.rate !== undefined && differs(tax.rate, iva.rate)) {
      throw new ValidationError(`La tarifa ${tax.rate} no corresponde al codigoPorcentaje ${iva.code} (${iva.rate}%)`);
    }
  }
  const declaredCodes = new Set(declared.map((t) => t.ivaCode));
  if (declaredCodes.size !== declared.length) {
    throw new ValidationError('Hay impuestos repetidos con el mismo codigoPorcentaje');
  }

  const coded = reasons.filter((r) => r.ivaCode !== undefined).length;
  if (coded > 0 && coded < reasons.length) {
    throw new ValidationError('Indique codigoPorcentaje en todos los motivos o en ninguno');
  }

  const bases = new Map<string, number>();
  const add = (code: string, value: number) => bases.set(code, round2((bases.get(code) ?? 0) + value));

  if (coded === reasons.length) {
    for (const r of reasons) add(r.ivaCode!, r.value);
  } else if (declared.length <= 1) {
    const code = declared[0]?.ivaCode ?? DEFAULT_IVA_CODE;
    add(code, subtotal);
  } else {
    for (const tax of declared) {
      if (tax.base === undefined) {
        throw new ValidationError(
          'Con varios impuestos, indique baseImponible en cada uno o codigoPorcentaje en cada motivo',
        );
      }
      if (!(tax.base >= 0)) throw new ValidationError('La baseImponible no puede ser negativa');
      add(tax.ivaCode, tax.base);
    }
    const sum = round2([...bases.values()].reduce((a, b) => a + b, 0));
    if (differs(sum, subtotal)) {
      throw new ValidationError(
        `La suma de bases imponibles (${sum.toFixed(2)}) no coincide con la suma de los motivos (${subtotal.toFixed(2)})`,
      );
    }
  }

  const taxes = [...bases.entries()].map(([code, base]) => {
    const iva = ivaRate(code);
    return { taxCode: IVA_TAX_CODE, iva, base, value: round2((base * iva.rate) / 100) };
  });

  for (const tax of declared) {
    const computed = taxes.find((t) => t.iva.code === tax.ivaCode);
    if (!computed) {
      throw new ValidationError(`El impuesto con codigoPorcentaje ${tax.ivaCode} no corresponde a ningún motivo`);
    }
    if (tax.base !== undefined && differs(tax.base, computed.base)) {
      throw new ValidationError(
        `baseImponible del IVA ${computed.iva.code} no coincide: enviada ${tax.base.toFixed(2)}, calculada ${computed.base.toFixed(2)}`,
      );
    }
    if (tax.value !== undefined && differs(tax.value, computed.value)) {
      throw new ValidationError(
        `valor del IVA ${computed.iva.code} no coincide: enviado ${tax.value.toFixed(2)}, calculado ${computed.value.toFixed(2)}`,
      );
    }
  }
  return taxes;
}

/** El XSD no admite campos adicionales vacíos ni más de 15. */
function cleanAdditionalInfo(info: Record<string, string>): Record<string, string> {
  const entries = Object.entries(info).filter(([k, v]) => k?.trim() && v != null && String(v).trim() !== '');
  if (entries.length > 15) throw new ValidationError('Máximo 15 campos de información adicional');
  return Object.fromEntries(entries.map(([k, v]) => [k.trim(), String(v).trim()]));
}
