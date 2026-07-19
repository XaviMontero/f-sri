import { TaxInfo } from './invoice.interface';

/**
 * Impuesto del documento de sustento (tablas 16-18 de la Ficha Técnica)
 */
export interface WithholdingSupportDocTax {
  impuestoDocSustento: {
    codImpuestoDocSustento: string;
    codigoPorcentaje: string;
    baseImponible: string;
    tarifa: string;
    valorImpuesto: string;
  };
}

/**
 * Retención practicada (código según tabla 19, codigoRetencion según tablas 20/21)
 */
export interface WithholdingTax {
  retencion: {
    codigo: string;
    codigoRetencion: string;
    baseImponible: string;
    porcentajeRetener: string;
    valorRetenido: string;
  };
}

/**
 * Pago del documento de sustento (formaPago según tabla 13 del Catálogo ATS)
 */
export interface WithholdingPayment {
  pago: {
    formaPago: string;
    total: string;
  };
}

/**
 * Documento de sustento de la retención (nodo docSustento del ATS 2.0.0)
 */
export interface WithholdingSupportDoc {
  docSustento: {
    /** Tabla 5 del Catálogo ATS */
    codSustento: string;
    /** Tabla 4 del Catálogo ATS, ej. '01' factura */
    codDocSustento: string;
    /** Formato 001001000000001 (15 dígitos) */
    numDocSustento?: string;
    fechaEmisionDocSustento: string;
    fechaRegistroContable?: string;
    numAutDocSustento?: string;
    /** Tabla 15 del Catálogo ATS. '01' = pago local */
    pagoLocExt: string;
    totalSinImpuestos: string;
    importeTotal: string;
    impuestosDocSustento: WithholdingSupportDocTax[];
    retenciones: WithholdingTax[];
    pagos: WithholdingPayment[];
  };
}

/**
 * Información propia del comprobante de retención (nodo infoCompRetencion)
 */
export interface WithholdingInfo {
  fechaEmision: string;
  /** Tabla 6 del SRI */
  tipoIdentificacionSujetoRetenido: string;
  /** Tabla 14 del Catálogo ATS. Obligatorio si la identificación es del exterior */
  tipoSujetoRetenido?: string;
  /** Parte relacionada SI/NO */
  parteRel?: string;
  razonSocialSujetoRetenido: string;
  identificacionSujetoRetenido: string;
  /** Formato mm/aaaa */
  periodoFiscal: string;
}

export interface WithholdingRequest {
  infoTributaria: TaxInfo;
  infoCompRetencion: WithholdingInfo;
  docsSustento: WithholdingSupportDoc[];
}
