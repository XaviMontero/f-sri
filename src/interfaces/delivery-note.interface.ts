import { TaxInfo } from './invoice.interface';

/**
 * Detalle de ítem trasladado en una guía de remisión.
 * A diferencia de los demás comprobantes, no lleva precios ni impuestos.
 */
export interface DeliveryNoteItemDetail {
  detalle: {
    codigoInterno?: string;
    codigoAdicional?: string;
    descripcion: string;
    /** Hasta 6 decimales (versión 1.1.0) */
    cantidad: string;
  };
}

/**
 * Destinatario de la mercadería trasladada
 */
export interface DeliveryNoteRecipient {
  destinatario: {
    identificacionDestinatario: string;
    razonSocialDestinatario: string;
    dirDestinatario: string;
    motivoTraslado: string;
    docAduaneroUnico?: string;
    codEstabDestino?: string;
    ruta?: string;
    /** Código del documento de sustento (tabla 3), ej. '01' factura */
    codDocSustento?: string;
    numDocSustento?: string;
    numAutDocSustento?: string;
    fechaEmisionDocSustento?: string;
    detalles: DeliveryNoteItemDetail[];
  };
}

/**
 * Información propia de la guía de remisión (nodo infoGuiaRemision)
 */
export interface DeliveryNoteInfo {
  /** Fecha de emisión dd/mm/aaaa. Se usa para la clave de acceso; el XML v1.1.0 no la incluye */
  fechaEmision: string;
  dirPartida: string;
  razonSocialTransportista: string;
  /** Tabla 6 del SRI */
  tipoIdentificacionTransportista: string;
  rucTransportista: string;
  fechaIniTransporte: string;
  fechaFinTransporte: string;
  placa: string;
}

export interface DeliveryNoteRequest {
  infoTributaria: TaxInfo;
  infoGuiaRemision: DeliveryNoteInfo;
  destinatarios: DeliveryNoteRecipient[];
}
