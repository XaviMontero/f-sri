import { TaxInfo } from './invoice.interface';

/**
 * Detalle de una nota de crédito según la Ficha Técnica del SRI (formato XML v1.1.0).
 * A diferencia de la factura, el detalle usa codigoInterno / codigoAdicional.
 */
export interface CreditNoteProductDetail {
  detalle: {
    codigoInterno: string;
    codigoAdicional?: string;
    descripcion: string;
    cantidad: string;
    precioUnitario: string;
    descuento?: string;
    precioTotalSinImpuesto: string;
    impuestos: Array<{
      impuesto: {
        codigo: string;
        codigoPorcentaje: string;
        tarifa: string;
        baseImponible: string;
        valor: string;
      };
    }>;
  };
}

/**
 * Información propia de la nota de crédito (nodo infoNotaCredito)
 */
export interface CreditNoteInfo {
  fechaEmision: string;
  tipoIdentificacionComprador: string;
  identificacionComprador: string;
  razonSocialComprador?: string;
  /** Código del documento que se modifica (tabla 3). Normalmente '01' (factura) */
  codDocModificado: string;
  /** Número del documento que se modifica, formato 001-001-000000001 */
  numDocModificado: string;
  /** Fecha de emisión del documento de sustento, formato dd/mm/aaaa */
  fechaEmisionDocSustento: string;
  totalSinImpuestos: string;
  /** Valor total de la modificación (incluye impuestos) */
  valorModificacion: string;
  moneda?: string;
  /** Razón de la modificación, ej. DEVOLUCIÓN */
  motivo: string;
}

export interface CreditNoteRequest {
  infoTributaria: TaxInfo;
  infoNotaCredito: CreditNoteInfo;
  detalles: CreditNoteProductDetail[];
}

export interface CreateCreditNoteDTO {
  empresaId: string | any;
  clienteId: string | any;
  facturaModificadaId?: string | any;
  fechaEmision: Date;
  claveAcceso: string;
  secuencial: string;
  codDocModificado: string;
  numDocModificado: string;
  fechaEmisionDocSustento: Date;
  totalSinImpuestos: number;
  totalIva: number;
  valorModificacion: number;
  motivo: string;
}
