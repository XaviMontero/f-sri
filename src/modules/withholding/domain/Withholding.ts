import { IVA_TAX_CODE, ivaRate } from '../../../domain/invoice/catalogs';
import { EmissionDate } from '../../../domain/invoice/EmissionDate';
import { Issuer } from '../../../domain/invoice/Invoice';
import { ValidationError } from '../../../domain/shared/errors';
import { round2 } from '../../../domain/shared/money';

/** Comprobante de retención (tabla 3). */
export const DOCUMENT_TYPE_RETENCION = '07';

/** Tipos de identificación del sujeto retenido (tabla 6, sin consumidor final). */
export const SUBJECT_ID_TYPES: Record<string, string> = {
  '04': 'RUC',
  '05': 'CEDULA',
  '06': 'PASAPORTE',
  '08': 'IDENTIFICACION DEL EXTERIOR',
};

/** Identificación del exterior: exige `tipoSujetoRetenido` (tabla 14 del catálogo ATS). */
export const FOREIGN_ID_TYPE = '08';
export const SUBJECT_TYPES: Record<string, string> = { '01': 'PERSONA NATURAL', '02': 'SOCIEDAD' };

/** Impuestos que se retienen (tabla 19). */
export const RETENTION_TAXES: Record<string, string> = { '1': 'RENTA', '2': 'IVA', '6': 'ISD' };

/** Pago local (tabla 15 del catálogo ATS). Los pagos al exterior exigen bloques que esta versión no emite. */
export const LOCAL_PAYMENT = '01';

/** Tolerancia para comparar importes que envía el cliente con los calculados. */
const TOLERANCE = 0.009;

export interface WithholdingSubject {
  /** tipoIdentificacionSujetoRetenido (tabla 6). */
  idType: string;
  id: string;
  name: string;
  /** tipoSujetoRetenido (tabla 14 ATS); obligatorio con identificación del exterior. */
  subjectType?: string;
  /** parteRel: SI/NO (por defecto NO). */
  relatedParty: 'SI' | 'NO';
}

export interface SupportTax {
  /** codImpuestoDocSustento (tabla 16): 2 IVA, 3 ICE, 5 IRBPNR. */
  taxCode: string;
  /** codigoPorcentaje (tablas 17/18). */
  rateCode: string;
  base: number;
  /** Tarifa en porcentaje. */
  rate: number;
  value: number;
}

export interface Retention {
  /** codigo (tabla 19): 1 renta, 2 IVA, 6 ISD. */
  taxCode: string;
  /** codigoRetencion (tablas 20/21, conceptos ATS). */
  retentionCode: string;
  base: number;
  /** porcentajeRetener. */
  percentage: number;
  /** valorRetenido = base × porcentaje / 100, calculado en el dominio. */
  value: number;
}

export interface SupportPayment {
  /** formaPago (tabla 13 ATS / tabla 24). */
  method: string;
  amount: number;
}

/** Documento de sustento (`docSustento`), con importes ya validados y valores calculados. */
export interface SupportDocument {
  supportCode: string;
  documentType: string;
  /** numDocSustento: estab + ptoEmi + secuencial (15 dígitos). */
  number?: string;
  /** dd/mm/aaaa. */
  emissionDate: string;
  /** dd/mm/aaaa. */
  accountingDate?: string;
  authorizationNumber?: string;
  paymentLocation: string;
  subtotal: number;
  total: number;
  taxes: SupportTax[];
  retentions: Retention[];
  payments: SupportPayment[];
}

export interface SupportTaxInput {
  taxCode: string;
  rateCode: string;
  base: number;
  rate?: number;
  /** Valor que calculó el cliente: si viene, debe coincidir. */
  value?: number;
}

export interface RetentionInput {
  taxCode: string;
  retentionCode: string;
  base: number;
  percentage: number;
  /** Valor que calculó el cliente: si viene, debe coincidir con base × porcentaje / 100. */
  value?: number;
}

export interface SupportDocumentInput {
  supportCode: string;
  documentType: string;
  number?: string;
  emissionDate: string;
  accountingDate?: string;
  authorizationNumber?: string;
  paymentLocation?: string;
  subtotal: number;
  total: number;
  taxes: SupportTaxInput[];
  retentions: RetentionInput[];
  payments: SupportPayment[];
}

export interface WithholdingProps {
  issuer: Issuer;
  emissionDate: EmissionDate;
  /** mm/aaaa; por defecto, el mes de emisión. */
  fiscalPeriod?: string;
  subject: Omit<WithholdingSubject, 'relatedParty'> & { relatedParty?: string };
  supportDocuments: SupportDocumentInput[];
  additionalInfo?: Record<string, string>;
}

/**
 * Agregado Comprobante de Retención ATS 2.0.0 (codDoc 07). Se construye validado: los
 * valores retenidos y los impuestos del sustento se calculan aquí y los del cliente solo se comparan.
 */
export class Withholding {
  readonly documentType = DOCUMENT_TYPE_RETENCION;
  readonly issuer: Issuer;
  readonly emissionDate: EmissionDate;
  readonly fiscalPeriod: string;
  readonly subject: WithholdingSubject;
  readonly supportDocuments: SupportDocument[];
  readonly additionalInfo: Record<string, string>;

  private constructor(props: WithholdingProps) {
    this.issuer = props.issuer;
    this.emissionDate = props.emissionDate;
    this.fiscalPeriod = props.fiscalPeriod?.trim()
      ? parseFiscalPeriod(props.fiscalPeriod)
      : `${pad2(props.emissionDate.month)}/${props.emissionDate.year}`;
    this.subject = validateSubject(props.subject);
    if (!props.supportDocuments?.length) {
      throw new ValidationError('La retención debe tener al menos un documento de sustento');
    }
    this.supportDocuments = props.supportDocuments.map((doc, i) =>
      buildSupportDocument(doc, i + 1, props.emissionDate),
    );
    this.additionalInfo = props.additionalInfo ?? {};
    if (Object.keys(this.additionalInfo).length > 15) {
      throw new ValidationError('infoAdicional admite como máximo 15 campos');
    }
  }

  static create(props: WithholdingProps): Withholding {
    return new Withholding(props);
  }

  /** Suma de todos los valores retenidos. */
  get totalWithheld(): number {
    return round2(this.supportDocuments.flatMap((d) => d.retentions).reduce((sum, r) => sum + r.value, 0));
  }
}

/** valorRetenido = base × porcentaje / 100, redondeado half-up a 2 decimales. */
export function retentionValue(base: number, percentage: number): number {
  return round2((base * percentage) / 100);
}

/** Valida "mm/aaaa". */
export function parseFiscalPeriod(input: string): string {
  const m = /^(\d{2})\/(\d{4})$/.exec(input.trim());
  const month = m ? Number(m[1]) : 0;
  const year = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12 || year < 2000 || year > 2100) {
    throw new ValidationError(`periodoFiscal inválido "${input}": use mm/aaaa`);
  }
  return `${m[1]}/${m[2]}`;
}

function validateSubject(input: WithholdingProps['subject']): WithholdingSubject {
  if (!input || !SUBJECT_ID_TYPES[input.idType]) {
    throw new ValidationError(
      `tipoIdentificacionSujetoRetenido inválido: "${input?.idType ?? ''}" (válidos: ${Object.keys(SUBJECT_ID_TYPES).join(', ')})`,
    );
  }
  const id = (input.id ?? '').trim();
  const name = (input.name ?? '').trim();
  if (!id) throw new ValidationError('identificacionSujetoRetenido es requerida');
  if (!name) throw new ValidationError('razonSocialSujetoRetenido es requerida');
  if (input.idType === '04' && !/^\d{13}$/.test(id)) {
    throw new ValidationError('El RUC del sujeto retenido debe tener 13 dígitos');
  }
  if (input.idType === '05' && !/^\d{10}$/.test(id)) {
    throw new ValidationError('La cédula del sujeto retenido debe tener 10 dígitos');
  }
  const subjectType = input.subjectType?.trim() || undefined;
  if (input.idType === FOREIGN_ID_TYPE && !subjectType) {
    throw new ValidationError('tipoSujetoRetenido es obligatorio con identificación del exterior');
  }
  if (subjectType && !SUBJECT_TYPES[subjectType]) {
    throw new ValidationError(`tipoSujetoRetenido inválido: "${subjectType}" (01 persona natural, 02 sociedad)`);
  }
  const relatedParty = (input.relatedParty ?? 'NO').trim().toUpperCase() || 'NO';
  if (relatedParty !== 'SI' && relatedParty !== 'NO') {
    throw new ValidationError(`parteRel debe ser SI o NO: "${input.relatedParty}"`);
  }
  return { idType: input.idType, id, name, subjectType, relatedParty };
}

function buildSupportDocument(input: SupportDocumentInput, n: number, emission: EmissionDate): SupportDocument {
  const where = `docSustento ${n}`;
  if (!input) throw new ValidationError(`${where}: datos requeridos`);
  digits(input.supportCode, 2, 2, `${where}: codSustento`);
  digits(input.documentType, 2, 3, `${where}: codDocSustento`);
  if (input.number !== undefined && !/^\d{15}$/.test(input.number)) {
    throw new ValidationError(`${where}: numDocSustento debe tener 15 dígitos (estab + ptoEmi + secuencial)`);
  }
  if (input.authorizationNumber !== undefined && !/^(\d{10}|\d{37}|\d{49})$/.test(input.authorizationNumber)) {
    throw new ValidationError(`${where}: numAutDocSustento debe tener 10, 37 o 49 dígitos`);
  }
  const docDate = EmissionDate.parse(input.emissionDate);
  if (docDate.toDate() > emission.toDate()) {
    throw new ValidationError(`${where}: fechaEmisionDocSustento no puede ser posterior a la fecha de emisión`);
  }
  const accountingDate = input.accountingDate ? EmissionDate.parse(input.accountingDate).toSriFormat() : undefined;
  const paymentLocation = input.paymentLocation ?? LOCAL_PAYMENT;
  if (paymentLocation !== LOCAL_PAYMENT) {
    throw new ValidationError(`${where}: pagoLocExt "${paymentLocation}" no soportado (solo 01, pago local)`);
  }
  amount(input.subtotal, `${where}: totalSinImpuestos`);
  amount(input.total, `${where}: importeTotal`);

  if (!input.taxes?.length) throw new ValidationError(`${where}: requiere al menos un impuestoDocSustento`);
  if (!input.retentions?.length) throw new ValidationError(`${where}: requiere al menos una retención`);
  if (!input.payments?.length) throw new ValidationError(`${where}: requiere al menos un pago`);

  const taxes = input.taxes.map((t, i) => buildTax(t, `${where}, impuesto ${i + 1}`));
  const retentions = input.retentions.map((r, i) => buildRetention(r, `${where}, retención ${i + 1}`));
  const payments = input.payments.map((p, i) => {
    digits(p?.method, 2, 2, `${where}, pago ${i + 1}: formaPago`);
    amount(p.amount, `${where}, pago ${i + 1}: total`);
    return { method: p.method, amount: round2(p.amount) };
  });

  const subtotal = round2(input.subtotal);
  const total = round2(input.total);
  const taxValue = round2(taxes.reduce((s, t) => s + t.value, 0));
  if (Math.abs(round2(subtotal + taxValue) - total) > TOLERANCE) {
    throw new ValidationError(
      `${where}: importeTotal ${total.toFixed(2)} no coincide con totalSinImpuestos + impuestos (${(subtotal + taxValue).toFixed(2)})`,
    );
  }
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(paid - total) > TOLERANCE) {
    throw new ValidationError(
      `${where}: la suma de pagos (${paid.toFixed(2)}) no coincide con importeTotal (${total.toFixed(2)})`,
    );
  }

  return {
    supportCode: input.supportCode,
    documentType: input.documentType,
    number: input.number,
    emissionDate: docDate.toSriFormat(),
    accountingDate,
    authorizationNumber: input.authorizationNumber,
    paymentLocation,
    subtotal,
    total,
    taxes,
    retentions,
    payments,
  };
}

function buildTax(input: SupportTaxInput, where: string): SupportTax {
  digits(input?.taxCode, 1, 1, `${where}: codImpuestoDocSustento`);
  digits(input.rateCode, 1, 4, `${where}: codigoPorcentaje`);
  amount(input.base, `${where}: baseImponible`);
  let rate = input.rate;
  if (input.taxCode === IVA_TAX_CODE) {
    const iva = ivaRate(input.rateCode);
    if (rate !== undefined && Math.abs(rate - iva.rate) > TOLERANCE) {
      throw new ValidationError(
        `${where}: tarifa ${rate} no corresponde al codigoPorcentaje ${input.rateCode} (${iva.rate})`,
      );
    }
    rate = iva.rate;
  }
  if (rate === undefined) throw new ValidationError(`${where}: tarifa es requerida`);
  percentage(rate, `${where}: tarifa`);
  const value = round2((input.base * rate) / 100);
  if (input.value !== undefined && Math.abs(round2(input.value) - value) > TOLERANCE) {
    throw new ValidationError(
      `${where}: valorImpuesto ${input.value} no coincide con el calculado ${value.toFixed(2)}`,
    );
  }
  return { taxCode: input.taxCode, rateCode: input.rateCode, base: round2(input.base), rate, value };
}

function buildRetention(input: RetentionInput, where: string): Retention {
  if (!input || !RETENTION_TAXES[input.taxCode]) {
    throw new ValidationError(`${where}: codigo inválido "${input?.taxCode ?? ''}" (1 renta, 2 IVA, 6 ISD)`);
  }
  if (!/^[0-9A-Z]{1,5}$/.test(input.retentionCode ?? '')) {
    throw new ValidationError(`${where}: codigoRetencion inválido "${input.retentionCode ?? ''}"`);
  }
  amount(input.base, `${where}: baseImponible`);
  percentage(input.percentage, `${where}: porcentajeRetener`);
  const value = retentionValue(input.base, input.percentage);
  if (input.value !== undefined && Math.abs(round2(input.value) - value) > TOLERANCE) {
    throw new ValidationError(
      `${where}: valorRetenido ${input.value} no coincide con baseImponible × porcentajeRetener / 100 = ${value.toFixed(2)}`,
    );
  }
  return {
    taxCode: input.taxCode,
    retentionCode: input.retentionCode,
    base: round2(input.base),
    percentage: input.percentage,
    value,
  };
}

function digits(value: string | undefined, min: number, max: number, field: string): void {
  if (!new RegExp(`^\\d{${min},${max}}$`).test(value ?? '')) {
    const size = min === max ? `${min}` : `${min} a ${max}`;
    throw new ValidationError(`${field} debe ser numérico de ${size} dígitos: "${value ?? ''}"`);
  }
}

function amount(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new ValidationError(`${field} debe ser un importe >= 0`);
}

function percentage(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new ValidationError(`${field} debe estar entre 0 y 100`);
  }
  if (Math.abs(round2(value) - value) > 1e-9) throw new ValidationError(`${field} admite máximo 2 decimales`);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
