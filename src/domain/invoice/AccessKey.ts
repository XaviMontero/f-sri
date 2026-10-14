import { ValidationError } from '../shared/errors';

export interface AccessKeyParts {
  /** Fecha de emisión (se usan día/mes/año tal como se reciben, sin conversión de zona). */
  emissionDate: { day: number; month: number; year: number };
  /** Código del tipo de comprobante (01 factura, 04 nota de crédito…). */
  documentType: string;
  ruc: string;
  /** 1 = pruebas, 2 = producción. */
  environment: string;
  /** Establecimiento + punto de emisión (6 dígitos). */
  series: string;
  /** Secuencial de 9 dígitos. */
  sequential: string;
  /** Código numérico de 8 dígitos. */
  numericCode: string;
  /** 1 = emisión normal. */
  emissionType: string;
}

/**
 * Clave de acceso de 49 dígitos de un comprobante electrónico del SRI
 * (Ficha técnica, sección "Clave de acceso"), con dígito verificador módulo 11.
 */
export class AccessKey {
  private constructor(readonly value: string) {}

  static generate(parts: AccessKeyParts): AccessKey {
    const { day, month, year } = parts.emissionDate;
    const pieces: Array<[string, string, number]> = [
      ['documentType', parts.documentType, 2],
      ['ruc', parts.ruc, 13],
      ['environment', parts.environment, 1],
      ['series', parts.series, 6],
      ['sequential', parts.sequential, 9],
      ['numericCode', parts.numericCode, 8],
      ['emissionType', parts.emissionType, 1],
    ];
    for (const [name, value, length] of pieces) {
      if (!new RegExp(`^\\d{${length}}$`).test(value)) {
        throw new ValidationError(`Clave de acceso: ${name} debe tener ${length} dígitos (recibido "${value}")`);
      }
    }
    const date = `${pad(day, 2)}${pad(month, 2)}${pad(year, 4)}`;
    const base = date + pieces.map(([, value]) => value).join('');
    return new AccessKey(base + AccessKey.checkDigit(base));
  }

  /** Reconstruye una clave existente validando longitud y dígito verificador. */
  static from(value: string): AccessKey {
    if (!/^\d{49}$/.test(value)) {
      throw new ValidationError('La clave de acceso debe tener 49 dígitos');
    }
    const base = value.slice(0, 48);
    if (AccessKey.checkDigit(base) !== value[48]) {
      throw new ValidationError('Dígito verificador de la clave de acceso inválido');
    }
    return new AccessKey(value);
  }

  /** Módulo 11 con pesos 2..7 de derecha a izquierda; 11 → 0 y 10 → 1. */
  static checkDigit(base: string): string {
    const weights = [2, 3, 4, 5, 6, 7];
    let sum = 0;
    for (let i = base.length - 1, j = 0; i >= 0; i--, j++) {
      sum += Number(base[i]) * weights[j % weights.length];
    }
    const digit = 11 - (sum % 11);
    return String(digit === 11 ? 0 : digit === 10 ? 1 : digit);
  }

  /** Código numérico aleatorio de 8 dígitos. */
  static randomNumericCode(random: () => number = Math.random): string {
    return String(Math.floor(random() * 1e8)).padStart(8, '0');
  }

  toString(): string {
    return this.value;
  }
}

function pad(n: number, length: number): string {
  return String(n).padStart(length, '0');
}
