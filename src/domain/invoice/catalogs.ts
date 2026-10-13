import { ValidationError } from '../shared/errors';

/** Código de impuesto IVA en la tabla 16 de la ficha técnica del SRI. */
export const IVA_TAX_CODE = '2';

export interface IvaRate {
  /** codigoPorcentaje (tabla 17). */
  code: string;
  /** Tarifa en porcentaje. */
  rate: number;
  label: string;
}

/**
 * Tarifas de IVA vigentes (tabla 17). La 15% (código 4) es la general desde abril 2024;
 * 12% y 14% siguen en el catálogo para comprobantes de periodos anteriores.
 */
const IVA_RATES: Record<string, IvaRate> = {
  '0': { code: '0', rate: 0, label: 'IVA 0%' },
  '2': { code: '2', rate: 12, label: 'IVA 12%' },
  '3': { code: '3', rate: 14, label: 'IVA 14%' },
  '4': { code: '4', rate: 15, label: 'IVA 15%' },
  '5': { code: '5', rate: 5, label: 'IVA 5%' },
  '6': { code: '6', rate: 0, label: 'No objeto de IVA' },
  '7': { code: '7', rate: 0, label: 'Exento de IVA' },
  '10': { code: '10', rate: 13, label: 'IVA 13%' },
};

/** Tarifa general vigente. */
export const DEFAULT_IVA_CODE = '4';

export function ivaRate(code: string): IvaRate {
  const rate = IVA_RATES[code];
  if (!rate) {
    throw new ValidationError(
      `codigoPorcentaje de IVA no soportado: "${code}" (válidos: ${Object.keys(IVA_RATES).join(', ')})`,
    );
  }
  return rate;
}

/** Tipos de identificación del comprador (tabla 6). */
export const BUYER_ID_TYPES: Record<string, string> = {
  '04': 'RUC',
  '05': 'CEDULA',
  '06': 'PASAPORTE',
  '07': 'CONSUMIDOR FINAL',
  '08': 'IDENTIFICACION DEL EXTERIOR',
};

export const FINAL_CONSUMER_ID_TYPE = '07';
export const FINAL_CONSUMER_ID = '9999999999999';
export const FINAL_CONSUMER_NAME = 'CONSUMIDOR FINAL';

export function assertBuyerIdType(code: string): void {
  if (!BUYER_ID_TYPES[code]) {
    throw new ValidationError(`tipoIdentificacionComprador inválido: "${code}"`);
  }
}

/** Formas de pago (tabla 24). */
export const PAYMENT_METHODS: Record<string, string> = {
  '01': 'SIN UTILIZACION DEL SISTEMA FINANCIERO',
  '15': 'COMPENSACIÓN DE DEUDAS',
  '16': 'TARJETA DE DÉBITO',
  '17': 'DINERO ELECTRÓNICO',
  '18': 'TARJETA PREPAGO',
  '19': 'TARJETA DE CRÉDITO',
  '20': 'OTROS CON UTILIZACION DEL SISTEMA FINANCIERO',
  '21': 'ENDOSO DE TÍTULOS',
};

export const DEFAULT_PAYMENT_METHOD = '01';

export function assertPaymentMethod(code: string): void {
  if (!PAYMENT_METHODS[code]) {
    throw new ValidationError(`formaPago inválida: "${code}"`);
  }
}

/** Tipos de comprobante (tabla 3). */
export const DOCUMENT_TYPE_FACTURA = '01';
