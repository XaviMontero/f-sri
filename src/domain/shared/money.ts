/**
 * Aritmética monetaria en centavos para evitar los errores de coma flotante
 * (0.1 + 0.2). El SRI valida importes con 2 decimales y redondeo half-up.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Redondea a `decimals` decimales con half-up. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Formatea un importe con exactamente 2 decimales ("12.50"). */
export function formatMoney(value: number): string {
  return round2(value).toFixed(2);
}

/**
 * Formatea cantidades y precios unitarios: mínimo 2 decimales y máximo `maxDecimals`
 * (la factura 1.1.0 admite hasta 6), sin ceros de relleno innecesarios.
 */
export function formatDecimal(value: number, maxDecimals = 6): string {
  const fixed = roundTo(value, maxDecimals).toFixed(maxDecimals);
  const [int, dec] = fixed.split('.');
  const trimmed = dec.replace(/0+$/, '').padEnd(2, '0');
  return `${int}.${trimmed}`;
}

/** Convierte un valor recibido por la API ("12.5", 12.5) a número, o lanza si no es numérico. */
export function parseAmount(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) {
    throw new Error(`${field} no es un número válido: ${String(value)}`);
  }
  return n;
}
