import { ValidationError } from '../shared/errors';

/**
 * Fecha de emisión de un comprobante (día civil en Ecuador, sin hora).
 * Se modela como día/mes/año para no depender de la zona horaria del servidor.
 */
export class EmissionDate {
  private constructor(
    readonly day: number,
    readonly month: number,
    readonly year: number,
  ) {}

  static of(day: number, month: number, year: number): EmissionDate {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new ValidationError(`Fecha de emisión inválida: ${day}/${month}/${year}`);
    }
    return new EmissionDate(day, month, year);
  }

  /** Acepta "dd/mm/yyyy" (formato SRI) o "yyyy-mm-dd" (ISO). */
  static parse(input: string): EmissionDate {
    const value = (input ?? '').trim();
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    if (m) return EmissionDate.of(Number(m[1]), Number(m[2]), Number(m[3]));
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) return EmissionDate.of(Number(m[3]), Number(m[2]), Number(m[1]));
    throw new ValidationError(`Formato de fecha inválido "${input}": use dd/mm/aaaa`);
  }

  /** Día actual en Ecuador continental (UTC-5, sin horario de verano). */
  static todayInEcuador(now: Date = new Date()): EmissionDate {
    const ec = new Date(now.getTime() - 5 * 3600 * 1000);
    return EmissionDate.of(ec.getUTCDate(), ec.getUTCMonth() + 1, ec.getUTCFullYear());
  }

  /** "dd/mm/yyyy", formato del XML del SRI. */
  toSriFormat(): string {
    return `${String(this.day).padStart(2, '0')}/${String(this.month).padStart(2, '0')}/${this.year}`;
  }

  /** Medianoche UTC del día, para persistir como Date. */
  toDate(): Date {
    return new Date(Date.UTC(this.year, this.month - 1, this.day));
  }
}
