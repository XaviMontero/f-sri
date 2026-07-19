import { TaxInfo } from './invoice.interface';

/**
 * Impuesto de una nota de débito (tabla 16/17 de la Ficha Técnica del SRI)
 */
export interface DebitNoteTax {
  impuesto: {
    codigo: string;
    codigoPorcentaje: string;
    tarifa: string;
    baseImponible: string;
    valor: string;
  };
}

/**
 * Pago de una nota de débito (formaPago según tabla 24 de la Ficha Técnica)
 */
export interface DebitNotePayment {
  pago: {
    formaPago: string;
    total: string;
    plazo?: string;
    unidadTiempo?: string;
  };
}

/**
 * Motivo (recargo) de una nota de débito
 */
export interface DebitNoteReason {
  motivo: {
    razon: string;
    valor: string;
  };
}

/**
 * Información propia de la nota de débito (nodo infoNotaDebito)
 */
export interface DebitNoteInfo {
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
  impuestos: DebitNoteTax[];
  /** Valor total de la nota de débito (base + impuestos) */
  valorTotal: string;
  pagos: DebitNotePayment[];
}

export interface DebitNoteRequest {
  infoTributaria: TaxInfo;
  infoNotaDebito: DebitNoteInfo;
  motivos: DebitNoteReason[];
}
