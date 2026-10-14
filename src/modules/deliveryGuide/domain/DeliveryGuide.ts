import { BUYER_ID_TYPES, FINAL_CONSUMER_ID_TYPE } from '../../../domain/invoice/catalogs';
import { EmissionDate } from '../../../domain/invoice/EmissionDate';
import { Issuer } from '../../../domain/invoice/Invoice';
import { ValidationError } from '../../../domain/shared/errors';
import { roundTo } from '../../../domain/shared/money';

/** Guía de remisión (tabla 3). */
export const DOCUMENT_TYPE_GUIA_REMISION = '06';

/** Decimales que admite `cantidad` en la guía de remisión 1.1.0. */
export const MAX_QUANTITY_DECIMALS = 6;

/** Transportista que traslada la mercadería (tipo de identificación según tabla 6). */
export interface Carrier {
  idType: string;
  id: string;
  name: string;
}

export interface DeliveryGuideItem {
  internalCode?: string;
  additionalCode?: string;
  description: string;
  quantity: number;
}

/** Documento de sustento del traslado (normalmente la factura). */
export interface SupportingDocument {
  /** codDoc de la tabla 3, p. ej. "01" factura. */
  type?: string;
  /** "001-001-000000001". */
  number?: string;
  /** Número de autorización (10, 37 o 49 dígitos). */
  authorizationNumber?: string;
  /** dd/mm/aaaa. */
  emissionDate?: string;
}

export interface DeliveryGuideRecipient {
  id: string;
  name: string;
  address: string;
  transferReason: string;
  customsDocument?: string;
  destinationEstablishment?: string;
  route?: string;
  supportingDocument?: SupportingDocument;
  items: DeliveryGuideItem[];
}

export interface DeliveryGuideProps {
  issuer: Issuer;
  /** Fecha de emisión: solo entra en la clave de acceso (el XML 1.1.0 no la incluye). */
  emissionDate: EmissionDate;
  departureAddress: string;
  carrier: Carrier;
  transportStart: EmissionDate;
  transportEnd: EmissionDate;
  plate: string;
  recipients: DeliveryGuideRecipient[];
  additionalInfo?: Record<string, string>;
}

export interface DeliveryGuideNumbering {
  sequential: string;
  accessKey: string;
}

/**
 * Agregado Guía de remisión (codDoc 06). No lleva valores monetarios: describe el
 * traslado (partida, transportista, placa, fechas) y, por destinatario, qué se entrega.
 * Se construye validado; la numeración (secuencial + clave de acceso) se asigna después
 * con {@link withNumbering} para no consumir secuenciales con datos inválidos.
 */
export class DeliveryGuide {
  readonly documentType = DOCUMENT_TYPE_GUIA_REMISION;
  readonly issuer: Issuer;
  readonly emissionDate: EmissionDate;
  readonly departureAddress: string;
  readonly carrier: Carrier;
  readonly transportStart: EmissionDate;
  readonly transportEnd: EmissionDate;
  readonly plate: string;
  readonly recipients: DeliveryGuideRecipient[];
  readonly additionalInfo: Record<string, string>;
  readonly numbering?: DeliveryGuideNumbering;

  private constructor(props: DeliveryGuideProps, numbering?: DeliveryGuideNumbering) {
    this.issuer = props.issuer;
    this.emissionDate = props.emissionDate;
    this.departureAddress = required(props.departureAddress, 'dirPartida');
    this.carrier = validateCarrier(props.carrier);
    this.transportStart = props.transportStart;
    this.transportEnd = props.transportEnd;
    if (props.transportStart.toDate().getTime() > props.transportEnd.toDate().getTime()) {
      throw new ValidationError(
        `fechaIniTransporte (${props.transportStart.toSriFormat()}) no puede ser posterior a fechaFinTransporte (${props.transportEnd.toSriFormat()})`,
      );
    }
    this.plate = validatePlate(props.plate);
    if (!props.recipients?.length) throw new ValidationError('La guía de remisión debe tener al menos un destinatario');
    this.recipients = props.recipients.map((r, i) => validateRecipient(r, i + 1));
    this.additionalInfo = cleanAdditionalInfo(props.additionalInfo ?? {});
    this.numbering = numbering;
  }

  static create(props: DeliveryGuideProps): DeliveryGuide {
    return new DeliveryGuide(props);
  }

  /** La misma guía con secuencial y clave de acceso asignados. */
  withNumbering(numbering: DeliveryGuideNumbering): DeliveryGuide {
    if (!/^\d{9}$/.test(numbering.sequential)) throw new ValidationError('El secuencial debe tener 9 dígitos');
    if (!/^\d{49}$/.test(numbering.accessKey)) throw new ValidationError('La clave de acceso debe tener 49 dígitos');
    return new DeliveryGuide(this.props(), numbering);
  }

  get sequential(): string {
    return this.requireNumbering().sequential;
  }

  get accessKey(): string {
    return this.requireNumbering().accessKey;
  }

  /** Número visible, p. ej. "001-001-000000123". */
  get number(): string {
    return `${this.issuer.establishment}-${this.issuer.emissionPoint}-${this.sequential}`;
  }

  private requireNumbering(): DeliveryGuideNumbering {
    if (!this.numbering) throw new Error('La guía de remisión aún no tiene secuencial asignado');
    return this.numbering;
  }

  private props(): DeliveryGuideProps {
    return {
      issuer: this.issuer,
      emissionDate: this.emissionDate,
      departureAddress: this.departureAddress,
      carrier: this.carrier,
      transportStart: this.transportStart,
      transportEnd: this.transportEnd,
      plate: this.plate,
      recipients: this.recipients,
      additionalInfo: this.additionalInfo,
    };
  }
}

function required(value: string | undefined, field: string, maxLength = 300): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new ValidationError(`${field} es requerido`);
  if (trimmed.length > maxLength) throw new ValidationError(`${field} admite máximo ${maxLength} caracteres`);
  return trimmed;
}

function optionalText(value: string | undefined, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) throw new ValidationError(`${field} admite máximo ${maxLength} caracteres`);
  return trimmed;
}

function validateCarrier(carrier: Carrier): Carrier {
  if (!carrier) throw new ValidationError('Los datos del transportista son requeridos');
  if (!BUYER_ID_TYPES[carrier.idType]) {
    throw new ValidationError(`tipoIdentificacionTransportista inválido: "${carrier.idType}"`);
  }
  if (carrier.idType === FINAL_CONSUMER_ID_TYPE) {
    throw new ValidationError('El transportista no puede identificarse como consumidor final');
  }
  const id = required(carrier.id, 'rucTransportista', 20);
  if (carrier.idType === '04' && !/^\d{13}$/.test(id)) {
    throw new ValidationError('El RUC del transportista debe tener 13 dígitos');
  }
  if (carrier.idType === '05' && !/^\d{10}$/.test(id)) {
    throw new ValidationError('La cédula del transportista debe tener 10 dígitos');
  }
  return { idType: carrier.idType, id, name: required(carrier.name, 'razonSocialTransportista') };
}

/** Placa del vehículo: letras, dígitos y guiones (máximo 20, como el XSD). */
function validatePlate(plate: string): string {
  const value = required(plate, 'placa', 20);
  if (!/^[A-Za-z0-9-]+$/.test(value)) {
    throw new ValidationError(`placa inválida: "${value}" (solo letras, números y guiones)`);
  }
  return value;
}

function validateRecipient(r: DeliveryGuideRecipient, position: number): DeliveryGuideRecipient {
  const label = `destinatario ${position}`;
  if (!r) throw new ValidationError(`El ${label} es requerido`);
  if (!r.items?.length) throw new ValidationError(`El ${label} debe tener al menos un detalle`);

  const destinationEstablishment = optionalText(r.destinationEstablishment, `codEstabDestino del ${label}`, 3);
  if (destinationEstablishment && !/^\d{3}$/.test(destinationEstablishment)) {
    throw new ValidationError(`codEstabDestino del ${label} debe tener 3 dígitos`);
  }

  return {
    id: required(r.id, `identificacionDestinatario del ${label}`, 20),
    name: required(r.name, `razonSocialDestinatario del ${label}`),
    address: required(r.address, `dirDestinatario del ${label}`),
    transferReason: required(r.transferReason, `motivoTraslado del ${label}`),
    customsDocument: optionalText(r.customsDocument, `docAduaneroUnico del ${label}`, 20),
    destinationEstablishment,
    route: optionalText(r.route, `ruta del ${label}`, 300),
    supportingDocument: validateSupportingDocument(r.supportingDocument, label),
    items: r.items.map((item, i) => validateItem(item, `detalle ${i + 1} del ${label}`)),
  };
}

function validateSupportingDocument(
  doc: SupportingDocument | undefined,
  label: string,
): SupportingDocument | undefined {
  if (!doc) return undefined;
  const type = optionalText(doc.type, `codDocSustento del ${label}`, 2);
  const number = optionalText(doc.number, `numDocSustento del ${label}`, 17);
  const authorizationNumber = optionalText(doc.authorizationNumber, `numAutDocSustento del ${label}`, 49);
  const emissionDate = optionalText(doc.emissionDate, `fechaEmisionDocSustento del ${label}`, 10);

  if (type && !/^\d{2}$/.test(type)) throw new ValidationError(`codDocSustento del ${label} debe tener 2 dígitos`);
  if (number && !/^\d{3}-\d{3}-\d{9}$/.test(number)) {
    throw new ValidationError(`numDocSustento del ${label} debe tener el formato 001-001-000000001`);
  }
  if (authorizationNumber && !/^(\d{10}|\d{37}|\d{49})$/.test(authorizationNumber)) {
    throw new ValidationError(`numAutDocSustento del ${label} debe tener 10, 37 o 49 dígitos`);
  }
  const normalizedDate = emissionDate ? EmissionDate.parse(emissionDate).toSriFormat() : undefined;

  if (!type && !number && !authorizationNumber && !normalizedDate) return undefined;
  return { type, number, authorizationNumber, emissionDate: normalizedDate };
}

function validateItem(item: DeliveryGuideItem, label: string): DeliveryGuideItem {
  if (!item) throw new ValidationError(`El ${label} es requerido`);
  if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw new ValidationError(`La cantidad del ${label} debe ser mayor a 0`);
  }
  if (roundTo(item.quantity, MAX_QUANTITY_DECIMALS) !== item.quantity) {
    throw new ValidationError(`La cantidad del ${label} admite máximo ${MAX_QUANTITY_DECIMALS} decimales`);
  }
  return {
    internalCode: optionalText(item.internalCode, `codigoInterno del ${label}`, 25),
    additionalCode: optionalText(item.additionalCode, `codigoAdicional del ${label}`, 25),
    description: required(item.description, `descripcion del ${label}`),
    quantity: item.quantity,
  };
}

/** El XSD no admite campos adicionales vacíos ni más de 15. */
function cleanAdditionalInfo(info: Record<string, string>): Record<string, string> {
  const entries = Object.entries(info).filter(([k, v]) => k?.trim() && v != null && String(v).trim() !== '');
  if (entries.length > 15) throw new ValidationError('Máximo 15 campos de información adicional');
  return Object.fromEntries(entries.map(([k, v]) => [k.trim(), String(v).trim()]));
}
