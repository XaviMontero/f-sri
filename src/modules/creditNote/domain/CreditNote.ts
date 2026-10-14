import { AccessKey } from '../../../domain/invoice/AccessKey';
import { assertBuyerIdType, FINAL_CONSUMER_ID_TYPE } from '../../../domain/invoice/catalogs';
import { EmissionDate } from '../../../domain/invoice/EmissionDate';
import { Buyer, Issuer } from '../../../domain/invoice/Invoice';
import { InvoiceLine, InvoiceLineProps } from '../../../domain/invoice/InvoiceLine';
import { InvoiceTotals } from '../../../domain/invoice/InvoiceTotals';
import { ValidationError } from '../../../domain/shared/errors';

/** codDoc de la nota de crédito (tabla 3). */
export const DOCUMENT_TYPE_CREDIT_NOTE = '04';

/**
 * Comprobantes que una nota de crédito puede modificar (tabla 3): factura, liquidación de
 * compra y nota de débito.
 */
export const MODIFIABLE_DOCUMENTS: Record<string, string> = {
  '01': 'FACTURA',
  '03': 'LIQUIDACIÓN DE COMPRA',
  '05': 'NOTA DE DÉBITO',
};

/** Documento de sustento que se modifica (devolución, descuento, anulación parcial…). */
export interface ModifiedDocument {
  /** codDocModificado (tabla 3). */
  type: string;
  /** numDocModificado: "001-001-000000001". */
  number: string;
  /** fechaEmisionDocSustento. */
  emissionDate: EmissionDate;
}

export interface CreditNoteProps {
  issuer: Issuer;
  buyer: Buyer;
  emissionDate: EmissionDate;
  modifiedDocument: ModifiedDocument;
  /** motivo: razón de la modificación. */
  reason: string;
  lines: InvoiceLineProps[];
  additionalInfo?: Record<string, string>;
}

export interface CreditNoteNumbering {
  sequential: string;
  accessKey: AccessKey;
}

/**
 * Agregado Nota de crédito (codDoc 04). Sus detalles son líneas como las de la factura y los
 * totales (`totalSinImpuestos`, `totalConImpuestos` agrupado por tarifa y `valorModificacion`)
 * se calculan siempre a partir de ellas.
 *
 * Se crea primero sin numeración (borrador validado) y luego se le asigna secuencial y clave
 * de acceso con {@link numbered}: así un error de datos no consume secuenciales.
 */
export class CreditNote {
  readonly documentType = DOCUMENT_TYPE_CREDIT_NOTE;
  readonly issuer: Issuer;
  readonly buyer: Buyer;
  readonly emissionDate: EmissionDate;
  readonly modifiedDocument: ModifiedDocument;
  readonly reason: string;
  readonly lines: InvoiceLine[];
  readonly totals: InvoiceTotals;
  readonly additionalInfo: Record<string, string>;
  private readonly numbering?: CreditNoteNumbering;

  private constructor(
    private readonly props: CreditNoteProps,
    numbering?: CreditNoteNumbering,
  ) {
    if (!props.lines?.length) throw new ValidationError('La nota de crédito debe tener al menos un detalle');

    this.issuer = validateIssuer(props.issuer);
    this.buyer = validateBuyer(props.buyer);
    this.emissionDate = props.emissionDate;
    this.modifiedDocument = validateModifiedDocument(props.modifiedDocument, props.emissionDate);
    this.reason = validateReason(props.reason);
    this.lines = props.lines.map((l) => new InvoiceLine(l));
    this.totals = new InvoiceTotals(this.lines);
    this.additionalInfo = cleanAdditionalInfo(props.additionalInfo ?? {});

    if (numbering) {
      if (!/^\d{9}$/.test(numbering.sequential)) throw new ValidationError('El secuencial debe tener 9 dígitos');
      this.numbering = numbering;
    }
  }

  static create(props: CreditNoteProps): CreditNote {
    return new CreditNote(props);
  }

  /** La misma nota con secuencial y clave de acceso asignados. */
  numbered(numbering: CreditNoteNumbering): CreditNote {
    return new CreditNote(this.props, numbering);
  }

  get isNumbered(): boolean {
    return this.numbering !== undefined;
  }

  get sequential(): string {
    return this.requireNumbering().sequential;
  }

  get accessKey(): AccessKey {
    return this.requireNumbering().accessKey;
  }

  /** "001-001-000000123". */
  get number(): string {
    return `${this.issuer.establishment}-${this.issuer.emissionPoint}-${this.sequential}`;
  }

  /** valorModificacion: total de la nota (bases + impuestos). */
  get modificationValue(): number {
    return this.totals.total;
  }

  private requireNumbering(): CreditNoteNumbering {
    if (!this.numbering) throw new Error('La nota de crédito aún no tiene secuencial asignado');
    return this.numbering;
  }
}

function validateIssuer(issuer: Issuer): Issuer {
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

function validateBuyer(buyer: Buyer): Buyer {
  assertBuyerIdType(buyer.idType);
  if (buyer.idType === FINAL_CONSUMER_ID_TYPE) {
    throw new ValidationError('No se puede emitir una nota de crédito a consumidor final: identifique al comprador');
  }
  const id = buyer.id?.trim();
  if (!id) throw new ValidationError('identificacionComprador es requerida');
  if (!buyer.name?.trim()) throw new ValidationError('razonSocialComprador es requerida');
  if (buyer.idType === '04' && !/^\d{13}$/.test(id)) {
    throw new ValidationError('El RUC del comprador debe tener 13 dígitos');
  }
  if (buyer.idType === '05' && !/^\d{10}$/.test(id)) {
    throw new ValidationError('La cédula del comprador debe tener 10 dígitos');
  }
  return { ...buyer, id, name: buyer.name.trim() };
}

function validateModifiedDocument(doc: ModifiedDocument, emissionDate: EmissionDate): ModifiedDocument {
  if (!doc) throw new ValidationError('Se requiere el documento que se modifica');
  const type = String(doc.type ?? '').trim();
  if (!MODIFIABLE_DOCUMENTS[type]) {
    throw new ValidationError(
      `codDocModificado inválido: "${type}" (válidos: ${Object.keys(MODIFIABLE_DOCUMENTS).join(', ')})`,
    );
  }
  const number = String(doc.number ?? '').trim();
  if (!/^\d{3}-\d{3}-\d{9}$/.test(number)) {
    throw new ValidationError(`numDocModificado inválido: "${number}" (formato 001-001-000000001)`);
  }
  if (!doc.emissionDate) throw new ValidationError('fechaEmisionDocSustento es requerida');
  if (doc.emissionDate.toDate().getTime() > emissionDate.toDate().getTime()) {
    throw new ValidationError(
      `fechaEmisionDocSustento (${doc.emissionDate.toSriFormat()}) no puede ser posterior a la fecha de emisión (${emissionDate.toSriFormat()})`,
    );
  }
  return { type, number, emissionDate: doc.emissionDate };
}

function validateReason(reason: string): string {
  const value = String(reason ?? '').trim();
  if (!value) throw new ValidationError('El motivo de la nota de crédito es requerido');
  if (value.length > 300) throw new ValidationError('El motivo excede 300 caracteres');
  return value;
}

/** El XSD no admite campos adicionales vacíos ni más de 15. */
function cleanAdditionalInfo(info: Record<string, string>): Record<string, string> {
  const entries = Object.entries(info).filter(([k, v]) => k?.trim() && v != null && String(v).trim() !== '');
  if (entries.length > 15) throw new ValidationError('Máximo 15 campos de información adicional');
  return Object.fromEntries(entries.map(([k, v]) => [k.trim(), String(v).trim()]));
}
